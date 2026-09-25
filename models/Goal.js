import mongoose from "mongoose";


const GoalSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: "User",
            index: true,
        },

        title: {
            type: String,
            required: [true, "Goal title is required"],
            trim: true,
            maxlength: 100
        },

        description: {
            type: String,
            trim: true,
            maxlength: 500,
            default: "",
        },

        targetAmount: {
            type: Number,
            required: [true, "Target amount is required"],
            min: [1, "Target amount must be greater than 0"],
        },

        currentAmount: {
            type: Number,
            default: 0,
            min: [0, "Current amount cannot be negative"],
        },

        targetDate: {
            type: Date,
            required: [true, "Target date is required"],
        },

        priority: {
            type: String,
            enum: ["low", "medium", "high"],
            default: "medium",
        },

        status: {
            type: String,
            enum: ["active", "completed", "paused"],
            default: "active",
        },
    },
    {
        timestamps: true,
    }
);


const Goal = mongoose.model("Goal", GoalSchema);
export default Goal;