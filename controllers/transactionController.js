import Transaction from "../models/Transaction.js";
import { toTitleCase } from "../utils/formatText.js";

import mongoose from "mongoose";
// ========================================
// Create Transaction
// ========================================

export const createTransaction = async (req, res, next) => {
    try {

        const {
            transactionType,
            transactionAmount,
            transactionCategory,
            description,
            transactionDate,
            paymentMethod,
            isRecurring,
            recurringFrequency,
            transactionNotes,
        } = req.body;


        // Validate required fields
        if (
            !transactionType ||
            transactionAmount === undefined ||
            transactionAmount === null ||
            !transactionCategory
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "transactionType, transactionAmount, and transactionCategory are required",
                status: 400,
            });
        }


        // Create transaction
        const transaction = await Transaction.create({
            userId: req.user._id,

            transactionType,
            transactionAmount,
            transactionCategory,
            description: description ? toTitleCase(description) : description,
            transactionDate,
            paymentMethod,
            isRecurring,
            recurringFrequency,
            transactionNotes,
        });


        return res.status(201).json({
            success: true,
            message: "Transaction created successfully",
            transaction,
            status: 201,
        });

    } catch (err) {
        next(err);
    }
};



// ========================================
// Get All Transactions
// Filtering + Pagination + Sorting
// ========================================

export const getALLTransactions = async (req, res, next) => {
    try {

        const {
            transactionType,
            transactionCategory,
            startDate,
            endDate,
            page = 1,
            limit = 10,
            sort = "newest",
        } = req.query;


        // Always restrict transactions to logged-in user
        const query = {
            userId: req.user._id,
        };


        // Filter by transaction type
        if (transactionType) {
            query.transactionType = transactionType;
        }


        // Filter by category
        if (transactionCategory) {
            query.transactionCategory = transactionCategory;
        }


        // Filter by transaction date
        if (startDate || endDate) {

            query.transactionDate = {};


            if (startDate) {
                query.transactionDate.$gte =
                    new Date(startDate);
            }


            if (endDate) {

                // Convert end date to next day so the entire
                // endDate is included
                const nextDay = new Date(endDate);

                nextDay.setUTCDate(
                    nextDay.getUTCDate() + 1
                );

                query.transactionDate.$lt = nextDay;
            }
        }


        // Pagination
        const pageNumber = Math.max(
            Number(page) || 1,
            1
        );

        const limitNumber = Math.min(
            Math.max(Number(limit) || 10, 1),
            100
        );

        const skip =
            (pageNumber - 1) * limitNumber;


        // Sorting
        const sortOption =
            sort === "oldest"
                ? { transactionDate: 1 }
                : { transactionDate: -1 };


        // Get transactions
        const transactions = await Transaction
            .find(query)
            .sort(sortOption)
            .skip(skip)
            .limit(limitNumber);


        // Count matching transactions
        const totalTransactions =
            await Transaction.countDocuments(query);


        const totalPages = Math.ceil(
            totalTransactions / limitNumber
        );


        return res.status(200).json({

            success: true,

            message:
                "Transactions retrieved successfully",

            count: transactions.length,

            pagination: {
                currentPage: pageNumber,
                totalPages,
                totalTransactions,
                limit: limitNumber,
            },

            transactions,

            status: 200,
        });


    } catch (err) {
        next(err);
    }
};


