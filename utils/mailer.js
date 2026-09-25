import nodemailer from "nodemailer";

let transporter = null;

const getTransporter = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }
    return transporter;
};

export const sendMail = (options) => {
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
