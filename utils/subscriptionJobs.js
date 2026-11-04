import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { notify } from "./notify.js";
import { sendMail } from "./mailer.js";
import { escapeHtml } from "./escapeHtml.js";
import { checkBudgetAlerts } from "./budgetAlerts.js";
import { normalizeMerchant, merchantsMatch } from "./detectSubscriptions.js";
import { nextDateAfter, startOfDayUTC, daysUntil } from "./subscriptionDates.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
const RUN_EVERY_MS = 60 * 60 * 1000;
// a long server outage shouldn't add years of charges at once
const MAX_CATCH_UP_CHARGES = 12;

const money = (amount, currency = "USD") => {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
        return `${currency} ${Number(amount).toFixed(2)}`;
    }
};

// Has the same charge already arrived, e.g. imported from the user's bank?
const alreadyRecorded = async (subscription, chargeDate) => {
    const nearby = await Transaction.find({
        userId: subscription.userId,
        transactionType: "expense",
        subscriptionId: null,
        transactionDate: {
            $gte: new Date(chargeDate.getTime() - 3 * DAY_MS),
            $lte: new Date(chargeDate.getTime() + 3 * DAY_MS),
        },
    })
        .select("description transactionAmount")
        .lean();

    return nearby.some(
        (t) =>
            merchantsMatch(normalizeMerchant(t.description), subscription.merchantKey) &&
            Math.abs(t.transactionAmount - subscription.amount) <= subscription.amount * 0.2
    );
};

// Moves one subscription past any charge dates that have arrived, adding the
// expense if the user asked for that. Returns how many expenses were added.
export const processDueSubscription = async (subscription, now = new Date()) => {
    const today = startOfDayUTC(now);
    const billingDay = subscription.billingDay;
    let next = new Date(subscription.nextChargeDate);
    let added = 0;
    let steps = 0;

    while (next <= today && steps < MAX_CATCH_UP_CHARGES) {
        if (subscription.autoAddExpense && !(await alreadyRecorded(subscription, next))) {
            // the unique index on subscriptionId + date stops a repeat run adding it twice
            const result = await Transaction.updateOne(
                { userId: subscription.userId, subscriptionId: subscription._id, transactionDate: next },
                {
                    $setOnInsert: {
                        transactionType: "expense",
                        transactionAmount: subscription.amount,
                        transactionCategory: subscription.category,
                        description: subscription.name,
                        isRecurring: true,
                        recurringFrequency: subscription.frequency === "quarterly" ? undefined : subscription.frequency,
                    },
                },
                { upsert: true }
            );
            added += result.upsertedCount || 0;
        }
        next = nextDateAfter(next, subscription.frequency, billingDay);
        steps += 1;
    }

    // still behind after the cap: skip forward without adding more
    while (next <= today) next = nextDateAfter(next, subscription.frequency, billingDay);

    await Subscription.updateOne(
        { _id: subscription._id, nextChargeDate: subscription.nextChargeDate },
        { nextChargeDate: next, isTrial: false }
    );

    return added;
};

const reminderText = (subscription, days, currency) => {
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const price = money(subscription.amount, currency);
    if (subscription.isTrial) {
        return {
            title: `Your ${subscription.name} free trial ends ${when}`,
            body: `You'll be charged ${price} unless you cancel first.`,
        };
    }
    return {
        title: `${subscription.name} renews ${when}`,
        body: `${price} will be charged. Cancel before then if you no longer use it.`,
    };
};

// Sends each renewal reminder once. Free trials and yearly renewals also get an
// email, because they're the ones people forget and the most costly to miss.
export const sendReminder = async (subscription, user, now = new Date()) => {
    const days = daysUntil(subscription.nextChargeDate, now);
    if (days < 0 || days > subscription.remindDaysBefore) return false;

    const { title, body } = reminderText(subscription, days, user?.currency);
    const dateKey = new Date(subscription.nextChargeDate).toISOString().slice(0, 10);

    const created = await notify(subscription.userId, {
        type: "system",
        level: subscription.isTrial ? "warning" : "info",
        title,
        body,
        link: "/dashboard/subscriptions",
        dedupeKey: `subscription:${subscription._id}:${dateKey}`,
        metadata: { subscriptionId: subscription._id },
    });

    if (created && user?.email && (subscription.isTrial || subscription.frequency === "yearly")) {
        sendMail({
            to: user.email,
            subject: title,
            text: `Hi ${user.username},\n\n${title}.\n${body}\n\nThe AI Financial Coach Team`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                    <h2 style="color: #4f46e5;">${escapeHtml(title)}</h2>
                    <p>Hi ${escapeHtml(user.username)},</p>
                    <p>${escapeHtml(body)}</p>
                    <p style="margin-top: 24px;">The AI Financial Coach Team</p>
                </div>
            `,
        }).catch((err) => console.error("Subscription reminder email failed:", err.message));
    }

    return created;
};

export const runSubscriptionJobs = async (now = new Date()) => {
    const today = startOfDayUTC(now);

    const due = await Subscription.find({ status: "active", nextChargeDate: { $lte: today } }).lean();
    const usersToCheck = new Set();

    for (const subscription of due) {
        try {
            const added = await processDueSubscription(subscription, now);
            if (added) usersToCheck.add(String(subscription.userId));
        } catch (err) {
            console.error(`Subscription ${subscription._id} failed: ${err.message}`);
        }
    }

    for (const userId of usersToCheck) {
        const user = await User.findById(userId);
        if (user) checkBudgetAlerts(user, now);
    }

    const upcoming = await Subscription.find({
        status: "active",
        remindDaysBefore: { $gt: 0 },
        nextChargeDate: { $gte: today, $lte: new Date(today.getTime() + 30 * DAY_MS) },
    }).lean();

    for (const subscription of upcoming) {
        try {
            const user = await User.findById(subscription.userId).select("username email currency").lean();
            await sendReminder(subscription, user, now);
        } catch (err) {
            console.error(`Subscription reminder ${subscription._id} failed: ${err.message}`);
        }
    }
};

// Shortly after each start, then hourly. Repeat runs are safe: nothing is added or sent twice.
export const startSubscriptionSchedule = () => {
    const run = () => runSubscriptionJobs().catch((err) => console.error(`Subscription jobs failed: ${err.message}`));
    setTimeout(run, FIRST_RUN_DELAY_MS).unref();
    setInterval(run, RUN_EVERY_MS).unref();
};
