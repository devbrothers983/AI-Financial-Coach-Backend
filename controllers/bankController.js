import BankConnection from "../models/BankConnection.js";
import Transaction from "../models/Transaction.js";
import { getPlaidClient, isPlaidConfigured, plaidErrorCode } from "../config/plaid.js";
import { encryptSecret, decryptSecret } from "../utils/tokenCipher.js";
import { syncConnection, removeConnection, markConnectionNeedsReauth } from "../utils/bankSync.js";
import { verifyPlaidWebhook } from "../utils/plaidWebhook.js";
import { logActivity } from "../utils/activityLogger.js";
import { notify } from "../utils/notify.js";

const MAX_CONNECTIONS_PER_USER = 5;
// up to Plaid's 24 months of history
const HISTORY_DAYS = 730;

const notConfigured = (res) =>
    res.status(503).json({
        success: false,
        message: "Bank connections aren't available yet",
        status: 503,
    });

const toSafeConnection = (c) => ({
    _id: c._id,
    institutionName: c.institutionName,
    accounts: c.accounts,
    status: c.status,
    lastSyncedAt: c.lastSyncedAt,
    lastErrorCode: c.lastErrorCode,
    createdAt: c.createdAt,
});

const plaidFailure = (res, err, message) => {
    console.error(`${message}: ${plaidErrorCode(err) || err.message}`);
    return res.status(502).json({ success: false, message, status: 502 });
};

// ========================================
// List Connections
// ========================================

