import mongoose from "mongoose";

import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Goal from "../models/Goal.js";
import { logActivity } from "../utils/activityLogger.js";
import { aiServiceHeaders, aiServiceUrl, describeAiFailure } from "../utils/aiService.js";


// ========================================
// AI Purchase Affordability
// ========================================
// The numbers (budget left after buying, daily allowance, goal delay) are all
// worked out here, so they are exact. The AI only explains them, and a rule
// stops it from calling a purchase "affordable" when the numbers say otherwise.

const SEVERITY = ["AFFORDABLE", "CAUTION", "NOT_RECOMMENDED"];
const RISK_FOR = { AFFORDABLE: "LOW", CAUTION: "MEDIUM", NOT_RECOMMENDED: "HIGH" };
const WEEKS_PER_MONTH = 4.345;

const round = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

const sumByType = (rows) => {
    const totals = { income: 0, expense: 0 };
    rows.forEach((r) => {
        if (r._id in totals) totals[r._id] = r.total;
    });
    return totals;
};

// Average income and spending over the last 3 complete months that have any
// data. This month alone is misleading before payday, when income is still 0.
const getTypicalMonth = async (userId, monthStart) => {
    const from = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 3, 1));

    const rows = await Transaction.aggregate([
        { $match: { userId, transactionDate: { $gte: from, $lt: monthStart } } },
        {
            $group: {
                _id: { y: { $year: "$transactionDate" }, m: { $month: "$transactionDate" }, t: "$transactionType" },
                total: { $sum: "$transactionAmount" },
            },
        },
    ]);

    const months = new Map();
    rows.forEach((r) => {
        const key = `${r._id.y}-${r._id.m}`;
        const month = months.get(key) || { income: 0, expense: 0 };
        if (r._id.t in month) month[r._id.t] += r.total;
        months.set(key, month);
    });

    if (months.size === 0) return null;

    const list = [...months.values()];
    const income = list.reduce((s, m) => s + m.income, 0) / list.length;
    const expenses = list.reduce((s, m) => s + m.expense, 0) / list.length;
    return { income, expenses, savings: income - expenses, monthsUsed: list.length };
};

// The least cautious answer the numbers allow
const minimumVerdict = ({ price, budgetRemaining, netCashFlow, typicalSavings }) => {
    const canSave = typicalSavings ?? netCashFlow;

    if (budgetRemaining !== null) {
        const budgetAfter = budgetRemaining - price;
        if (budgetAfter < 0 && price > Math.max(canSave, 0)) return "NOT_RECOMMENDED";
        if (budgetAfter < 0) return "CAUTION";
        // it fits, but leaves almost nothing for the rest of the month
        if (budgetAfter < budgetRemaining * 0.2) return "CAUTION";
    } else if (price > Math.max(canSave, 0)) {
        return canSave > 0 && price <= canSave * 2 ? "CAUTION" : "NOT_RECOMMENDED";
    }

    return "AFFORDABLE";
};

