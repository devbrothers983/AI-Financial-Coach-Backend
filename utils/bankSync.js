import BankConnection from "../models/BankConnection.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { getPlaidClient, plaidErrorCode } from "../config/plaid.js";
import { decryptSecret } from "./tokenCipher.js";
import { mapPlaidTransaction, findLikelyDuplicate } from "./plaidTransactions.js";
import { checkBudgetAlerts } from "./budgetAlerts.js";
import { notify } from "./notify.js";

const LOCK_MS = 5 * 60 * 1000;
const MAX_PAGINATION_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// Pulls every page since `startCursor`. If the data changes mid-way, Plaid
// requires restarting from the first page of the update.
export const pullUpdates = async (client, accessToken, startCursor) => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            let cursor = startCursor;
            let hasMore = true;
            const updates = { added: [], modified: [], removed: [] };

            while (hasMore) {
                const { data } = await client.transactionsSync({
                    access_token: accessToken,
                    count: 500,
                    ...(cursor ? { cursor } : {}),
                });
                updates.added.push(...data.added);
                updates.modified.push(...data.modified);
                updates.removed.push(...data.removed);
                cursor = data.next_cursor;
                hasMore = data.has_more;
            }

            return { ...updates, nextCursor: cursor };
        } catch (err) {
            const restart =
                plaidErrorCode(err) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
                attempt < MAX_PAGINATION_ATTEMPTS;
            if (!restart) throw err;
        }
    }
};

// Applies one batch of changes to the user's transactions
export const applyUpdates = async (connection, updates) => {
    const accountsById = Object.fromEntries(connection.accounts.map((a) => [a.accountId, a]));
    const userId = connection.userId;

    const newRows = updates.added
        .map((t) => ({ plaidId: t.transaction_id, fields: mapPlaidTransaction(t, accountsById) }))
        .filter((row) => row.fields);

    let manual = [];
    if (newRows.length) {
        const times = newRows.map((row) => row.fields.transactionDate.getTime());
        manual = await Transaction.find({
            userId,
            source: { $ne: "bank" },
            transactionDate: {
                $gte: new Date(Math.min(...times) - 2 * DAY_MS),
                $lte: new Date(Math.max(...times) + 2 * DAY_MS),
            },
        })
            .select("transactionType transactionAmount transactionDate")
            .lean();
    }

    const matched = new Set();
    const operations = newRows.map(({ plaidId, fields }) => {
        const duplicate = findLikelyDuplicate(fields, manual, matched);
        if (duplicate) matched.add(String(duplicate._id));
        return {
            updateOne: {
                // userId and plaidTransactionId are inserted from this filter
                filter: { userId, plaidTransactionId: plaidId },
                update: {
                    $setOnInsert: {
                        ...fields,
                        source: "bank",
                        bankConnectionId: connection._id,
                        possibleDuplicateOf: duplicate?._id || null,
                    },
                },
                upsert: true,
            },
        };
    });

    const idsToRemove = updates.removed.map((r) => r.transaction_id);

    for (const t of updates.modified) {
        const fields = mapPlaidTransaction(t, accountsById);
        if (!fields) {
            idsToRemove.push(t.transaction_id);
            continue;
        }
        // keep the user's own category and description edits; no upsert, so a
        // transaction the user deleted doesn't come back
        const { transactionCategory, description, ...bankFacts } = fields;
        operations.push({
            updateOne: {
                filter: { userId, plaidTransactionId: t.transaction_id },
                update: { $set: bankFacts },
            },
        });
    }

    if (operations.length) await Transaction.bulkWrite(operations, { ordered: false });
    if (idsToRemove.length) {
        await Transaction.deleteMany({ userId, plaidTransactionId: { $in: idsToRemove } });
    }

    return {
        added: newRows.length,
        modified: updates.modified.length,
        removed: updates.removed.length,
        skipped: updates.added.length - newRows.length,
        duplicates: matched.size,
        expenseDates: newRows
            .filter((row) => row.fields.transactionType === "expense")
            .map((row) => row.fields.transactionDate),
    };
};

const isThisMonth = (date, now = new Date()) =>
    date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();

