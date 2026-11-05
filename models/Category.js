import mongoose from "mongoose";

// A category a user made themselves, on top of the built-in ones
const categorySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // always lowercase; this is the value saved on transactions
        name: { type: String, required: true, trim: true, lowercase: true, maxlength: 30 },

        kind: {
            type: String,
            enum: ["expense", "income", "both"],
            default: "expense",
        },
    },
    { timestamps: true }
);

categorySchema.index({ userId: 1, name: 1 }, { unique: true });

const Category = mongoose.model("Category", categorySchema);

export default Category;
