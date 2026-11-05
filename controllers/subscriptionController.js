import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { detectSubscriptions, normalizeMerchant, merchantsMatch } from "../utils/detectSubscriptions.js";
import {
    CHARGES_PER_YEAR,
    parseDateOnly,
    rollForwardToToday,
    monthlyCostOf,
    yearlyCostOf,
    costInNextDays,
} from "../utils/subscriptionDates.js";
import { logActivity } from "../utils/activityLogger.js";
import { websiteExists } from "../utils/websiteCheck.js";
import { normalizeCategoryName, isValidCategory } from "../utils/categories.js";

// A little over 2 years, so a yearly charge can be seen twice
const HISTORY_DAYS = 760;
const MAX_SUBSCRIPTIONS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const roundMoney = (amount) => Math.round(amount * 100) / 100;

const sumOf = (items, pick) => roundMoney(items.reduce((sum, item) => sum + pick(item), 0));

const notFound = (res) =>
    res.status(404).json({ success: false, message: "Subscription not found", status: 404 });

// A charge after this long past the cancel date means it didn't really stop
const CANCEL_GRACE_DAYS = 1;

// Looks at every charge rather than the detected pattern, because a single
// charge after cancelling is exactly what the user needs to hear about
const latestChargeAfterCancel = (subscription, transactions) => {
    if (!subscription.cancelledAt) return null;
    const cutoff = new Date(subscription.cancelledAt).getTime() + CANCEL_GRACE_DAYS * DAY_MS;

    const times = transactions
        .filter((t) => merchantsMatch(normalizeMerchant(t.description), subscription.merchantKey))
        .map((t) => new Date(t.transactionDate).getTime())
        .filter((time) => time > cutoff);

    return times.length ? new Date(Math.max(...times)) : null;
};

// ========================================
// The Subscriptions Page
// ========================================

