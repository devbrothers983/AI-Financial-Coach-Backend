import mongoose from "mongoose";

const contactMessageSchema = new mongoose.Schema(
    {
        // set when the sender was signed in; older messages are matched by email
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        subject: {
            type: String,
            trim: true,
            default: "General",
        },

        message: {
            type: String,
            required: true,
            trim: true,
        },

        source: {
            type: String,
            enum: ["contact", "feedback"],
            default: "contact",
        },

        isRead: {
            type: Boolean,
            default: false,
        },

        replies: [
            {
                message: {
                    type: String,
                    required: true,
                    trim: true,
                },
                repliedBy: {
                    type: String,
                    required: true,
                },
                // who wrote this reply: the support team or the user following up
                from: {
                    type: String,
                    enum: ["admin", "user"],
                    default: "admin",
                },
                createdAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],

        // when the user last opened this conversation; admin replies after this are unread
        userLastReadAt: {
            type: Date,
            default: null,
        },

        // bumped on every new message so active conversations sort to the top
        lastActivityAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    { timestamps: true }
);

const ContactMessage = mongoose.model("ContactMessage", contactMessageSchema);
export default ContactMessage;
