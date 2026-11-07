import mongoose from "mongoose";

// A user's conversation with the AI coach. Each user has one, until they clear it.
const coachChatSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },

        messages: [
            {
                role: { type: String, enum: ["user", "assistant"], required: true },
                content: { type: String, required: true },
                createdAt: { type: Date, default: Date.now },
            },
        ],
    },
    { timestamps: true }
);

const CoachChat = mongoose.model("CoachChat", coachChatSchema);

export default CoachChat;
