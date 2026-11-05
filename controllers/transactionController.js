import Transaction from "../models/Transaction.js";
import { toTitleCase } from "../utils/formatText.js";
import { logActivity } from "../utils/activityLogger.js";
import { checkBudgetAlerts } from "../utils/budgetAlerts.js";
import { normalizeMerchant } from "../utils/detectSubscriptions.js";
import {
    isValidCategory,
    normalizeCategoryName,
    loadCategoryNames,
    loadRules,
    findMatchingRule,
} from "../utils/categories.js";
import { toCsv, sendCsv, TRANSACTION_COLUMNS, todayStamp } from "../utils/csv.js";

import mongoose from "mongoose";

const describeTransaction = (t) => `${t.transactionType} of ${t.transactionAmount} (${t.transactionCategory})`;

// After a user changes a category by hand, offer to remember it for that
// merchant, unless a rule for it already says the same thing
const suggestRule = async (userId, previous, updated) => {
    if (!previous || previous.transactionCategory === updated.transactionCategory) return null;

    const matchText = normalizeMerchant(updated.description);
    if (matchText.length < 2) return null;

    const rule = findMatchingRule(updated.description, await loadRules(userId));
    if (rule?.category === updated.transactionCategory) return null;

    return { matchText, category: updated.transactionCategory };
};

