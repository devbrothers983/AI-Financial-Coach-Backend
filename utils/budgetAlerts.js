import Budget from "../models/Budget.js";
import Transaction from "../models/Transaction.js";
import { notify } from "./notify.js";
import { sendMail } from "./mailer.js";

const THRESHOLDS = [100, 80];

const money = (amount, currency = "USD") => {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
        return `${currency} ${Number(amount).toFixed(2)}`;
    }
};

const monthLabel = (month, year) =>
    new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// Checks the user's budget for the month containing `date` and sends an
// alert the first time total spending, or any category, reaches 80% or 100%.
// Safe to call after any expense or budget change; errors are only logged.
export const checkBudgetAlerts = async (user, date = new Date()) => {
    try {
        const when = new Date(date);
        const month = when.getUTCMonth() + 1;
        const year = when.getUTCFullYear();

        const budget = await Budget.findOne({ userId: user._id, month, year }).lean();
        if (!budget) return;

        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 1));

        const spending = await Transaction.aggregate([
            {
                $match: {
                    userId: user._id,
                    transactionType: "expense",
                    transactionDate: { $gte: startDate, $lt: endDate },
                },
            },
            { $group: { _id: { $toLower: "$transactionCategory" }, total: { $sum: "$transactionAmount" } } },
        ]);

        const spentByCategory = Object.fromEntries(spending.map((s) => [s._id, s.total]));
        const totalSpent = spending.reduce((sum, s) => sum + s.total, 0);

        const checks = [
            { key: "total", label: "monthly budget", limit: budget.totalBudget, spent: totalSpent },
            ...(budget.categories || []).map((c) => ({
                key: c.category.trim().toLowerCase(),
                label: `${c.category} budget`,
                limit: c.limit,
                spent: spentByCategory[c.category.trim().toLowerCase()] || 0,
            })),
        ];

        const currency = user.currency || "USD";
        const period = monthLabel(month, year);

        for (const check of checks) {
            if (!check.limit || check.limit <= 0) continue;

            const percent = Math.round((check.spent / check.limit) * 100);
            const threshold = THRESHOLDS.find((t) => percent >= t);
            if (!threshold) continue;

            const over = threshold === 100;
            const title = over
                ? `You've gone over your ${check.label}`
                : `You've used ${percent}% of your ${check.label}`;
            const body = `${money(check.spent, currency)} spent of ${money(check.limit, currency)} for ${period}.${
                over ? ` That's ${money(check.spent - check.limit, currency)} over.` : ""
            }`;

            const created = await notify(user._id, {
                type: "budget_alert",
                level: over ? "danger" : "warning",
                title,
                body,
                link: "/dashboard/budgets",
                dedupeKey: `budget:${budget._id}:${check.key}:${threshold}`,
                metadata: { budgetId: budget._id, category: check.key, percent, threshold },
            });

            // email only for going over, and only the first time
            if (created && over && user.email) {
                sendMail({
                    to: user.email,
                    subject: `Budget alert: ${title}`,
                    text: `Hi ${user.username},\n\n${title}.\n${body}\n\nReview your budget in AI Financial Coach.`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                            <h2 style="color: #dc2626;">${title}</h2>
                            <p>Hi ${user.username},</p>
                            <p>${body}</p>
                            <p>Open AI Financial Coach to review your spending and budget.</p>
                        </div>
                    `,
                }).catch((err) => console.error("Budget alert email failed:", err.message));
            }
        }
    } catch (err) {
        console.error("Budget alert check failed:", err.message);
    }
};
