import mongoose from "mongoose";

const householdInviteSchema = new mongoose.Schema(
    {
        householdId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Household",
            required: true,
            index: true,
        },

        email: { type: String, required: true, trim: true, lowercase: true, index: true },

        invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        invitedByName: { type: String, default: "" },

        // only a hash is stored; the link in the email holds the real value
        tokenHash: { type: String, required: true, select: false },

        status: {
            type: String,
            enum: ["pending", "accepted", "declined", "cancelled"],
            default: "pending",
        },

        expiresAt: { type: Date, required: true },
    },
    { timestamps: true }
);

const HouseholdInvite = mongoose.model("HouseholdInvite", householdInviteSchema);

export default HouseholdInvite;
