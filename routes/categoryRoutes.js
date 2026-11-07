import express from "express";

import {
    getCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    saveRule,
    deleteRule,
    sortUncategorized,
} from "../controllers/categoryController.js";

import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getCategories);
router.post("/", createCategory);
router.post("/sort-uncategorized", sortUncategorized);
router.post("/rules", saveRule);
router.delete("/rules/:id", deleteRule);
router.put("/:id", renameCategory);
router.delete("/:id", deleteCategory);

export default router;
