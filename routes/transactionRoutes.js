import express from "express";
import {
    createTransaction,
    getALLTransactions,
    getTransactionSummary,
    getExpenseCategoryBreakdown,
    getTransactionById,
    updateTransaction,
    deleteTransaction,
    exportTransactions,
    importTransactions,

} from "../controllers/transactionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/create", authMiddleware, createTransaction);
router.get("/all", authMiddleware, getALLTransactions);
router.get("/summary", authMiddleware, getTransactionSummary)
router.get("/category-breakdown", authMiddleware, getExpenseCategoryBreakdown)
router.get("/export", authMiddleware, exportTransactions);
router.post("/import", authMiddleware, importTransactions);
router.get("/:id", authMiddleware, getTransactionById);
router.put("/update/:id", authMiddleware, updateTransaction);
router.delete("/delete/:id", authMiddleware, deleteTransaction);

export default router;