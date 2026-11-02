import mongoose from "mongoose";

// One bank login linked through Plaid (Plaid calls this an "Item")
const bankConnectionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        itemId: { type: String, required: true, unique: true },

        // encrypted with utils/tokenCipher.js; never sent to the browser
        accessTokenEnc: { type: String, required: true, select: false },

        // where the last sync stopped
        cursor: { type: String, default: "", select: false },

        institutionId: { type: String, default: "" },
        institutionName: { type: String, default: "Your bank", trim: true },

        accounts: [
            {
                _id: false,
                accountId: String,
                name: String,
                mask: String,
                type: { type: String },
                subtype: String,
            },
        ],

        status: {
            type: String,
            enum: ["active", "needs_reauth", "revoked"],
            default: "active",
        },

        lastSyncedAt: { type: Date, default: null },
        lastErrorCode: { type: String, default: null },

        // stops a webhook and a manual sync running at the same time
        syncLockedUntil: { type: Date, default: null, select: false },
        resyncRequested: { type: Boolean, default: false, select: false },
    },
    { timestamps: true }
);

const BankConnection = mongoose.model("BankConnection", bankConnectionSchema);

export default BankConnection;
