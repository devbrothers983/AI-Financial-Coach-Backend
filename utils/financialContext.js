import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Goal from "../models/Goal.js";
import Subscription from "../models/Subscription.js";
import { detectSubscriptions, merchantsMatch } from "./detectSubscriptions.js";
import { monthlyCostOf } from "./subscriptionDates.js";

// Calculates the figures the AI coach is allowed to talk about. The AI explains
// these numbers and never works them out itself. It gets no name, email, or
// account numbers: only amounts, dates, categories and merchant names.

const MONTHS_OF_HISTORY = 6;
const TOP_EXPENSES = 8;
const TOP_MERCHANTS = 8;

const round = (amount) => Math.round(amount * 100) / 100;

const monthLabel = (date) => date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const dateOnly = (date) => new Date(date).toISOString().slice(0, 10);

const monthStart = (year, month) => new Date(Date.UTC(year, month, 1));

const sumOf = (items) => round(items.reduce((sum, t) => sum + t.transactionAmount, 0));

const expensesOf = (items) => items.filter((t) => t.transactionType === "expense");

const incomeOf = (items) => items.filter((t) => t.transactionType === "income");

const totalsBy = (items, keyOf) => {
    const totals = new Map();
    for (const item of items) {
        const key = keyOf(item);
        totals.set(key, (totals.get(key) || 0) + item.transactionAmount);
    }
    return totals;
};

