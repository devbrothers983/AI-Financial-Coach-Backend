import { sendMail } from "../utils/mailer.js";
import { toTitleCase } from "../utils/formatText.js";
import ContactMessage from "../models/ContactMessage.js";
import { logActivity } from "../utils/activityLogger.js";
import { escapeHtml, textToHtml } from "../utils/escapeHtml.js";

export const sendContactMessage = async (req, res, next) => {
    try {

        let { name, email, subject, message, source } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({
                success: false,
                message: "name, email and message are required",
                status: 400,
            });
        }

        if (!/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address",
                status: 400,
            });
        }

        name = toTitleCase(name);

        const contactMessage = await ContactMessage.create({
            userId: req.user?._id || null,
            name,
            email,
            subject: subject || "General",
            message,
            source: source === "feedback" ? "feedback" : "contact",
        });

        if (req.user) {
            logActivity(req, {
                action: "message.send",
                description: `Sent ${contactMessage.source === "feedback" ? "feedback" : "a support message"}: "${contactMessage.subject}"`,
                targetId: contactMessage._id,
                metadata: { subject: contactMessage.subject, source: contactMessage.source },
            });
        }

        // The message is already saved, so a failed notification email
        // shouldn't make the sender think it wasn't delivered.
        sendMail({
            to: process.env.EMAIL_USER,
            replyTo: email,
            subject: `[AI Financial Coach] ${subject || "New contact message"}`,
            text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
            html: `
                <p><strong>Name:</strong> ${escapeHtml(name)}</p>
                <p><strong>Email:</strong> ${escapeHtml(email)}</p>
                <p><strong>Subject:</strong> ${escapeHtml(subject || "General")}</p>
                <p>${textToHtml(message)}</p>
            `,
        }).catch((err) => {
            console.error("Failed to send contact notification:", err.message);
        });

        return res.status(200).json({
            success: true,
            message: "Message sent successfully",
            data: contactMessage,
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};
