import express from "express";

import {
    createGoal,
    getAllGoals,
    getGoalById,
    updateGoal,
    deleteGoal,
    getGoalProgress,
} from "../controllers/goalController.js";

import {authMiddleware} from "../middlewares/authMiddleware.js";

const router = express.Router();



router.use(authMiddleware);


router.post("/", createGoal);
router.get("/", getAllGoals);
router.get("/:id", getGoalById);
router.put("/:id", updateGoal);
router.delete("/:id", deleteGoal);
router.get("/:id/progress", getGoalProgress);

export default router;