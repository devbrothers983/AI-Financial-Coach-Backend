import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Goal from "../models/Goal.js";
import { sweepCompletedBudgets } from "./budgetController.js";


// ========================================
// Dashboard Overview
// ========================================

export const getDashboardOverview = async (
    req,
    res,
    next
) => {
    try {

        const userId =
            new mongoose.Types.ObjectId(req.user._id);


        // Roll any completed months' leftover budget into linked goals
        await sweepCompletedBudgets(req.user._id);


        // Current date
        const now = new Date();

        const currentMonth =
            now.getUTCMonth() + 1;

        const currentYear =
            now.getUTCFullYear();


        // ========================================
        // Start and End of Current Month
        // ========================================

        const startDate = new Date(
            Date.UTC(
                currentYear,
                currentMonth - 1,
                1
            )
        );


        const endDate = new Date(
            Date.UTC(
                currentYear,
                currentMonth,
                1
            )
        );


        // ========================================
        // Monthly Transaction Summary
        // ========================================

        const transactionSummary =
            await Transaction.aggregate([

                {
                    $match: {
                        userId,

                        transactionDate: {
                            $gte: startDate,
                            $lt: endDate,
                        },
                    },
                },

                {
                    $group: {

                        _id:
                            "$transactionType",

                        totalAmount: {
                            $sum:
                                "$transactionAmount",
                        },

                        count: {
                            $sum: 1,
                        },
                    },
                },

            ]);


        let totalIncome = 0;
        let totalExpenses = 0;


        transactionSummary.forEach(
            (item) => {

                if (item._id === "income") {
                    totalIncome =
                        item.totalAmount;
                }

                if (item._id === "expense") {
                    totalExpenses =
                        item.totalAmount;
                }
            }
        );


        const netCashFlow =
            totalIncome -
            totalExpenses;


        // ========================================
        // Current Month Budget
        // ========================================

        const budget =
            await Budget.findOne({
                userId: req.user._id,
                month: currentMonth,
                year: currentYear,
            });


        let budgetSummary = null;


        if (budget) {

            const totalBudget =
                budget.totalBudget;


            const remainingBudget =
                totalBudget -
                totalExpenses;


            const percentageUsed =
                totalBudget > 0
                    ? (
                        totalExpenses /
                        totalBudget
                    ) * 100
                    : 0;


            let status = "safe";


            if (percentageUsed >= 100) {

                status =
                    "over_budget";

            } else if (
                percentageUsed >= 80
            ) {

                status =
                    "warning";
            }


            budgetSummary = {

                budgetId:
                    budget._id,

                totalBudget,

                totalSpent:
                    totalExpenses,

                remainingBudget,

                percentageUsed:
                    Number(
                        percentageUsed
                            .toFixed(2)
                    ),

                status,
            };
        }


        // ========================================
        // Active Goals
        // ========================================

        const activeGoals =
            await Goal.find({
                userId:
                    req.user._id,

                status:
                    "active",
            })
                .sort({
                    priority: -1,
                    targetDate: 1,
                })
                .limit(5);


        // ========================================
        // Recent Transactions
        // ========================================

        const recentTransactions =
            await Transaction.find({
                userId:
                    req.user._id,
            })
                .sort({
                    transactionDate: -1,
                })
                .limit(5);


        // ========================================
        // Response
        // ========================================

        return res.status(200).json({

            success: true,

            message:
                "Dashboard overview retrieved successfully",

            dashboard: {

                period: {
                    month:
                        currentMonth,

                    year:
                        currentYear,
                },

                finances: {

                    totalIncome,

                    totalExpenses,

                    netCashFlow,

                },

                budget:
                    budgetSummary,

                activeGoals,

                recentTransactions,

            },

            status: 200,

        });


    } catch (err) {

        next(err);

    }
};


 

// ========================================
// Monthly Financial Trends
// Last 6 Months
// ========================================

