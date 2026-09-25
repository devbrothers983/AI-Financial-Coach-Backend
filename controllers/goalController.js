import Goal from "../models/Goal.js";
import { toTitleCase } from "../utils/formatText.js";
import { sweepCompletedBudgets } from "./budgetController.js";
import { calculateGoalPace } from "../utils/goalPace.js";


// ========================================
// Create Goal
// ========================================

export const createGoal = async (req, res, next) => {
    try {

        const {
            title,
            description,
            targetAmount,
            currentAmount,
            targetDate,
            priority,
        } = req.body;


        // Required fields
        if (
            !title ||
            targetAmount === undefined ||
            !targetDate
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "title, targetAmount and targetDate are required",
                status: 400,
            });
        }


        // Target date cannot be in the past
        if (new Date(targetDate) <= new Date()) {
            return res.status(400).json({
                success: false,
                message:
                    "Target date must be in the future",
                status: 400,
            });
        }


        // Current amount should not exceed target
        if (
            currentAmount !== undefined &&
            currentAmount > targetAmount
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Current amount cannot exceed target amount",
                status: 400,
            });
        }


        const goal = await Goal.create({
            userId: req.user._id,
            title: toTitleCase(title),
            description,
            targetAmount,
            currentAmount,
            targetDate,
            priority,
        });


        return res.status(201).json({
            success: true,
            message: "Goal created successfully",
            goal,
            status: 201,
        });

    } catch (err) {
        next(err);
    }
};



// ========================================
// Get All Goals
// ========================================

