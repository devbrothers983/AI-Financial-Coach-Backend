import Budget from "../models/Budget.js";
import { toTitleCase } from "../utils/formatText.js";

import Transaction from "../models/Transaction.js";
import Goal from "../models/Goal.js";
import { calculateGoalPace } from "../utils/goalPace.js";

const normalizeCategories = (categories) =>
    Array.isArray(categories)
        ? categories.map((c) => ({ ...c, category: toTitleCase(c.category) }))
        : categories;

// ========================================
// Resolve/validate a linkedGoal value
// Returns undefined (leave untouched), null (unlink), or a valid goal id
// ========================================

const resolveLinkedGoal = async (linkedGoal, userId) => {
    if (linkedGoal === undefined) return undefined;
    if (linkedGoal === null || linkedGoal === "") return null;

    const goal = await Goal.findOne({ _id: linkedGoal, userId });

    if (!goal) {
        const error = new Error("Linked goal not found");
        error.statusCode = 400;
        throw error;
    }

    return goal._id;
};

// ========================================
// Sweep Completed Budgets
// For any past-month budget with a linked goal that hasn't
// been swept yet, roll its leftover (unspent) amount into
// that goal's currentAmount.
// ========================================

export const sweepCompletedBudgets = async (userId) => {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const candidates = await Budget.find({
        userId,
        swept: false,
        linkedGoal: { $ne: null },
        $or: [
            { year: { $lt: currentYear } },
            { year: currentYear, month: { $lt: currentMonth } },
        ],
    });

    const swept = [];

    for (const budget of candidates) {
        const startDate = new Date(Date.UTC(budget.year, budget.month - 1, 1));
        const endDate = new Date(Date.UTC(budget.year, budget.month, 1));

        const expenses = await Transaction.find({
            userId,
            transactionType: "expense",
            transactionDate: { $gte: startDate, $lt: endDate },
        });

        const totalSpent = expenses.reduce(
            (total, transaction) => total + transaction.transactionAmount,
            0
        );

        const leftover = budget.totalBudget - totalSpent;

        const goal = await Goal.findOne({
            _id: budget.linkedGoal,
            userId,
            status: "active",
        });

        if (goal) {
            // Pace required BEFORE this month's contribution is applied
            const pace = calculateGoalPace(goal);

            const amountToAdd =
                leftover > 0
                    ? Math.min(leftover, goal.targetAmount - goal.currentAmount)
                    : 0;

            if (amountToAdd > 0) {
                goal.currentAmount += amountToAdd;

                if (goal.currentAmount >= goal.targetAmount) {
                    goal.status = "completed";
                }

                await goal.save();
            }

            budget.sweptAmount = amountToAdd;

            // Only report a pace comparison while the goal still needs saving
            if (pace.requiredMonthlyPace > 0) {
                swept.push({
                    budgetId: budget._id,
                    month: budget.month,
                    year: budget.year,
                    goalId: goal._id,
                    goalTitle: goal.title,
                    amountAdded: amountToAdd,
                    requiredMonthlyPace: pace.requiredMonthlyPace,
                    onPace: amountToAdd >= pace.requiredMonthlyPace,
                });
            }
        }

        budget.swept = true;
        await budget.save();
    }

    return swept;
};


export const createBudget = async (req, res, next) => {
    try {

        const { month, year, totalBudget, categories, linkedGoal } = req.body;
        const userId = req.user._id;


        if (
            month == undefined ||
            year == undefined ||
            totalBudget == undefined

        ) {
            return res.status(400).json({
                success: false,
                message: "month, year, and totalBudget are required.",
                status: 400
            });

        }

        const existingBudget = await Budget.findOne({
            userId: userId,
            month,
            year,
        });

        if (existingBudget) {
            return res.status(409).json({
                success: false,
                message: "Budget already exists for this month and year.",
                status: 409
            });


        }

        const resolvedLinkedGoal = await resolveLinkedGoal(linkedGoal, userId);

        const budget = await Budget.create({
            userId,
            month,
            year,
            totalBudget,
            categories: normalizeCategories(categories),
            linkedGoal: resolvedLinkedGoal || null,
        });

        await budget.populate("linkedGoal", "title targetAmount currentAmount");

        return res.status(201).json({
            success: true,
            message: "Budget created successfully.",
            budget,
            status: 201,

        });


    } catch (err) {
        next(err)
    }
};