// Get transaction summary
export const getTransactionSummary = async (req, res, next) => {
    try {

        const userId =
            new mongoose.Types.ObjectId(req.user._id);

        const summary = await Transaction.aggregate([
            {
                $match: {
                    userId: userId,
                },
            },

            {
                $group: {
                    _id: "$transactionType",

                    totalAmount: {
                        $sum: "$transactionAmount",
                    },

                    transactionCount: {
                        $sum: 1,
                    },
                },
            },
        ]);


        let totalIncome = 0;
        let totalExpenses = 0;

        let incomeTransactionCount = 0;
        let expenseTransactionCount = 0;


        summary.forEach((item) => {

            if (item._id === "income") {
                totalIncome = item.totalAmount;
                incomeTransactionCount =
                    item.transactionCount;
            }

            if (item._id === "expense") {
                totalExpenses = item.totalAmount;
                expenseTransactionCount =
                    item.transactionCount;
            }
        });


        const netCashFlow =
            totalIncome - totalExpenses;


        return res.status(200).json({
            success: true,

            message:
                "Transaction summary retrieved successfully",

            summary: {
                totalIncome,
                totalExpenses,
                netCashFlow,

                incomeTransactionCount,
                expenseTransactionCount,

                totalTransactions:
                    incomeTransactionCount +
                    expenseTransactionCount,
            },

            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// Get expense category breakdown(where the user money is going.)
export const getExpenseCategoryBreakdown = async (req, res, next) => {
    try {
        const userId =
            new mongoose.Types.ObjectId(req.user._id);

        const breakdown = await Transaction.aggregate([
            {
                $match: {
                    userId,
                    transactionType: "expense",
                },
            },

            {
                $group: {
                    _id: "$transactionCategory",

                    totalAmount: {
                        $sum: "$transactionAmount",
                    },

                    transactionCount: {
                        $sum: 1,
                    },
                },
            },

            {
                $sort: {
                    totalAmount: -1,
                },
            },
        ]);

        return res.status(200).json({
            success: true,
            message:
                "Expense category breakdown retrieved successfully",
            breakdown,
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};

// ========================================
// Get Transaction By ID
// ========================================

export const getTransactionById = async (
    req,
    res,
    next
) => {

    try {

        const { id } = req.params;


        // Find transaction AND make sure
        // it belongs to logged-in user
        const transaction = await Transaction.findOne({
            _id: id,
            userId: req.user._id,
        });


        if (!transaction) {

            return res.status(404).json({
                success: false,
                message: "Transaction not found",
                status: 404,
            });

        }


        return res.status(200).json({

            success: true,

            message:
                "Transaction retrieved successfully",

            transaction,

            status: 200,
        });


    } catch (err) {
        next(err);
    }
};



// ========================================
// Update Transaction
// ========================================

export const updateTransaction = async (
    req,
    res,
    next
) => {

    try {

        const { id } = req.params;


        const {
            transactionType,
            transactionAmount,
            transactionCategory,
            description,
            transactionDate,
            paymentMethod,
            isRecurring,
            recurringFrequency,
            transactionNotes,
        } = req.body;


        /*
            Build update object manually.

            This prevents the frontend from changing fields
            such as userId.
        */

        const updateData = {};


        if (transactionType !== undefined) {
            updateData.transactionType =
                transactionType;
        }


        if (transactionAmount !== undefined) {
            updateData.transactionAmount =
                transactionAmount;
        }


        if (transactionCategory !== undefined) {
            updateData.transactionCategory =
                transactionCategory;
        }


        if (description !== undefined) {
            updateData.description = description ? toTitleCase(description) : description;
        }


        if (transactionDate !== undefined) {
            updateData.transactionDate =
                transactionDate;
        }


        if (paymentMethod !== undefined) {
            updateData.paymentMethod =
                paymentMethod;
        }


        if (isRecurring !== undefined) {
            updateData.isRecurring =
                isRecurring;
        }


        if (recurringFrequency !== undefined) {
            updateData.recurringFrequency =
                recurringFrequency;
        }


        if (transactionNotes !== undefined) {
            updateData.transactionNotes =
                transactionNotes;
        }


        /*
            Find and update in ONE query.

            Important:
            userId is included so a user cannot update
            another user's transaction.
        */

        const updatedTransaction =
            await Transaction.findOneAndUpdate(
                {
                    _id: id,
                    userId: req.user._id,
                },

                updateData,

                {
                    new: true,
                    runValidators: true,
                }
            );


        if (!updatedTransaction) {

            return res.status(404).json({
                success: false,
                message: "Transaction not found",
                status: 404,
            });

        }


        return res.status(200).json({

            success: true,

            message:
                "Transaction updated successfully",

            transaction: updatedTransaction,

            status: 200,
        });


    } catch (err) {
        next(err);
    }
};



// ========================================
// Delete Transaction
// ========================================

export const deleteTransaction = async (
    req,
    res,
    next
) => {

    try {

        const { id } = req.params;


        const transaction =
            await Transaction.findOneAndDelete({

                _id: id,

                userId: req.user._id,

            });


        if (!transaction) {

            return res.status(404).json({
                success: false,
                message: "Transaction not found",
                status: 404,
            });

        }


        return res.status(200).json({

            success: true,

            message:
                "Transaction deleted successfully",

            status: 200,
        });


    } catch (err) {
        next(err);
    }
};
 