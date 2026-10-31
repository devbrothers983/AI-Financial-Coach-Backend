import nodemailer from "nodemailer";

// Render's free tier blocks outbound SMTP, so in production we send through
// Brevo's HTTPS API when BREVO_API_KEY is set. Gmail SMTP stays as the
// fallback for local development.

let transporter = null;

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

const sendWithBrevo = async ({ to, subject, text, html }) => {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "api-key": process.env.BREVO_API_KEY,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            sender: {
                name: "AI Financial Coach",
                email: process.env.MAIL_FROM || process.env.EMAIL_USER,
            },
            to: [{ email: to }],
            subject,
            textContent: text,
            htmlContent: html,
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Brevo email failed (${response.status}): ${details}`);
    }

    return response.json();
};

export const sendMail = (options) => {
    if (process.env.BREVO_API_KEY) {
        return sendWithBrevo(options);
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