export const getMonthlyTrends = async (
    req,
    res,
    next
) => {
    try {

        const userId =
            new mongoose.Types.ObjectId(req.user._id);


        // ========================================
        // 1. Calculate Date Range
        // ========================================

        const now = new Date();

        const currentYear =
            now.getUTCFullYear();

        const currentMonth =
            now.getUTCMonth();


        /*
            Example:

            Current month = September

            We want:

            April
            May
            June
            July
            August
            September
        */

        const startDate = new Date(
            Date.UTC(
                currentYear,
                currentMonth - 5,
                1
            )
        );


        const endDate = new Date(
            Date.UTC(
                currentYear,
                currentMonth + 1,
                1
            )
        );


        // ========================================
        // 2. Aggregate Transactions
        // ========================================

        const results =
            await Transaction.aggregate([

                {
                    $match: {

                        userId,

                        transactionDate: {
                            $gte: startDate,
                            $lt: endDate,
                        },

                    },
                },


                {
                    $group: {

                        _id: {

                            year: {
                                $year: "$transactionDate",
                            },

                            month: {
                                $month: "$transactionDate",
                            },

                            type:
                                "$transactionType",

                        },

                        totalAmount: {
                            $sum:
                                "$transactionAmount",
                        },

                    },
                },


                {
                    $sort: {
                        "_id.year": 1,
                        "_id.month": 1,
                    },
                },

            ]);


        // ========================================
        // 3. Create All 6 Months
        // ========================================

        const trends = [];


        for (let i = 5; i >= 0; i--) {

            const date = new Date(
                Date.UTC(
                    currentYear,
                    currentMonth - i,
                    1
                )
            );


            const year =
                date.getUTCFullYear();

            const month =
                date.getUTCMonth() + 1;


            const monthName =
                date.toLocaleString(
                    "en-US",
                    {
                        month: "short",
                        timeZone: "UTC",
                    }
                );


            // ========================================
            // Find income for this month
            // ========================================

            const incomeRecord =
                results.find(
                    (item) =>

                        item._id.year === year &&

                        item._id.month === month &&

                        item._id.type === "income"
                );


            // ========================================
            // Find expenses for this month
            // ========================================

            const expenseRecord =
                results.find(
                    (item) =>

                        item._id.year === year &&

                        item._id.month === month &&

                        item._id.type === "expense"
                );


            const income =
                incomeRecord
                    ? incomeRecord.totalAmount
                    : 0;


            const expenses =
                expenseRecord
                    ? expenseRecord.totalAmount
                    : 0;


            const netCashFlow =
                income - expenses;


            // ========================================
            // Savings Rate For This Month
            // ========================================

            const savingsRate =
                income > 0
                    ? (
                        netCashFlow /
                        income
                    ) * 100
                    : 0;


            trends.push({

                month,

                monthName,

                year,

                income,

                expenses,

                netCashFlow,

                savingsRate:
                    Number(
                        savingsRate.toFixed(2)
                    ),

            });

        }


        // ========================================
        // 4. Return Response
        // ========================================

        return res.status(200).json({

            success: true,

            message:
                "Monthly trends retrieved successfully",

            months:
                trends.length,

            trends,

            status: 200,

        });


    } catch (err) {

        next(err);

    }
};



// ========================================
// Current Month Savings Rate
// ========================================

export const getSavingsRate = async (
    req,
    res,
    next
) => {

    try {

        const userId =
            new mongoose.Types.ObjectId(req.user._id);


        // ========================================
        // 1. Current Month
        // ========================================

        const now = new Date();


        const currentYear =
            now.getUTCFullYear();


        const currentMonth =
            now.getUTCMonth() + 1;


        // ========================================
        // 2. Month Date Range
        // ========================================

        const startDate = new Date(
            Date.UTC(
                currentYear,
                currentMonth - 1,
                1
            )
        );


        const endDate = new Date(
            Date.UTC(
                currentYear,
                currentMonth,
                1
            )
        );


        // ========================================
        // 3. Calculate Income + Expenses
        // ========================================

        const summary =
            await Transaction.aggregate([

                {
                    $match: {

                        userId,

                        transactionDate: {
                            $gte: startDate,
                            $lt: endDate,
                        },

                    },
                },


                {
                    $group: {

                        _id:
                            "$transactionType",

                        totalAmount: {
                            $sum:
                                "$transactionAmount",
                        },

                    },
                },

            ]);


        // ========================================
        // 4. Extract Income and Expenses
        // ========================================

        let totalIncome = 0;

        let totalExpenses = 0;


        summary.forEach(
            (item) => {

                if (item._id === "income") {

                    totalIncome =
                        item.totalAmount;

                }


                if (item._id === "expense") {

                    totalExpenses =
                        item.totalAmount;

                }

            }
        );


        // ========================================
        // 5. Calculate Savings
        // ========================================

        const netSavings =
            totalIncome -
            totalExpenses;


        // ========================================
        // 6. Savings Rate
        // ========================================

        const savingsRate =
            totalIncome > 0
                ? (
                    netSavings /
                    totalIncome
                ) * 100
                : 0;


        // ========================================
        // 7. Simple Status
        // ========================================

        let status = "low";


        if (savingsRate >= 20) {

            status = "good";

        } else if (savingsRate >= 10) {

            status = "moderate";

        }


        if (savingsRate < 0) {

            status = "negative";

        }


        // ========================================
        // 8. Response
        // ========================================

        return res.status(200).json({

            success: true,

            message:
                "Savings rate retrieved successfully",

            savings: {

                month:
                    currentMonth,

                year:
                    currentYear,

                totalIncome,

                totalExpenses,

                netSavings,

                savingsRate:
                    Number(
                        savingsRate.toFixed(2)
                    ),

                status,

            },

            status: 200,

        });


    } catch (err) {

        next(err);

    }
};