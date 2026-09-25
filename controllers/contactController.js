import { sendMail } from "../utils/mailer.js";
import { toTitleCase } from "../utils/formatText.js";
import ContactMessage from "../models/ContactMessage.js";

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

        await ContactMessage.create({
            name,
            email,
            subject: subject || "General",
            message,
            source: source === "feedback" ? "feedback" : "contact",
        });

        await sendMail({
            to: process.env.EMAIL_USER,
            replyTo: email,
            subject: `[AI Financial Coach] ${subject || "New contact message"}`,
            text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
            html: `
                <p><strong>Name:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Subject:</strong> ${subject || "General"}</p>
                <p>${message.replace(/\n/g, "<br/>")}</p>
            `,
        });

        return res.status(200).json({
            success: true,
            message: "Message sent successfully",
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};