export const getSubscriptions = async (req, res, next) => {
    try {
        const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);

        const [transactions, user, saved] = await Promise.all([
            Transaction.find({
                userId: req.user._id,
                transactionType: "expense",
                transactionDate: { $gte: since },
                // pending charges can still change, and a possible duplicate
                // would look like two charges on the same day
                isPending: { $ne: true },
                possibleDuplicateOf: null,
            })
                .select("description transactionAmount transactionDate transactionCategory isRecurring recurringFrequency")
                .lean(),
            User.findById(req.user._id).select("dismissedSubscriptions").lean(),
            Subscription.find({ userId: req.user._id }).sort({ nextChargeDate: 1 }).lean(),
        ]);

        const found = detectSubscriptions(transactions);
        const dismissed = new Set(user?.dismissedSubscriptions || []);
        const now = Date.now();

        const tracked = saved.map((s) => {
            const match = found.find((d) => merchantsMatch(d.merchantKey, s.merchantKey));
            const isActive = s.status === "active";

            return {
                ...s,
                monthlyCost: monthlyCostOf(s.amount, s.frequency),
                yearlyCost: yearlyCostOf(s.amount, s.frequency),
                // the bank's latest charge differs from the price the user saved
                latestChargedAmount:
                    isActive && !s.autoAddExpense && match?.isActive && match.amount !== s.amount ? match.amount : null,
                // cancelled, but the company kept charging
                chargedAfterCancelDate: isActive ? null : latestChargeAfterCancel(s, transactions),
            };
        });

        // detected ones the user isn't tracking yet
        const untracked = found.filter((d) => !saved.some((s) => merchantsMatch(d.merchantKey, s.merchantKey)));
        const hidden = untracked.filter((d) => dismissed.has(d.merchantKey));
        const shown = untracked.filter((d) => !dismissed.has(d.merchantKey));
        const suggestions = shown.filter((d) => d.isActive);
        const possiblyCancelled = shown.filter((d) => !d.isActive);

        const active = tracked.filter((s) => s.status === "active");
        const cancelled = tracked.filter((s) => s.status === "cancelled");

        // what cancelling has saved so far, based on each subscription's price
        const savedSoFar = sumOf(
            cancelled.filter((s) => !s.chargedAfterCancelDate),
            (s) => (s.yearlyCost * Math.max(now - new Date(s.cancelledAt || s.updatedAt).getTime(), 0)) / (365 * DAY_MS)
        );

        return res.status(200).json({
            success: true,
            message: "Subscriptions retrieved successfully",
            currency: req.user.currency || "USD",
            summary: {
                activeCount: active.length + suggestions.length,
                monthlyTotal: roundMoney(sumOf(active, (s) => s.monthlyCost) + sumOf(suggestions, (s) => s.monthlyCost)),
                yearlyTotal: roundMoney(sumOf(active, (s) => s.yearlyCost) + sumOf(suggestions, (s) => s.yearlyCost)),
                dueIn30Days: roundMoney(
                    sumOf(active, (s) => costInNextDays(s.amount, s.frequency, s.nextChargeDate, s.billingDay)) +
                        sumOf(suggestions, (s) => costInNextDays(s.amount, s.frequency, s.nextChargeDate))
                ),
                savedSoFar,
            },
            tracked: active,
            cancelled,
            suggestions,
            possiblyCancelled,
            hidden,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Add / Edit
// ========================================

// Accepts "udemy.com/settings" or a full link and returns the full https link,
// "" for no link, or null if it's invalid. This becomes a link the user clicks,
// so anything other than https, such as javascript:, is refused.
const readWebsite = (value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    if (text.length > 500) return null;

    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
    try {
        const url = new URL(hasScheme ? text : `https://${text}`);
        return url.protocol === "https:" && url.hostname.includes(".") ? url.href : null;
    } catch {
        return null;
    }
};

// Checks the submitted fields. Returns { error } or { values }, with only the fields that were sent.
const readFields = (body, { partial = false } = {}) => {
    const values = {};

    if (!partial || body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return { error: "Enter the subscription's name" };
        if (name.length > 100) return { error: "That name is too long" };
        values.name = name;
        values.merchantKey = normalizeMerchant(name) || name.toLowerCase();
    }

    if (!partial || body.amount !== undefined) {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0.01 || amount > 10000000) return { error: "Enter a price above 0" };
        values.amount = roundMoney(amount);
    }

    if (!partial || body.frequency !== undefined) {
        const frequency = body.frequency || "monthly";
        if (!CHARGES_PER_YEAR[frequency]) return { error: "Choose how often it charges" };
        values.frequency = frequency;
    }

    if (!partial || body.nextChargeDate !== undefined) {
        const date = parseDateOnly(body.nextChargeDate);
        if (!date) return { error: "Enter the next charge date" };
        values.nextChargeDate = date;
        values.billingDay = date.getUTCDate();
    }

    if (body.category !== undefined) values.category = normalizeCategoryName(body.category);

    if (body.remindDaysBefore !== undefined) {
        const days = Number(body.remindDaysBefore);
        if (!Number.isInteger(days) || days < 0 || days > 30) return { error: "Reminders can be 0 to 30 days before" };
        values.remindDaysBefore = days;
    }

    if (body.isTrial !== undefined) values.isTrial = body.isTrial === true;
    if (body.autoAddExpense !== undefined) values.autoAddExpense = body.autoAddExpense === true;

    if (body.manageUrl !== undefined) {
        const url = readWebsite(body.manageUrl);
        if (url === null) return { error: "Enter a website link, like udemy.com/settings or https://udemy.com" };
        values.manageUrl = url;
    }

    return { values };
};

const WEBSITE_NOT_FOUND = "We couldn't find that website. Check the spelling and try again.";

// Lets the page check a link before there's a saved subscription to attach it to
export const checkLink = async (req, res, next) => {
    try {
        const link = readWebsite(req.body.manageUrl);
        if (!link) {
            return res.status(400).json({
                success: false,
                message: "Enter a website link, like udemy.com/settings or https://udemy.com",
                status: 400,
            });
        }
        if (!(await websiteExists(link))) {
            return res.status(400).json({ success: false, message: WEBSITE_NOT_FOUND, status: 400 });
        }
        return res.status(200).json({ success: true, message: "Link added", manageUrl: link, status: 200 });
    } catch (err) {
        next(err);
    }
};

export const createSubscription = async (req, res, next) => {
    try {
        const { error, values } = readFields(req.body);
        if (error) return res.status(400).json({ success: false, message: error, status: 400 });

        if (values.category !== undefined && !(await isValidCategory(req.user._id, values.category))) {
            return res.status(400).json({ success: false, message: "Choose a valid category", status: 400 });
        }

        if (values.manageUrl && !(await websiteExists(values.manageUrl))) {
            return res.status(400).json({ success: false, message: WEBSITE_NOT_FOUND, status: 400 });
        }

        const count = await Subscription.countDocuments({ userId: req.user._id });
        if (count >= MAX_SUBSCRIPTIONS) {
            return res.status(400).json({
                success: false,
                message: `You can track up to ${MAX_SUBSCRIPTIONS} subscriptions`,
                status: 400,
            });
        }

        const subscription = await Subscription.create({
            ...values,
            userId: req.user._id,
            nextChargeDate: rollForwardToToday(values.nextChargeDate, values.frequency, values.billingDay),
        });

        logActivity(req, {
            action: "subscription.create",
            description: `Started tracking ${subscription.name}`,
            targetId: subscription._id,
            metadata: { name: subscription.name, amount: subscription.amount, frequency: subscription.frequency },
        });

        return res.status(201).json({
            success: true,
            message: `${subscription.name} added`,
            subscription,
            status: 201,
        });
    } catch (err) {
        next(err);
    }
};

export const updateSubscription = async (req, res, next) => {
    try {
        const subscription = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
        if (!subscription) return notFound(res);

        const { error, values } = readFields(req.body, { partial: true });
        if (error) return res.status(400).json({ success: false, message: error, status: 400 });

        if (values.category !== undefined && !(await isValidCategory(req.user._id, values.category))) {
            return res.status(400).json({ success: false, message: "Choose a valid category", status: 400 });
        }

        const linkChanged = values.manageUrl && values.manageUrl !== subscription.manageUrl;
        if (linkChanged && !(await websiteExists(values.manageUrl))) {
            return res.status(400).json({ success: false, message: WEBSITE_NOT_FOUND, status: 400 });
        }

        Object.assign(subscription, values);
        subscription.nextChargeDate = rollForwardToToday(subscription.nextChargeDate, subscription.frequency, subscription.billingDay);
        await subscription.save();

        return res.status(200).json({
            success: true,
            message: `${subscription.name} updated`,
            subscription,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Cancel / Reactivate / Delete
// ========================================

export const cancelSubscription = async (req, res, next) => {
    try {
        const subscription = await Subscription.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { status: "cancelled", cancelledAt: new Date() },
            { new: true }
        );
        if (!subscription) return notFound(res);

        logActivity(req, {
            action: "subscription.cancel",
            description: `Marked ${subscription.name} as cancelled`,
            targetId: subscription._id,
            metadata: { name: subscription.name },
        });

        return res.status(200).json({
            success: true,
            message: `${subscription.name} marked as cancelled`,
            subscription,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const reactivateSubscription = async (req, res, next) => {
    try {
        const subscription = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
        if (!subscription) return notFound(res);

        subscription.status = "active";
        subscription.cancelledAt = null;
        // dates missed while cancelled weren't charged, so they're skipped
        subscription.nextChargeDate = rollForwardToToday(subscription.nextChargeDate, subscription.frequency, subscription.billingDay);
        await subscription.save();

        return res.status(200).json({
            success: true,
            message: `${subscription.name} is active again`,
            subscription,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// Past expenses stay in Transactions; only the tracking is removed
export const deleteSubscription = async (req, res, next) => {
    try {
        const subscription = await Subscription.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!subscription) return notFound(res);

        logActivity(req, {
            action: "subscription.delete",
            description: `Stopped tracking ${subscription.name}`,
            targetId: subscription._id,
            metadata: { name: subscription.name },
        });

        return res.status(200).json({
            success: true,
            message: `${subscription.name} removed`,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Hide a Wrong Match / Show It Again
// ========================================

const readMerchantKey = (req, res) => {
    const { merchantKey } = req.body;
    if (typeof merchantKey !== "string" || !merchantKey.trim() || merchantKey.length > 200) {
        res.status(400).json({
            success: false,
            message: "merchantKey is required",
            status: 400,
        });
        return null;
    }
    return merchantKey;
};

export const dismissSubscription = async (req, res, next) => {
    try {
        const merchantKey = readMerchantKey(req, res);
        if (!merchantKey) return;

        await User.updateOne({ _id: req.user._id }, { $addToSet: { dismissedSubscriptions: merchantKey } });

        return res.status(200).json({
            success: true,
            message: "Hidden from your subscriptions",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const restoreSubscription = async (req, res, next) => {
    try {
        const merchantKey = readMerchantKey(req, res);
        if (!merchantKey) return;

        await User.updateOne({ _id: req.user._id }, { $pull: { dismissedSubscriptions: merchantKey } });

        return res.status(200).json({
            success: true,
            message: "Back in your subscriptions",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
