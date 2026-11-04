import mongoose from "mongoose";

// A subscription the user chose to track. Ones the app only detected from
// transactions aren't stored; they're worked out each time the page opens.
const subscriptionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        name: { type: String, required: true, trim: true, maxlength: 100 },

        // the name in the form transactions are matched by, e.g. "udemy"
        merchantKey: { type: String, required: true },

        amount: { type: Number, required: true, min: 0.01 },

        frequency: {
            type: String,
            enum: ["weekly", "monthly", "quarterly", "yearly"],
            default: "monthly",
        },

        nextChargeDate: { type: Date, required: true, index: true },

        // the day of the month it bills on, kept so the 31st survives short months
        billingDay: { type: Number, min: 1, max: 31 },

        category: { type: String, default: "other" },

        status: {
            type: String,
            enum: ["active", "cancelled"],
            default: "active",
        },

        cancelledAt: { type: Date, default: null },

        // days before each charge to remind the user; 0 turns reminders off
        remindDaysBefore: { type: Number, default: 3, min: 0, max: 30 },

        // the next charge is the end of a free trial
        isTrial: { type: Boolean, default: false },

        // add the expense to Transactions on each charge date
        autoAddExpense: { type: Boolean, default: false },

        // the company's page for managing or cancelling it
        manageUrl: { type: String, default: "", trim: true },
    },
    { timestamps: true }
);

const Subscription = mongoose.model("Subscription", subscriptionSchema);

export default Subscription;