export const getAllGoals = async (req, res, next) => {
    try {

        const {
            status,
            priority,
        } = req.query;


        const sweptGoals = await sweepCompletedBudgets(req.user._id);


        const query = {
            userId: req.user._id,
        };


        // Optional status filter
        if (status) {
            query.status = status;
        }


        // Optional priority filter
        if (priority) {
            query.priority = priority;
        }


        const goals = await Goal
            .find(query)
            .sort({
                targetDate: 1,
            });


        const goalsWithPace = goals.map((goal) => ({
            ...goal.toObject(),
            pace: goal.status === "active" ? calculateGoalPace(goal) : null,
        }));


        return res.status(200).json({
            success: true,
            message: "Goals retrieved successfully",
            count: goals.length,
            goals: goalsWithPace,
            sweptGoals,
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};



// ========================================
// Get Goal By ID
// ========================================

export const getGoalById = async (
    req,
    res,
    next
) => {

    try {

        const { id } = req.params;


        const goal = await Goal.findOne({
            _id: id,
            userId: req.user._id,
        });


        if (!goal) {
            return res.status(404).json({
                success: false,
                message: "Goal not found",
                status: 404,
            });
        }


        return res.status(200).json({
            success: true,
            message: "Goal retrieved successfully",
            goal,
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};



// ========================================
// Update Goal
// ========================================

export const updateGoal = async (
    req,
    res,
    next
) => {

    try {

        const { id } = req.params;


        const {
            title,
            description,
            targetAmount,
            currentAmount,
            targetDate,
            priority,
            status,
        } = req.body;


        // First get existing goal
        const goal = await Goal.findOne({
            _id: id,
            userId: req.user._id,
        });


        if (!goal) {
            return res.status(404).json({
                success: false,
                message: "Goal not found",
                status: 404,
            });
        }


        /*
            We need the final target/current amounts
            because the request may update only one of them.
        */

        const finalTargetAmount =
            targetAmount !== undefined
                ? targetAmount
                : goal.targetAmount;


        const finalCurrentAmount =
            currentAmount !== undefined
                ? currentAmount
                : goal.currentAmount;


        if (finalCurrentAmount > finalTargetAmount) {
            return res.status(400).json({
                success: false,
                message:
                    "Current amount cannot exceed target amount",
                status: 400,
            });
        }


        // Only allow specific fields to be updated
        const updateData = {};


        if (title !== undefined) {
            updateData.title = toTitleCase(title);
        }


        if (description !== undefined) {
            updateData.description = description;
        }


        if (targetAmount !== undefined) {
            updateData.targetAmount = targetAmount;
        }


        if (currentAmount !== undefined) {
            updateData.currentAmount = currentAmount;
        }


        if (targetDate !== undefined) {
            updateData.targetDate = targetDate;
        }


        if (priority !== undefined) {
            updateData.priority = priority;
        }


        if (status !== undefined) {
            updateData.status = status;
        }


        /*
            Automatically mark goal completed when
            currentAmount reaches targetAmount.
        */

        if (finalCurrentAmount >= finalTargetAmount) {
            updateData.status = "completed";
        }


        const updatedGoal =
            await Goal.findOneAndUpdate(
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


        return res.status(200).json({
            success: true,
            message: "Goal updated successfully",
            goal: updatedGoal,
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};



// ========================================
// Delete Goal
// ========================================

export const deleteGoal = async (
    req,
    res,
    next
) => {

    try {

        const { id } = req.params;


        const goal =
            await Goal.findOneAndDelete({
                _id: id,
                userId: req.user._id,
            });


        if (!goal) {
            return res.status(404).json({
                success: false,
                message: "Goal not found",
                status: 404,
            });
        }


        return res.status(200).json({
            success: true,
            message: "Goal deleted successfully",
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};



// ========================================
// Get Goal Progress
// ========================================

export const getGoalProgress = async (
    req,
    res,
    next
) => {

    try {

        const { id } = req.params;


        const goal = await Goal.findOne({
            _id: id,
            userId: req.user._id,
        });


        if (!goal) {
            return res.status(404).json({
                success: false,
                message: "Goal not found",
                status: 404,
            });
        }


        // ========================================
        // Amount remaining
        // ========================================

        const remainingAmount = Math.max(
            goal.targetAmount - goal.currentAmount,
            0
        );


        // ========================================
        // Progress percentage
        // ========================================

        const percentageCompleted =
            goal.targetAmount > 0
                ? (
                    goal.currentAmount /
                    goal.targetAmount
                ) * 100
                : 0;


        // ========================================
        // Days remaining
        // ========================================

        const today = new Date();

        const targetDate =
            new Date(goal.targetDate);


        const difference =
            targetDate.getTime() -
            today.getTime();


        const daysRemaining = Math.max(
            Math.ceil(
                difference /
                (1000 * 60 * 60 * 24)
            ),
            0
        );


        // ========================================
        // Months remaining
        // Approximation for planning
        // ========================================

        const monthsRemaining = Math.max(
            Math.ceil(daysRemaining / 30),
            1
        );


        // ========================================
        // Monthly saving required
        // ========================================

        const monthlySavingRequired =
            remainingAmount /
            monthsRemaining;


        // ========================================
        // Goal status
        // ========================================

        let progressStatus = "on_track";


        if (goal.currentAmount >= goal.targetAmount) {

            progressStatus = "completed";

        } else if (daysRemaining === 0) {

            progressStatus = "deadline_reached";

        }


        const pace = calculateGoalPace(goal);


        return res.status(200).json({

            success: true,

            message:
                "Goal progress retrieved successfully",

            goalProgress: {

                goalId:
                    goal._id,

                title:
                    goal.title,

                targetAmount:
                    goal.targetAmount,

                currentAmount:
                    goal.currentAmount,

                remainingAmount,

                percentageCompleted:
                    Number(
                        percentageCompleted.toFixed(2)
                    ),

                targetDate:
                    goal.targetDate,

                daysRemaining,

                monthsRemaining,

                monthlySavingRequired:
                    Number(
                        monthlySavingRequired.toFixed(2)
                    ),

                priority:
                    goal.priority,

                status:
                    progressStatus,

                isOffTrack:
                    pace.isOffTrack,

                expectedAmountByNow:
                    pace.expectedAmountByNow,
            },

            status: 200,
        });


    } catch (err) {
        next(err);
    }
};