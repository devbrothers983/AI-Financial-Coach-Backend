import Transaction from "../models/Transaction.js";

// ========================================
// Budget Pace Warning
// ========================================
// Compares how much of the month's budget is gone with how much of the month
// is gone. Spending 70% of the budget by the 10th is a problem even though the
// budget isn't used up yet, so this warns early, while there's still time to
// slow down, and names the category the user can cut back on most easily.

// Bills that can't simply be "bought less" this month
const FIXED_CATEGORIES = new Set([
    "rent", "housing", "mortgage", "utilities", "bills", "insurance",
    "loan", "loans", "debt", "taxes", "tax", "childcare", "education", "transfer",
]);

// Projections from the first few days are mostly noise (rent on the 1st
// would look like a disaster), so pace is only judged after this day.
const PACE_START_DAY = 5;

const round = (n) => Math.round(n * 100) / 100;

export const getBudgetPace = async ({ userId, budget, totalSpent, now = new Date() }) => {
    if (!budget || !(budget.totalBudget > 0)) return null;

    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    if (budget.month !== month || budget.year !== year) return null;

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = now.getUTCDate();
    const daysLeft = daysInMonth - day + 1; // today still counts

    const limit = budget.totalBudget;
    const remaining = limit - totalSpent;
    const percentUsed = (totalSpent / limit) * 100;
    const percentOfMonth = (day / daysInMonth) * 100;
    const projected = (totalSpent / day) * daysInMonth;
    const judgePace = day >= PACE_START_DAY;

    let level = null;
    if (remaining < 0) level = "over";
    else if (percentUsed >= 90 || (judgePace && projected >= limit * 1.15)) level = "danger";
    else if (percentUsed >= 80 || (judgePace && percentUsed > percentOfMonth + 10 && projected > limit)) level = "warning";

    if (!level) return null;

    // ---- Which category to cut back on ----
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));
    const spending = await Transaction.aggregate([
        {
            $match: {
                userId,
                transactionType: "expense",
                transactionDate: { $gte: startDate, $lt: endDate },
            },
        },
        { $group: { _id: "$transactionCategory", total: { $sum: "$transactionAmount" } } },
        { $sort: { total: -1 } },
    ]);

    const limits = new Map(
        (budget.categories || []).map((c) => [c.category.trim().toLowerCase(), c.limit])
    );

    // 1) a category with its own limit that is furthest ahead of the month
    let focus = null;
    for (const s of spending) {
        const name = (s._id || "Other").trim();
        const catLimit = limits.get(name.toLowerCase());
        if (!(catLimit > 0)) continue;
        const catPercent = (s.total / catLimit) * 100;
        const ahead = catPercent - percentOfMonth;
        if (ahead > 10 && (!focus || ahead > focus.ahead)) {
            focus = { name, spent: s.total, limit: catLimit, ahead, percent: catPercent };
        }
    }

    // 2) otherwise the biggest category the user can actually spend less on
    if (!focus) {
        const flexible = spending.find((s) => !FIXED_CATEGORIES.has((s._id || "").trim().toLowerCase()));
        if (flexible) focus = { name: (flexible._id || "Other").trim(), spent: flexible.total, limit: null };
    }

    return {
        level,
        daysLeft,
        daysInMonth,
        remaining: round(remaining),
        percentUsed: round(percentUsed),
        percentOfMonth: round(percentOfMonth),
        projected: judgePace ? round(projected) : null,
        projectedOver: judgePace ? round(Math.max(projected - limit, 0)) : null,
        dailyAllowance: remaining > 0 ? round(remaining / daysLeft) : 0,
        focusCategory: focus
            ? {
                name: focus.name,
                spent: round(focus.spent),
                limit: focus.limit,
                share: totalSpent > 0 ? Math.round((focus.spent / totalSpent) * 100) : 0,
                overLimit: focus.limit ? focus.spent > focus.limit : false,
            }
            : null,
    };
};
