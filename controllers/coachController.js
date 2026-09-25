import mongoose from "mongoose";

import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Goal from "../models/Goal.js";


// ========================================
// AI Purchase Affordability
// ========================================

export const checkAffordability = async (
    req,
    res,
    next
) => {

    try {

        const {
            purchaseName,
            purchasePrice,
            reason,
        } = req.body;


        // ========================================
        // 1. Validate Purchase Input
        // ========================================

        if (
            !purchaseName ||
            purchasePrice === undefined
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "purchaseName and purchasePrice are required",
                status: 400,
            });
        }


        if (purchasePrice <= 0) {
            return res.status(400).json({
                success: false,
                message:
                    "purchasePrice must be greater than 0",
                status: 400,
            });
        }


        const userId =
            new mongoose.Types.ObjectId(
                req.user._id
            );


        // ========================================
        // 2. Current Month
        // ========================================

        const now = new Date();

        const currentMonth =
            now.getUTCMonth() + 1;

        const currentYear =
            now.getUTCFullYear();


        const startDate =
            new Date(
                Date.UTC(
                    currentYear,
                    currentMonth - 1,
                    1
                )
            );


        const endDate =
            new Date(
                Date.UTC(
                    currentYear,
                    currentMonth,
                    1
                )
            );


        // ========================================
        // 3. Transaction Summary
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

                    },
                },

            ]);


        let monthlyIncome = 0;

        let monthlyExpenses = 0;


        transactionSummary.forEach(
            (item) => {

                if (
                    item._id === "income"
                ) {

                    monthlyIncome =
                        item.totalAmount;

                }


                if (
                    item._id === "expense"
                ) {

                    monthlyExpenses =
                        item.totalAmount;

                }

            }
        );


        // ========================================
        // 4. Net Cash Flow
        // ========================================

        const netCashFlow =
            monthlyIncome -
            monthlyExpenses;


        // ========================================
        // 5. Savings Rate
        // ========================================

        const savingsRate =
            monthlyIncome > 0
                ? (
                    netCashFlow /
                    monthlyIncome
                ) * 100
                : 0;


        // ========================================
        // 6. Find Current Budget
        // ========================================

        const budget =
            await Budget.findOne({
                userId: req.user._id,
                month: currentMonth,
                year: currentYear,
            });


        let totalBudget = null;

        let budgetRemaining = null;


        if (budget) {

            totalBudget =
                budget.totalBudget;


            // Same definition used by the dashboard and the
            // budget sweep: ALL expenses this month against the
            // total budget, not just categories with a set limit.
            // (A budget with no per-category limits — the
            // default — has an empty categories array, so
            // filtering by category here would always report
            // budgetSpent as 0 even after the budget was fully
            // used.)

            budgetRemaining =
                totalBudget -
                monthlyExpenses;
        }


        // ========================================
        // 7. Get Active Goals
        // ========================================

        const goals =
            await Goal.find({

                userId:
                    req.user._id,

                status:
                    "active",

            })
                .sort({
                    targetDate: 1,
                });


        // ========================================
        // 8. Format Goals For FastAPI
        // ========================================

        const formattedGoals =
            goals.map(
                (goal) => {

                    const remainingAmount =
                        Math.max(
                            goal.targetAmount -
                            goal.currentAmount,
                            0
                        );


                    return {

                        title:
                            goal.title,

                        target_amount:
                            goal.targetAmount,

                        current_amount:
                            goal.currentAmount,

                        remaining_amount:
                            remainingAmount,

                        priority:
                            goal.priority,

                    };

                }
            );


        // ========================================
        // 9. Build FastAPI Request
        // ========================================

        const aiPayload = {

            purchase_name:
                purchaseName,

            purchase_price:
                purchasePrice,

            reason:
                reason || null,

            monthly_income:
                monthlyIncome,

            monthly_expenses:
                monthlyExpenses,

            net_cash_flow:
                netCashFlow,

            total_budget:
                totalBudget,

            budget_remaining:
                budgetRemaining,

            savings_rate:
                Number(
                    savingsRate.toFixed(2)
                ),

            goals:
                formattedGoals,

        };


        // ========================================
        // 10. Call FastAPI
        // ========================================

        const aiResponse =
            await fetch(
                `${process.env.AI_SERVICE_URL}/ai/affordability`,
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json",
                    },

                    body:
                        JSON.stringify(
                            aiPayload
                        ),
                }
            );


        // ========================================
        // 11. Handle FastAPI Error
        // ========================================

        if (!aiResponse.ok) {

            const errorText =
                await aiResponse.text();


            console.error(
                "AI Service Error:",
                errorText
            );


            return res.status(502).json({

                success: false,

                message:
                    "AI service failed to analyze affordability",

                status: 502,

            });
        }


        // ========================================
        // 12. Get AI Response
        // ========================================

        const aiResult =
            await aiResponse.json();


        // ========================================
        // 13. Send Final Response
        // ========================================

        return res.status(200).json({

            success: true,

            message:
                "Affordability analysis completed successfully",

            purchase: {

                name:
                    purchaseName,

                price:
                    purchasePrice,

                reason:
                    reason || null,

            },

            financialContext: {

                monthlyIncome,

                monthlyExpenses,

                netCashFlow,

                savingsRate:
                    Number(
                        savingsRate.toFixed(2)
                    ),

                totalBudget,

                budgetRemaining,

                activeGoals:
                    formattedGoals.length,

            },

            analysis:
                aiResult,

            status: 200,

        });


    } catch (err) {

        next(err);

    }
};