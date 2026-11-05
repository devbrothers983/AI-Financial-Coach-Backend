import mongoose from "mongoose";

// "When a transaction's description contains this, use this category"
const categoryRuleSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // cleaned the same way as merchant names, e.g. "uber"
        matchText: { type: String, required: true, maxlength: 60 },

        category: { type: String, required: true },
    },
    { timestamps: true }
);

categoryRuleSchema.index({ userId: 1, matchText: 1 }, { unique: true });

const CategoryRule = mongoose.model("CategoryRule", categoryRuleSchema);

export default CategoryRule;
