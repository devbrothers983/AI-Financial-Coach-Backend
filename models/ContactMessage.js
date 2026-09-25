import mongoose from "mongoose";

const contactMessageSchema = new mongoose.Schema(
    {
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
                createdAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],
    },
    { timestamps: true }
);

const ContactMessage = mongoose.model("ContactMessage", contactMessageSchema);
export default ContactMessage;
