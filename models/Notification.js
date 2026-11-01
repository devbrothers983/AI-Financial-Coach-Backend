import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        type: {
            type: String,
            enum: ["budget_alert", "goal_milestone", "announcement", "message_reply", "security", "system"],
            default: "system",
        },

        // "info" | "success" | "warning" | "danger" — drives the colour in the UI
        level: {
            type: String,
            enum: ["info", "success", "warning", "danger"],
            default: "info",
        },

        title: { type: String, required: true, trim: true },
        body: { type: String, default: "", trim: true },

        // in-app path to open when the notification is clicked
        link: { type: String, default: "" },

        readAt: { type: Date, default: null },

        // stops the same alert being sent twice, e.g. "budget:<id>:food:80"
        dedupeKey: { type: String, default: null },

        metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index(
    { userId: 1, dedupeKey: 1 },
    { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
