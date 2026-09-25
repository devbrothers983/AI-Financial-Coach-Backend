import express from "express";

import {
    createBudget,
    getAllBudgets,
    getBudgetProgress,
    getBudgetById,
    updateBudget,
    deleteBudget,
    checkExpenseImpact,
} from "../controllers/budgetController.js";

import {authMiddleware} from "../middlewares/authMiddleware.js";




const router = express.Router();


router.post("/", authMiddleware, createBudget);
router.post("/check-impact", authMiddleware, checkExpenseImpact);
router.get("/", authMiddleware, getAllBudgets);
router.get("/:id/progress", authMiddleware, getBudgetProgress);
router.get("/:id", authMiddleware, getBudgetById);
router.put("/:id", authMiddleware, updateBudget);
router.delete("/:id", authMiddleware, deleteBudget);

export default router;