// Pure calculation, kept apart from the database so it can be tested
export const summarizeFinances = ({ transactions, budget, goals, subscriptions, detected, currency, now = new Date() }) => {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const dayOfMonth = now.getUTCDate();

    const thisStart = monthStart(year, month);
    const nextStart = monthStart(year, month + 1);
    const lastStart = monthStart(year, month - 1);

    const inRange = (start, end) => (t) => {
        const date = new Date(t.transactionDate);
        return date >= start && date < end;
    };

    const thisMonth = transactions.filter(inRange(thisStart, nextStart));
    const lastMonth = transactions.filter(inRange(lastStart, thisStart));

    // Last month up to the same day, for a fair comparison mid-month. A short
    // month stops at its last day.
    const lastMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const sameDayEnd = monthStart(year, month - 1);
    sameDayEnd.setUTCDate(Math.min(dayOfMonth, lastMonthDays) + 1);
    const lastMonthSoFar = lastMonth.filter(inRange(lastStart, sameDayEnd));

    const thisExpenses = expensesOf(thisMonth);
    const byCategory = totalsBy(thisExpenses, (t) => t.transactionCategory);
    const lastFullByCategory = totalsBy(expensesOf(lastMonth), (t) => t.transactionCategory);
    const lastSoFarByCategory = totalsBy(expensesOf(lastMonthSoFar), (t) => t.transactionCategory);
    const allCategories = new Set([...byCategory.keys(), ...lastSoFarByCategory.keys()]);

    const spentByBudgetCategory = totalsBy(thisExpenses, (t) => t.transactionCategory.trim().toLowerCase());

    const history = [];
    for (let i = 1; i <= MONTHS_OF_HISTORY; i += 1) {
        const start = monthStart(year, month - i);
        const items = transactions.filter(inRange(start, monthStart(year, month - i + 1)));
        if (items.length) {
            history.push({
                month: monthLabel(start),
                income: sumOf(incomeOf(items)),
                expenses: sumOf(expensesOf(items)),
            });
        }
    }

    const merchantTotals = totalsBy(
        thisExpenses.filter((t) => t.description),
        (t) => t.description
    );

    const trackedSubscriptions = subscriptions.map((s) => ({
        name: s.name,
        amount: s.amount,
        frequency: s.frequency,
        cost_per_month: monthlyCostOf(s.amount, s.frequency),
        next_charge: dateOnly(s.nextChargeDate),
    }));
    const foundSubscriptions = detected
        .filter((d) => d.isActive && !subscriptions.some((s) => merchantsMatch(d.merchantKey, s.merchantKey)))
        .map((d) => ({
            name: d.name,
            amount: d.amount,
            frequency: d.frequency,
            cost_per_month: d.monthlyCost,
            next_charge_estimate: dateOnly(d.nextChargeDate),
        }));
    const allSubscriptions = [...trackedSubscriptions, ...foundSubscriptions];

    return {
        today: dateOnly(now),
        currency,
        this_month: {
            month: monthLabel(thisStart),
            day_of_month: dayOfMonth,
            days_in_month: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
            income: sumOf(incomeOf(thisMonth)),
            expenses: sumOf(thisExpenses),
            net: round(sumOf(incomeOf(thisMonth)) - sumOf(thisExpenses)),
            expenses_by_same_day_last_month: sumOf(expensesOf(lastMonthSoFar)),
            categories: [...allCategories]
                .map((category) => ({
                    category,
                    spent: round(byCategory.get(category) || 0),
                    spent_by_same_day_last_month: round(lastSoFarByCategory.get(category) || 0),
                    spent_all_of_last_month: round(lastFullByCategory.get(category) || 0),
                }))
                .sort((a, b) => b.spent - a.spent),
            largest_expenses: [...thisExpenses]
                .sort((a, b) => b.transactionAmount - a.transactionAmount)
                .slice(0, TOP_EXPENSES)
                .map((t) => ({
                    description: t.description || "(no description)",
                    amount: t.transactionAmount,
                    category: t.transactionCategory,
                    date: dateOnly(t.transactionDate),
                })),
            top_merchants: [...merchantTotals.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, TOP_MERCHANTS)
                .map(([merchant, total]) => ({ merchant, total: round(total) })),
        },
        last_month: {
            month: monthLabel(lastStart),
            income: sumOf(incomeOf(lastMonth)),
            expenses: sumOf(expensesOf(lastMonth)),
        },
        previous_months: history,
        budget: budget
            ? {
                  total: budget.totalBudget,
                  spent: sumOf(thisExpenses),
                  remaining: round(budget.totalBudget - sumOf(thisExpenses)),
                  categories: (budget.categories || []).map((c) => {
                      const spent = round(spentByBudgetCategory.get(c.category.trim().toLowerCase()) || 0);
                      return { category: c.category, limit: c.limit, spent, remaining: round(c.limit - spent) };
                  }),
              }
            : null,
        goals: goals.map((g) => ({
            title: g.title,
            target: g.targetAmount,
            saved: g.currentAmount || 0,
            remaining: round(g.targetAmount - (g.currentAmount || 0)),
            target_date: dateOnly(g.targetDate),
            priority: g.priority,
        })),
        subscriptions: {
            cost_per_month: round(allSubscriptions.reduce((sum, s) => sum + s.cost_per_month, 0)),
            items: allSubscriptions,
        },
        has_any_transactions: transactions.length > 0,
    };
};

// Loads the user's data and summarizes it
export const buildFinancialContext = async (user, now = new Date()) => {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const since = monthStart(year, month - MONTHS_OF_HISTORY);

    const [transactions, budget, goals, subscriptions] = await Promise.all([
        Transaction.find({
            userId: user._id,
            transactionDate: { $gte: since },
            // a possible duplicate would count the same purchase twice
            possibleDuplicateOf: null,
        })
            .select("transactionType transactionAmount transactionCategory description transactionDate isRecurring recurringFrequency")
            .lean(),
        Budget.findOne({ userId: user._id, month: month + 1, year }).select("totalBudget categories").lean(),
        Goal.find({ userId: user._id, status: "active" }).select("title targetAmount currentAmount targetDate priority").lean(),
        Subscription.find({ userId: user._id, status: "active" }).select("name merchantKey amount frequency nextChargeDate").lean(),
    ]);

    return summarizeFinances({
        transactions,
        budget,
        goals,
        subscriptions,
        detected: detectSubscriptions(expensesOf(transactions), now),
        currency: user.currency || "USD",
        now,
    });
};