export const checkAffordability = async (req, res, next) => {
    try {
        const purchaseName = typeof req.body.purchaseName === "string" ? req.body.purchaseName.trim() : "";
        const purchasePrice = Number(req.body.purchasePrice);
        const reason = typeof req.body.reason === "string" ? req.body.reason.trim().slice(0, 300) : "";

        if (!purchaseName || purchaseName.length > 100) {
            return res.status(400).json({ success: false, message: "Tell us what you want to buy (up to 100 characters)", status: 400 });
        }

        if (!Number.isFinite(purchasePrice) || purchasePrice <= 0 || purchasePrice > 10_000_000) {
            return res.status(400).json({ success: false, message: "Enter a price greater than 0", status: 400 });
        }

        const price = round(purchasePrice);
        const userId = new mongoose.Types.ObjectId(req.user._id);
        const currency = req.user.currency || "USD";


        // ========================================
        // 1. This month so far
        // ========================================

        const now = new Date();
        const currentMonth = now.getUTCMonth() + 1;
        const currentYear = now.getUTCFullYear();
        const startDate = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
        const endDate = new Date(Date.UTC(currentYear, currentMonth, 1));
        const daysInMonth = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
        const daysLeft = daysInMonth - now.getUTCDate() + 1; // today still counts

        const [summary, budget, goals, typical] = await Promise.all([
            Transaction.aggregate([
                { $match: { userId, transactionDate: { $gte: startDate, $lt: endDate } } },
                { $group: { _id: "$transactionType", total: { $sum: "$transactionAmount" } } },
            ]),
            Budget.findOne({ userId: req.user._id, month: currentMonth, year: currentYear }).lean(),
            Goal.find({ userId: req.user._id, status: "active" }).sort({ targetDate: 1 }).lean(),
            getTypicalMonth(userId, startDate),
        ]);

        const totals = sumByType(summary);
        const monthlyIncome = totals.income;
        const monthlyExpenses = totals.expense;
        const netCashFlow = monthlyIncome - monthlyExpenses;
        const savingsRate = monthlyIncome > 0 ? (netCashFlow / monthlyIncome) * 100 : 0;


        // ========================================
        // 2. Effect on this month's budget
        // ========================================

        let budgetImpact = null;
        if (budget && budget.totalBudget > 0) {
            const remainingBefore = budget.totalBudget - monthlyExpenses;
            const remainingAfter = remainingBefore - price;

            budgetImpact = {
                totalBudget: budget.totalBudget,
                remainingBefore: round(remainingBefore),
                remainingAfter: round(remainingAfter),
                percentUsedBefore: round((monthlyExpenses / budget.totalBudget) * 100),
                percentUsedAfter: round(((monthlyExpenses + price) / budget.totalBudget) * 100),
                dailyBefore: round(Math.max(remainingBefore, 0) / daysLeft),
                dailyAfter: round(Math.max(remainingAfter, 0) / daysLeft),
                daysLeft,
            };
        }


        // ========================================
        // 3. Effect on savings goals
        // ========================================

        const typicalSavings = typical ? typical.savings : null;
        const monthlySaving = typicalSavings ?? (netCashFlow > 0 ? netCashFlow : null);

        // how much later the goals finish if this money came out of savings
        const delayWeeks = monthlySaving > 0 ? round((price / monthlySaving) * WEEKS_PER_MONTH) : null;

        const formattedGoals = goals.map((goal) => ({
            title: goal.title,
            target_amount: goal.targetAmount,
            current_amount: goal.currentAmount,
            remaining_amount: Math.max(goal.targetAmount - goal.currentAmount, 0),
            priority: goal.priority,
            target_date: goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null,
        }));

        const topGoal =
            goals.find((g) => g.priority === "high") || goals[0] || null;

        const goalImpact = topGoal
            ? {
                title: topGoal.title,
                remaining: round(Math.max(topGoal.targetAmount - topGoal.currentAmount, 0)),
                delayWeeks,
                notSaving: !(monthlySaving > 0),
            }
            : null;


        // ========================================
        // 4. The least cautious answer allowed
        // ========================================

        const floor = minimumVerdict({
            price,
            budgetRemaining: budgetImpact ? budgetImpact.remainingBefore : null,
            netCashFlow,
            typicalSavings,
        });


        // ========================================
        // 5. Ask the AI to explain it
        // ========================================

        const aiPayload = {
            purchase_name: purchaseName,
            purchase_price: price,
            reason: reason || null,
            currency,

            monthly_income: monthlyIncome,
            monthly_expenses: monthlyExpenses,
            net_cash_flow: netCashFlow,
            savings_rate: round(savingsRate),
            days_left_in_month: daysLeft,

            total_budget: budgetImpact?.totalBudget ?? null,
            budget_remaining: budgetImpact?.remainingBefore ?? null,
            budget_after_purchase: budgetImpact?.remainingAfter ?? null,
            daily_allowance_before: budgetImpact?.dailyBefore ?? null,
            daily_allowance_after: budgetImpact?.dailyAfter ?? null,

            typical_monthly_income: typical ? round(typical.income) : null,
            typical_monthly_savings: typical ? round(typical.savings) : null,
            goal_delay_weeks: delayWeeks,

            minimum_recommendation: floor,
            goals: formattedGoals,
        };

        let aiResult;
        try {
            const aiResponse = await fetch(aiServiceUrl("/ai/affordability"), {
                method: "POST",
                headers: aiServiceHeaders(),
                body: JSON.stringify(aiPayload),
                signal: AbortSignal.timeout(60000),
            });

            if (!aiResponse.ok) {
                console.error(`Affordability AI error ${aiResponse.status}:`, (await aiResponse.text()).slice(0, 500));
                throw new Error(`status ${aiResponse.status}`);
            }

            aiResult = await aiResponse.json();
        } catch (err) {
            console.error(`Affordability check failed: ${describeAiFailure(err)}`);
            return res.status(502).json({
                success: false,
                message: "The AI coach couldn't answer right now. Please try again in a minute.",
                status: 502,
            });
        }

        // never softer than the numbers allow
        if (SEVERITY.indexOf(aiResult.recommendation) < SEVERITY.indexOf(floor)) {
            aiResult.recommendation = floor;
            aiResult.risk_level = RISK_FOR[floor];
        }

        // counted in the admin overview's AI coach usage chart
        logActivity(req, {
            action: "coach.ask",
            description: `Asked the AI coach about "${purchaseName}" (${price})`,
            metadata: { purchaseName, purchasePrice: price, recommendation: aiResult.recommendation },
        });

        return res.status(200).json({
            success: true,
            message: "Affordability analysis completed successfully",
            purchase: { name: purchaseName, price, reason: reason || null },
            currency,
            financialContext: {
                monthlyIncome,
                monthlyExpenses,
                netCashFlow,
                savingsRate: round(savingsRate),
                totalBudget: budgetImpact?.totalBudget ?? null,
                budgetRemaining: budgetImpact?.remainingBefore ?? null,
                activeGoals: formattedGoals.length,
                typicalMonthlySavings: typical ? round(typical.savings) : null,
            },
            budgetImpact,
            goalImpact,
            analysis: aiResult,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
