import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { OAuth2Client } from "google-auth-library";

// Render's free tier blocks outbound SMTP, so in production we send from the
// same Gmail account through the Gmail API (HTTPS) when the GMAIL_* OAuth
// credentials are set. Gmail SMTP stays as the fallback for local development.

let transporter = null;
let gmailClient = null;

const getTransporter = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
            // fail fast instead of hanging the request when SMTP is unreachable
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
        });
    }
    return transporter;
};

const useGmailApi = () =>
    Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);

const getGmailClient = () => {
    if (!gmailClient) {
        gmailClient = new OAuth2Client(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
        gmailClient.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    }
    return gmailClient;
};

const sendWithGmailApi = async (options) => {
    const message = await new MailComposer({
        from: `"AI Financial Coach" <${process.env.EMAIL_USER}>`,
        ...options,
    })
        .compile()
        .build();

    // google-auth-library refreshes the access token and adds the auth header
    const response = await getGmailClient().request({
        url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        method: "POST",
        data: { raw: message.toString("base64url") },
        timeout: 15000,
    });

    return response.data;
};

export const sendMail = (options) => {
    if (useGmailApi()) {
        return sendWithGmailApi(options);
    }

    return getTransporter().sendMail({
        from: `"AI Financial Coach" <${process.env.EMAIL_USER}>`,
        ...options,
    });
};

export const sendWelcomeEmail = (username, email) => {
    return sendMail({
        to: email,
        subject: "Welcome to AI Financial Coach 🎉",
        text: `Hi ${username},\n\nWelcome to AI Financial Coach! Your account has been created successfully.\n\nStart logging your income and expenses, set a monthly budget, create savings goals, and let our AI coach turn your spending into clear, personalized guidance.\n\nHappy budgeting!\nThe AI Financial Coach Team`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                <h2 style="color: #059669;">Welcome to AI Financial Coach, ${username}! 🎉</h2>
                <p>Your account has been created successfully. We're excited to help you take control of your finances.</p>
                <p>Here's what you can do next:</p>
                <ul>
                    <li>Log your income and expenses</li>
                    <li>Set a monthly budget</li>
                    <li>Create savings goals</li>
                    <li>Get AI-powered insights on your spending</li>
                </ul>
                <p style="margin-top: 24px;">Happy budgeting!<br/>The AI Financial Coach Team</p>
            </div>
        `,
    });
};
