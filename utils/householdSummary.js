// Works out the household's shared view for this month, respecting what each
// member chose to share. Kept apart from the database so it can be tested.

const RECENT_LIMIT = 20;

const round = (amount) => Math.round(amount * 100) / 100;

const sumOf = (items) => round(items.reduce((sum, t) => sum + t.transactionAmount, 0));

export const summarizeHousehold = ({ members, users, transactions }) => {
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const sharing = members.filter((m) => m.shareLevel !== "none");

    const perMember = sharing.map((m) => {
        const own = transactions.filter((t) => String(t.userId) === String(m.userId));
        const income = sumOf(own.filter((t) => t.transactionType === "income"));
        const spending = sumOf(own.filter((t) => t.transactionType === "expense"));
        return {
            userId: m.userId,
            name: userById.get(String(m.userId))?.username || "Member",
            currency: userById.get(String(m.userId))?.currency || "USD",
            shareLevel: m.shareLevel,
            income,
            spending,
            net: round(income - spending),
        };
    });

    // adding up different currencies would give a meaningless number
    const currencies = [...new Set(perMember.map((m) => m.currency))];
    const sameCurrency = currencies.length <= 1;

    // categories and individual transactions only come from members who chose to share them
    const detailedIds = new Set(sharing.filter((m) => m.shareLevel === "transactions").map((m) => String(m.userId)));
    const detailed = transactions.filter((t) => detailedIds.has(String(t.userId)));

    const categoryTotals = new Map();
    for (const t of detailed.filter((t) => t.transactionType === "expense")) {
        categoryTotals.set(t.transactionCategory, (categoryTotals.get(t.transactionCategory) || 0) + t.transactionAmount);
    }

    const totalIncome = round(perMember.reduce((sum, m) => sum + m.income, 0));
    const totalSpending = round(perMember.reduce((sum, m) => sum + m.spending, 0));

    return {
        currency: sameCurrency ? currencies[0] || "USD" : null,
        mixedCurrencies: !sameCurrency,
        sharingCount: sharing.length,
        memberCount: members.length,
        totals: sameCurrency ? { income: totalIncome, spending: totalSpending, net: round(totalIncome - totalSpending) } : null,
        perMember,
        categories: sameCurrency
            ? [...categoryTotals.entries()]
                  .map(([category, spent]) => ({ category, spent: round(spent) }))
                  .sort((a, b) => b.spent - a.spent)
            : [],
        recent: [...detailed]
            .sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate))
            .slice(0, RECENT_LIMIT)
            .map((t) => ({
                _id: t._id,
                memberName: userById.get(String(t.userId))?.username || "Member",
                description: t.description,
                transactionType: t.transactionType,
                amount: t.transactionAmount,
                category: t.transactionCategory,
                date: t.transactionDate,
                currency: userById.get(String(t.userId))?.currency || "USD",
            })),
    };
};