// Get ALL Budgets


export const getAllBudgets = async (req, res, next) => {
    try {

        const {
            year,
            page = 1,
            limit = 12,

        } = req.query;

        const sweptGoals = await sweepCompletedBudgets(req.user._id);

        const query = {
            userId: req.user._id,
        };


        if (year) {
            query.year = Number(year);
        }

        const pageNumber = Math.max(
            Number(page) || 1,
            1
        );

        const limitNumber = Math.min(
            Math.max(Number(limit) || 12, 1),
            100
        );

        const skip = (pageNumber - 1) * limitNumber;

        const budgets = await Budget
            .find(query)
            .populate("linkedGoal", "title targetAmount currentAmount")
            .sort({
                year: -1,
                month: -1,
            })
            .skip(skip)
            .limit(limitNumber);

        const totalBudgets = await Budget.countDocuments(query);

        const totalPages = Math.ceil(
            totalBudgets / limitNumber
        );


        return res.status(200).json({
            success: true,
            message: "Budget retrieved successfully.",

            count: budgets.length,
            pagination: {
                currentPage: pageNumber,
                totalPages,
                totalBudgets,
                limit: limitNumber
            },
            budgets,
            sweptGoals,
            status: 200,
        });





    } catch (err) {
        next(err)
    }

};





// ========================================
// Get Budget Progress
// ========================================

export const getBudgetProgress = async (req, res, next) => {
    try {

        const { id } = req.params;


        // ========================================
        // 1. Find Budget
        // ========================================

        const budget = await Budget.findOne({
            _id: id,
            userId: req.user._id,
        }).populate("linkedGoal", "title targetAmount currentAmount");


        if (!budget) {
            return res.status(404).json({
                success: false,
                message: "Budget not found",
                status: 404,
            });
        }


        // ========================================
        // 2. Create Start Date
        // ========================================

        const startDate = new Date(
            Date.UTC(
                budget.year,
                budget.month - 1,
                1
            )
        );


        // ========================================
        // 3. Create End Date
        // Start of next month
        // ========================================

        const endDate = new Date(
            Date.UTC(
                budget.year,
                budget.month,
                1
            )
        );


        // ========================================
        // 4. Get Expense Transactions
        // ========================================

        const expenses = await Transaction.find({
            userId: req.user._id,

            transactionType: "expense",

            transactionDate: {
                $gte: startDate,
                $lt: endDate,
            },
        });


        // ========================================
        // 5. Normalize Budget Categories
        // ========================================

        /*
            Example:

            Budget:
            "Food"
            "Transport"

            becomes:

            "food"
            "transport"
        */

        const budgetCategoryNames =
            budget.categories.map(
                (item) =>
                    item.category
                        .trim()
                        .toLowerCase()
            );


        // ========================================
        // 6. Keep Only Expenses That Belong
        // To This Budget
        // ========================================

        const budgetExpenses = expenses.filter(
            (transaction) => {

                const transactionCategory =
                    transaction.transactionCategory
                        .trim()
                        .toLowerCase();


                return budgetCategoryNames.includes(
                    transactionCategory
                );
            }
        );


        // ========================================
        // 7. Calculate Total Spending
        // ========================================

        const totalSpent =
            budgetExpenses.reduce(
                (total, transaction) => {

                    return (
                        total +
                        transaction.transactionAmount
                    );

                },
                0
            );


        // ========================================
        // 8. Calculate Category Progress
        // ========================================

        const categoryProgress =
            budget.categories.map(
                (budgetCategory) => {


                    // Normalize budget category
                    const normalizedBudgetCategory =
                        budgetCategory.category
                            .trim()
                            .toLowerCase();


                    // Find transactions belonging
                    // to this category
                    const categoryTransactions =
                        budgetExpenses.filter(
                            (transaction) => {

                                const normalizedTransactionCategory =
                                    transaction
                                        .transactionCategory
                                        .trim()
                                        .toLowerCase();


                                return (
                                    normalizedTransactionCategory ===
                                    normalizedBudgetCategory
                                );
                            }
                        );


                    // Calculate spending for category
                    const categorySpent =
                        categoryTransactions.reduce(
                            (total, transaction) => {

                                return (
                                    total +
                                    transaction.transactionAmount
                                );

                            },
                            0
                        );


                    // Calculate remaining amount
                    const remaining =
                        budgetCategory.limit -
                        categorySpent;


                    // Calculate percentage used
                    const percentageUsed =
                        budgetCategory.limit > 0
                            ? (
                                categorySpent /
                                budgetCategory.limit
                            ) * 100
                            : 0;


                    // ========================================
                    // Category Status
                    // ========================================

                    let status = "safe";


                    if (percentageUsed >= 100) {

                        status = "over_budget";

                    } else if (percentageUsed >= 80) {

                        status = "warning";

                    }


                    return {

                        category:
                            budgetCategory.category,

                        limit:
                            budgetCategory.limit,

                        spent:
                            categorySpent,

                        remaining,

                        percentageUsed:
                            Number(
                                percentageUsed.toFixed(2)
                            ),

                        status,
                    };
                }
            );


        // ========================================
        // 9. Overall Budget Calculations
        // ========================================

        const remainingBudget =
            budget.totalBudget - totalSpent;


        const overallPercentageUsed =
            budget.totalBudget > 0
                ? (
                    totalSpent /
                    budget.totalBudget
                ) * 100
                : 0;


        // ========================================
        // 10. Overall Budget Status
        // ========================================

        let overallStatus = "safe";


        if (overallPercentageUsed >= 100) {

            overallStatus = "over_budget";

        } else if (overallPercentageUsed >= 80) {

            overallStatus = "warning";

        }


        // ========================================
        // 11. Response
        // ========================================

        return res.status(200).json({

            success: true,

            message:
                "Budget progress retrieved successfully",

            budgetProgress: {

                budgetId:
                    budget._id,

                month:
                    budget.month,

                year:
                    budget.year,

                totalBudget:
                    budget.totalBudget,

                totalSpent,

                remainingBudget,

                percentageUsed:
                    Number(
                        overallPercentageUsed.toFixed(2)
                    ),

                status:
                    overallStatus,

                categories:
                    categoryProgress,

                linkedGoal:
                    budget.linkedGoal,

                swept:
                    budget.swept,

                sweptAmount:
                    budget.sweptAmount,
            },

            status: 200,
        });


    } catch (err) {

        next(err);

    }
};

