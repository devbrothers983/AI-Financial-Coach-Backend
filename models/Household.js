import mongoose from "mongoose";

// People who see a shared view of their money. Each member decides how much
// of their own data the others can see, and it starts at nothing.
const householdSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 60 },

        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        members: [
            {
                _id: false,
                userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                role: { type: String, enum: ["owner", "member"], default: "member" },
                // none: nothing; totals: monthly income and spending;
                // transactions: totals, categories and individual transactions
                shareLevel: { type: String, enum: ["none", "totals", "transactions"], default: "none" },
                joinedAt: { type: Date, default: Date.now },
            },
        ],
    },
    { timestamps: true }
);

// a person can only be in one household
householdSchema.index({ "members.userId": 1 }, { unique: true });

const Household = mongoose.model("Household", householdSchema);

export default Household;
