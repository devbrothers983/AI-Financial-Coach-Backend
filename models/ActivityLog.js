import mongoose from "mongoose";

// One row per thing that happened: sign-ins, data changes, admin actions.
// `userId` is who did it; `targetUserId` is whose account it affected
// (the same person for normal activity, a different one for admin actions).
const activityLogSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        // kept as text so the log still reads correctly after a user is deleted
        username: { type: String, default: "" },
        email: { type: String, default: "", lowercase: true, trim: true },
        role: { type: String, default: "user" },

        // "<category>.<verb>", e.g. "auth.login", "transaction.delete", "admin.user_status"
        action: {
            type: String,
            required: true,
            index: true,
        },

        category: {
            type: String,
            enum: ["auth", "transaction", "budget", "goal", "profile", "message", "admin", "coach", "bank", "subscription", "category", "household"],
            required: true,
            index: true,
        },

        description: { type: String, default: "" },

        targetUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        targetId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        ip: { type: String, default: "" },
        userAgent: { type: String, default: "" },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ targetUserId: 1, createdAt: -1 });

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export default ActivityLog;