const transactionMeta = (t) => ({
    transactionType: t.transactionType,
    amount: t.transactionAmount,
    category: t.transactionCategory,
    description: t.description,
});
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


        if (!(await isValidCategory(req.user._id, transactionCategory))) {
            return res.status(400).json({
                success: false,
                message: "Choose a valid category",
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

        logActivity(req, {
            action: "transaction.create",
            description: `Added ${describeTransaction(transaction)}`,
            targetId: transaction._id,
            metadata: transactionMeta(transaction),
        });

        if (transaction.transactionType === "expense") {
            checkBudgetAlerts(req.user, transaction.transactionDate);
        }


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
            if (!(await isValidCategory(req.user._id, transactionCategory))) {
                return res.status(400).json({
                    success: false,
                    message: "Choose a valid category",
                    status: 400,
                });
            }

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

        const previous = transactionCategory !== undefined
            ? await Transaction.findOne({ _id: id, userId: req.user._id }).select("transactionCategory").lean()
            : null;

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

        logActivity(req, {
            action: "transaction.update",
            description: `Edited ${describeTransaction(updatedTransaction)}`,
            targetId: updatedTransaction._id,
            metadata: transactionMeta(updatedTransaction),
        });

        if (updatedTransaction.transactionType === "expense") {
            checkBudgetAlerts(req.user, updatedTransaction.transactionDate);
        }


        return res.status(200).json({

            success: true,

            message:
                "Transaction updated successfully",

            transaction: updatedTransaction,

            ruleSuggestion: await suggestRule(req.user._id, previous, updatedTransaction),

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

        logActivity(req, {
            action: "transaction.delete",
            description: `Deleted ${describeTransaction(transaction)}`,
            targetId: transaction._id,
            metadata: transactionMeta(transaction),
        });


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
 


// ========================================
// Export Transactions (CSV)
// ========================================

export const exportTransactions = async (req, res, next) => {
    try {
        const { transactionType, startDate, endDate } = req.query;

        const query = { userId: req.user._id };
        if (transactionType === "income" || transactionType === "expense") query.transactionType = transactionType;
        if (startDate || endDate) {
            query.transactionDate = {};
            if (startDate) query.transactionDate.$gte = new Date(startDate);
            if (endDate) {
                const nextDay = new Date(endDate);
                nextDay.setDate(nextDay.getDate() + 1);
                query.transactionDate.$lt = nextDay;
            }
        }

        const transactions = await Transaction.find(query).sort({ transactionDate: -1 }).lean();

        logActivity(req, {
            action: "transaction.export",
            description: `Exported ${transactions.length} transactions to CSV`,
            metadata: { count: transactions.length },
        });

        return sendCsv(res, `transactions-${todayStamp()}.csv`, toCsv(transactions, TRANSACTION_COLUMNS));
    } catch (err) {
        next(err);
    }
};



// ========================================
// Import Transactions
// The browser parses the CSV and maps its columns; this validates each row.
// ========================================

const VALID_PAYMENT_METHODS = Transaction.schema.path("paymentMethod").enumValues;
const MAX_IMPORT_ROWS = 1000;

const normalizeKey = (value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const parseAmount = (value) => {
    if (typeof value === "number") return value;
    // "$1,234.50", "(25.00)", "-25" and European "1.234,50" are all accepted
    const text = String(value || "").trim();
    const negative = /^\(.*\)$/.test(text) || /^-/.test(text.replace(/^[^\d-]+/, ""));
    let digits = text.replace(/[^\d.,]/g, "");
    digits = /,\d{1,2}$/.test(digits)
        ? digits.replace(/\./g, "").replace(",", ".")
        : digits.replace(/,/g, "");
    const number = parseFloat(digits);
    return Number.isFinite(number) ? (negative ? -number : number) : NaN;
};

// "2026-12-31", US "12/31/2026" and European "31.12.2026", all read as UTC
// dates so the day never shifts with the server's time zone
const parseDate = (value) => {
    const text = String(value || "").trim();
    const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const slashed = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const date = dotted
        ? new Date(Date.UTC(+dotted[3], +dotted[2] - 1, +dotted[1]))
        : slashed
          ? new Date(Date.UTC(+slashed[3], +slashed[1] - 1, +slashed[2]))
          : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
};

export const importTransactions = async (req, res, next) => {
    try {
        const { rows } = req.body;

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No rows to import",
                status: 400,
            });
        }

        if (rows.length > MAX_IMPORT_ROWS) {
            return res.status(400).json({
                success: false,
                message: `You can import up to ${MAX_IMPORT_ROWS} rows at a time`,
                status: 400,
            });
        }

        const [knownCategories, rules] = await Promise.all([loadCategoryNames(req.user._id), loadRules(req.user._id)]);

        const docs = [];
        const skipped = [];

        rows.forEach((row, index) => {
            const rowNumber = index + 1;

            const amount = parseAmount(row.amount);
            if (!Number.isFinite(amount) || amount === 0) {
                skipped.push({ row: rowNumber, reason: "Missing or invalid amount" });
                return;
            }

            const date = parseDate(row.date);
            if (!date) {
                skipped.push({ row: rowNumber, reason: "Missing or invalid date" });
                return;
            }

            // an explicit type wins; otherwise negative amounts are expenses
            const typeText = normalizeKey(row.type);
            const transactionType = ["income", "credit", "deposit"].includes(typeText)
                ? "income"
                : ["expense", "debit", "withdrawal", "payment"].includes(typeText)
                  ? "expense"
                  : amount < 0
                    ? "expense"
                    : "income";

            // the file's category if it's one the user has, otherwise their rules
            const fileCategory = normalizeCategoryName(row.category);
            const category =
                knownCategories.has(fileCategory) && fileCategory !== "other"
                    ? fileCategory
                    : findMatchingRule(row.description, rules)?.category || "other";
            const paymentMethod = normalizeKey(row.paymentMethod);

            docs.push({
                userId: req.user._id,
                transactionType,
                transactionAmount: Math.round(Math.abs(amount) * 100) / 100,
                transactionCategory: category,
                description: String(row.description || "").trim().slice(0, 200),
                transactionDate: date,
                paymentMethod: VALID_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : "other",
                transactionNotes: String(row.notes || "").trim().slice(0, 500),
            });
        });

        const inserted = docs.length ? await Transaction.insertMany(docs) : [];

        if (inserted.length) {
            logActivity(req, {
                action: "transaction.import",
                description: `Imported ${inserted.length} transactions from CSV${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
                metadata: { imported: inserted.length, skipped: skipped.length },
            });

            // one budget check per month that received expenses
            const months = new Set(
                inserted
                    .filter((t) => t.transactionType === "expense")
                    .map((t) => `${t.transactionDate.getUTCFullYear()}-${t.transactionDate.getUTCMonth()}`)
            );
            months.forEach((key) => {
                const [year, month] = key.split("-").map(Number);
                checkBudgetAlerts(req.user, new Date(Date.UTC(year, month, 15)));
            });
        }

        return res.status(200).json({
            success: true,
            message: `Imported ${inserted.length} of ${rows.length} rows`,
            imported: inserted.length,
            skipped,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