export const getConnections = async (req, res, next) => {
    try {
        const connections = await BankConnection.find({ userId: req.user._id }).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            enabled: isPlaidConfigured(),
            connections: connections.map(toSafeConnection),
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Start Plaid Link (new connection, or reconnecting one)
// ========================================

export const createLinkToken = async (req, res, next) => {
    try {
        if (!isPlaidConfigured()) return notConfigured(res);

        const { connectionId } = req.body;

        const request = {
            client_name: "AI Financial Coach",
            language: "en",
            country_codes: ["US"],
            user: { client_user_id: String(req.user._id) },
            ...(process.env.PLAID_WEBHOOK_URL && { webhook: process.env.PLAID_WEBHOOK_URL }),
            ...(process.env.PLAID_REDIRECT_URI && { redirect_uri: process.env.PLAID_REDIRECT_URI }),
        };

        if (connectionId) {
            // update mode: the user signs in to their bank again
            const connection = await BankConnection.findOne({ _id: connectionId, userId: req.user._id }).select("+accessTokenEnc");
            if (!connection) {
                return res.status(404).json({ success: false, message: "Bank connection not found", status: 404 });
            }
            request.access_token = decryptSecret(connection.accessTokenEnc);
        } else {
            const count = await BankConnection.countDocuments({ userId: req.user._id });
            if (count >= MAX_CONNECTIONS_PER_USER) {
                return res.status(400).json({
                    success: false,
                    message: `You can connect up to ${MAX_CONNECTIONS_PER_USER} banks`,
                    status: 400,
                });
            }
            request.products = ["transactions"];
            request.transactions = { days_requested: HISTORY_DAYS };
        }

        try {
            const { data } = await getPlaidClient().linkTokenCreate(request);
            return res.status(200).json({ success: true, linkToken: data.link_token, status: 200 });
        } catch (err) {
            return plaidFailure(res, err, "Couldn't start the bank connection");
        }
    } catch (err) {
        next(err);
    }
};

// ========================================
// Finish Plaid Link
// ========================================

export const exchangePublicToken = async (req, res, next) => {
    try {
        if (!isPlaidConfigured()) return notConfigured(res);

        const { publicToken, institution } = req.body;

        if (typeof publicToken !== "string" || !publicToken) {
            return res.status(400).json({ success: false, message: "publicToken is required", status: 400 });
        }

        const client = getPlaidClient();
        let accessToken;
        let itemId;
        let plaidAccounts;
        let institutionId;

        try {
            const { data: exchanged } = await client.itemPublicTokenExchange({ public_token: publicToken });
            accessToken = exchanged.access_token;
            itemId = exchanged.item_id;
            const { data: details } = await client.accountsGet({ access_token: accessToken });
            plaidAccounts = details.accounts;
            institutionId = details.item.institution_id || "";
        } catch (err) {
            return plaidFailure(res, err, "Couldn't finish connecting your bank");
        }

        const accounts = plaidAccounts.map((a) => ({
            accountId: a.account_id,
            name: a.name,
            mask: a.mask || "",
            type: a.type,
            subtype: a.subtype || "",
        }));

        // the same bank login twice would import everything twice and bill twice
        const existing = institutionId
            ? await BankConnection.find({ userId: req.user._id, institutionId }).select("accounts")
            : [];
        const fingerprint = (a) => `${a.name}|${a.mask}`;
        const known = new Set(existing.flatMap((c) => c.accounts.map(fingerprint)));

        if (accounts.some((a) => known.has(fingerprint(a)))) {
            await client.itemRemove({ access_token: accessToken }).catch((err) => {
                console.error(`Plaid item removal failed for duplicate link: ${plaidErrorCode(err) || err.message}`);
            });
            return res.status(409).json({
                success: false,
                message: "This bank account is already connected",
                status: 409,
            });
        }

        const institutionName = String(institution?.name || "").trim().slice(0, 100) || "Your bank";

        const connection = await BankConnection.create({
            userId: req.user._id,
            itemId,
            accessTokenEnc: encryptSecret(accessToken),
            institutionId,
            institutionName,
            accounts,
        });

        logActivity(req, {
            action: "bank.connect",
            description: `Connected ${institutionName}`,
            targetId: connection._id,
            metadata: { institutionName, accountCount: accounts.length },
        });

        // This first call also switches on Plaid's update webhook. History usually
        // takes a little longer to arrive, so an empty result here is normal.
        let synced = null;
        try {
            synced = await syncConnection(connection._id);
        } catch (err) {
            console.error(`First bank sync failed: ${err.message}`);
        }

        const fresh = await BankConnection.findById(connection._id);

        return res.status(201).json({
            success: true,
            message: `${institutionName} connected`,
            connection: toSafeConnection(fresh),
            synced,
            status: 201,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Sync Now
// ========================================

export const syncNow = async (req, res, next) => {
    try {
        if (!isPlaidConfigured()) return notConfigured(res);

        const connection = await BankConnection.findOne({ _id: req.params.id, userId: req.user._id });
        if (!connection) {
            return res.status(404).json({ success: false, message: "Bank connection not found", status: 404 });
        }

        const synced = await syncConnection(connection._id);
        const fresh = await BankConnection.findById(connection._id);

        return res.status(200).json({
            success: true,
            message: synced ? "Sync finished" : "A sync is already running",
            connection: toSafeConnection(fresh),
            synced,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Disconnect
// ========================================

export const disconnectBank = async (req, res, next) => {
    try {
        const connection = await BankConnection.findOne({ _id: req.params.id, userId: req.user._id });
        if (!connection) {
            return res.status(404).json({ success: false, message: "Bank connection not found", status: 404 });
        }

        const deleteTransactions = req.body?.deleteTransactions === true;

        await removeConnection(connection);

        let deleted = 0;
        if (deleteTransactions) {
            const result = await Transaction.deleteMany({ userId: req.user._id, bankConnectionId: connection._id });
            deleted = result.deletedCount;
        }

        logActivity(req, {
            action: "bank.disconnect",
            description: `Disconnected ${connection.institutionName}${deleteTransactions ? ` and deleted ${deleted} imported transactions` : ""}`,
            targetId: connection._id,
            metadata: { institutionName: connection.institutionName, deleted },
        });

        return res.status(200).json({
            success: true,
            message: `${connection.institutionName} disconnected`,
            deleted,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Plaid Webhook (public; authenticated by signature)
// ========================================

const handleWebhookEvent = async ({ webhook_type: type, webhook_code: code, item_id: itemId }) => {
    const connection = await BankConnection.findOne({ itemId });
    if (!connection) return;

    if (type === "TRANSACTIONS" && code === "SYNC_UPDATES_AVAILABLE") {
        await syncConnection(connection._id);
        return;
    }

    if (type !== "ITEM") return;

    if (code === "ERROR" || code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT") {
        await markConnectionNeedsReauth(connection, code);
    } else if (code === "USER_PERMISSION_REVOKED" || code === "USER_ACCOUNT_REVOKED") {
        await BankConnection.updateOne({ _id: connection._id }, { status: "revoked", lastErrorCode: code });
        await notify(connection.userId, {
            type: "security",
            level: "warning",
            title: `${connection.institutionName} was disconnected`,
            body: "Access was removed at your bank, so new transactions won't be imported.",
            link: "/dashboard/banks",
        });
    }
};

export const plaidWebhook = async (req, res) => {
    const verified = isPlaidConfigured() && (await verifyPlaidWebhook(req.headers["plaid-verification"], req.rawBody));

    if (!verified) {
        return res.status(401).json({ success: false, message: "Invalid webhook", status: 401 });
    }

    // answer right away so Plaid doesn't retry while the sync runs
    res.status(200).json({ success: true });

    handleWebhookEvent(req.body).catch((err) => {
        console.error(`Plaid webhook handling failed: ${err.message}`);
    });
};