export const markConnectionNeedsReauth = async (connection, code) => {
    await BankConnection.updateOne({ _id: connection._id }, { status: "needs_reauth", lastErrorCode: code });
    const month = new Date().toISOString().slice(0, 7);
    await notify(connection.userId, {
        type: "security",
        level: "warning",
        title: `Reconnect ${connection.institutionName}`,
        body: "Your bank needs you to sign in again before new transactions can be imported.",
        link: "/dashboard/banks",
        dedupeKey: `bank:${connection._id}:reauth:${month}`,
    });
};

// Syncs one connection. Returns null when another sync is already running
// (that sync runs once more when it finishes, to pick up the new data).
export const syncConnection = async (connectionId) => {
    const now = new Date();
    const connection = await BankConnection.findOneAndUpdate(
        { _id: connectionId, $or: [{ syncLockedUntil: null }, { syncLockedUntil: { $lt: now } }] },
        { syncLockedUntil: new Date(now.getTime() + LOCK_MS), resyncRequested: false },
        { new: true }
    ).select("+accessTokenEnc +cursor");

    if (!connection) {
        await BankConnection.updateOne({ _id: connectionId }, { resyncRequested: true });
        return null;
    }

    const totals = { added: 0, modified: 0, removed: 0, skipped: 0, duplicates: 0 };
    let runAgain = false;

    try {
        const accessToken = decryptSecret(connection.accessTokenEnc);
        const updates = await pullUpdates(getPlaidClient(), accessToken, connection.cursor);
        const result = await applyUpdates(connection, updates);

        Object.keys(totals).forEach((key) => {
            totals[key] += result[key];
        });

        // the cursor only moves on after the changes are safely stored
        await BankConnection.updateOne(
            { _id: connection._id },
            { cursor: updates.nextCursor, status: "active", lastSyncedAt: new Date(), lastErrorCode: null }
        );

        // only this month: alerts about old months from the history import would just be noise
        if (result.expenseDates.some((date) => isThisMonth(date))) {
            const user = await User.findById(connection.userId);
            if (user) checkBudgetAlerts(user, new Date());
        }
    } catch (err) {
        const code = plaidErrorCode(err);
        if (code === "ITEM_LOGIN_REQUIRED") {
            await markConnectionNeedsReauth(connection, code);
        } else {
            await BankConnection.updateOne({ _id: connection._id }, { lastErrorCode: code || "SYNC_FAILED" });
        }
        console.error(`Bank sync failed for connection ${connection._id}: ${code || err.message}`);
        const failure = new Error(
            code === "ITEM_LOGIN_REQUIRED" ? "Your bank needs you to sign in again" : "Couldn't sync with your bank right now"
        );
        failure.statusCode = 502;
        throw failure;
    } finally {
        // returns the document as it was, so a request made during this sync is visible
        const released = await BankConnection.findOneAndUpdate(
            { _id: connection._id },
            { syncLockedUntil: null, resyncRequested: false }
        ).select("+resyncRequested");
        runAgain = Boolean(released?.resyncRequested);
    }

    if (runAgain) {
        const again = await syncConnection(connection._id);
        if (again) {
            Object.keys(totals).forEach((key) => {
                totals[key] += again[key];
            });
        }
    }

    return totals;
};

// Tells Plaid to stop the connection (which also ends its monthly fee), then
// deletes our record. Used when disconnecting and when an account is deleted.
export const removeConnection = async (connection) => {
    try {
        const withToken = await BankConnection.findById(connection._id).select("+accessTokenEnc");
        if (withToken) {
            await getPlaidClient().itemRemove({ access_token: decryptSecret(withToken.accessTokenEnc) });
        }
    } catch (err) {
        // already removed at Plaid, or Plaid is down: log it for follow-up without the token
        console.error(`Plaid item removal failed for connection ${connection._id} (item ${connection.itemId}): ${plaidErrorCode(err) || err.message}`);
    }
    await BankConnection.deleteOne({ _id: connection._id });
};

export const removeAllConnectionsForUsers = async (userIds) => {
    const connections = await BankConnection.find({ userId: { $in: userIds } }).select("itemId");
    await Promise.all(connections.map(removeConnection));
};
