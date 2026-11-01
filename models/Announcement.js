import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 120 },
        body: { type: String, default: "", trim: true, maxlength: 1000 },

        level: {
            type: String,
            enum: ["info", "success", "warning"],
            default: "info",
        },

        audience: {
            type: String,
            enum: ["all", "users", "admins"],
            default: "users",
        },

        // optional in-app link shown as a button on the banner
        link: { type: String, default: "", trim: true },
        linkLabel: { type: String, default: "", trim: true },

        active: { type: Boolean, default: true },
        expiresAt: { type: Date, default: null },

        emailed: { type: Boolean, default: false },
        emailedCount: { type: Number, default: 0 },

        dismissedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdByName: { type: String, default: "" },
    },
    { timestamps: true }
);

announcementSchema.index({ active: 1, createdAt: -1 });

const Announcement = mongoose.model("Announcement", announcementSchema);

export default Announcement;