// Get Budget By ID


export const getBudgetById = async (req, res, next) => {
    try {

        const { id } = req.params;

        const budget = await Budget.findOne({
            _id: id,
            userId: req.user._id,
        }).populate("linkedGoal", "title targetAmount currentAmount");

        if (!budget) {
            return res.status(404).json({
                success: false,
                message: "Budget not found.",
                status: 404,
            });

        }

        return res.status(200).json({
            success: true,
            message: "Budget retrieved successfully.",
            budget,
            status: 200,
        });



    } catch (err) {
        next(err)
    }
};


// Update Budget 

export const updateBudget = async (req, res, next) => {
    try {

        const { id } = req.params;

        const {
            month,
            year,
            totalBudget,
            categories,
            linkedGoal,
        } = req.body;


        const updateData = {};

        if (month !== undefined) {
            updateData.month = month;
        }

        if (year !== undefined) {
            updateData.year = year;
        }

        if (totalBudget !== undefined) {
            updateData.totalBudget = totalBudget;
        }

        if (categories !== undefined) {
            updateData.categories = normalizeCategories(categories);
        }

        if (linkedGoal !== undefined) {
            updateData.linkedGoal = await resolveLinkedGoal(linkedGoal, req.user._id);
        }

        const updatedBudget = await Budget.findOneAndUpdate(
            {
                _id: id,
                userId: req.user._id,
            },
            updateData,
            {
                new: true,
                runValidators: true,
            }
        ).populate("linkedGoal", "title targetAmount currentAmount");

        if (!updatedBudget) {
            return res.status(404).json({
                success: false,
                message: "Budget not found.",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Budget updated successfully.",
            updatedBudget,
            status: 200,
        });


    } catch (err) {
        next(err)
    }
};

// Delete Budget 

export const deleteBudget = async (req, res, next) => {
    try {

        const { id } = req.params;

        const deletedBudget = await Budget.findOneAndDelete({
            _id: id,
            userId: req.user._id,
        });

        if (!deletedBudget) {
            return res.status(404).json({
                success: false,
                message: "Budget not found.",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Budget deleted successfully.",
            deletedBudget,
            status: 200,
        });

    } catch (err) {
        next(err)
    }
};

// ========================================
// Check Expense Impact
// Preview what a not-yet-saved expense would do to this
// month's budget, category limit, and any linked goal —
// so the frontend can warn/confirm before it's actually added.
// ========================================

export const checkExpenseImpact = async (req, res, next) => {
    try {
        const { transactionAmount, transactionCategory, transactionDate, excludeTransactionId } = req.body;

        if (transactionAmount === undefined || transactionAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "transactionAmount is required and must be greater than 0",
                status: 400,
            });
        }

        const date = transactionDate ? new Date(transactionDate) : new Date();
        const month = date.getUTCMonth() + 1;
        const year = date.getUTCFullYear();

        const budget = await Budget.findOne({
            userId: req.user._id,
            month,
            year,
        }).populate("linkedGoal", "title targetAmount currentAmount createdAt targetDate status");

        if (!budget) {
            return res.status(200).json({
                success: true,
                message: "No budget set for this month",
                impact: { hasBudget: false, severity: "none" },
                status: 200,
            });
        }

        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 1));

        const expenses = await Transaction.find({
            userId: req.user._id,
            transactionType: "expense",
            transactionDate: { $gte: startDate, $lt: endDate },
            ...(excludeTransactionId ? { _id: { $ne: excludeTransactionId } } : {}),
        });

        const totalSpentBefore = expenses.reduce((sum, t) => sum + t.transactionAmount, 0);
        const totalSpentAfter = totalSpentBefore + Number(transactionAmount);

        const remainingBefore = budget.totalBudget - totalSpentBefore;
        const remainingAfter = budget.totalBudget - totalSpentAfter;

        const willExceedBudget = remainingAfter < 0;
        const budgetExceedByAmount = Math.max(-remainingAfter, 0);

        let category = null;

        if (transactionCategory) {
            const normalizedCategory = transactionCategory.trim().toLowerCase();
            const matchingLimit = budget.categories.find(
                (c) => c.category.trim().toLowerCase() === normalizedCategory
            );

            if (matchingLimit) {
                const categorySpentBefore = expenses
                    .filter((t) => t.transactionCategory.trim().toLowerCase() === normalizedCategory)
                    .reduce((sum, t) => sum + t.transactionAmount, 0);

                const categorySpentAfter = categorySpentBefore + Number(transactionAmount);
                const categoryRemainingAfter = matchingLimit.limit - categorySpentAfter;

                category = {
                    name: matchingLimit.category,
                    limit: matchingLimit.limit,
                    spentBefore: categorySpentBefore,
                    spentAfter: categorySpentAfter,
                    remainingAfter: categoryRemainingAfter,
                    willExceedLimit: categoryRemainingAfter < 0,
                    exceedByAmount: Math.max(-categoryRemainingAfter, 0),
                };
            }
        }

        let linkedGoal = null;

        if (budget.linkedGoal && budget.linkedGoal.status === "active") {
            const pace = calculateGoalPace(budget.linkedGoal);
            linkedGoal = {
                title: budget.linkedGoal.title,
                requiredMonthlyPace: pace.requiredMonthlyPace,
                remainingAmount: pace.remainingAmount,
            };
        }

        let severity = "none";

        if (category?.willExceedLimit) {
            severity = "category_over";
        } else if (willExceedBudget) {
            severity = "over_budget";
        } else if (budget.totalBudget > 0 && totalSpentAfter / budget.totalBudget >= 0.8) {
            severity = "warning";
        }

        return res.status(200).json({
            success: true,
            message: "Expense impact calculated successfully",
            impact: {
                hasBudget: true,
                totalBudget: budget.totalBudget,
                totalSpentBefore,
                totalSpentAfter,
                remainingBefore,
                remainingAfter,
                willExceedBudget,
                budgetExceedByAmount,
                category,
                linkedGoal,
                severity,
            },
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};