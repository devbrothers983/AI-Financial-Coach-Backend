import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv'

dotenv.config();



// error middleware
import { errorMiddleware } from './middlewares/errorMiddleware.js';

import authRoutes from './routes/authRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import budgetRoutes from './routes/budgetRoutes.js';
import goalRoutes from './routes/goalRoutes.js';
import dashboardRoutes from "./routes/dashboardRoutes.js";
import coachRoutes from "./routes/coachRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import announcementRoutes from "./routes/announcementRoutes.js";
import bankRoutes from "./routes/bankRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import householdRoutes from "./routes/householdRoutes.js";
import { checkAiService } from "./utils/aiService.js";

dotenv.config()


const app = express()
// Render sits behind a proxy; this makes req.ip the visitor's real IP
app.set('trust proxy', 1)
// larger limit for CSV transaction imports (up to 1000 rows)
app.use(express.json({
    limit: '2mb',
    // Plaid's webhook signature covers the exact bytes it sent
    verify: (req, res, buf) => {
        if (req.originalUrl.startsWith('/api/bank/webhook')) req.rawBody = buf;
    },
}))
app.use(morgan('dev'))
app.use(helmet())
// FRONTEND_URL can hold several comma-separated origins (e.g. Vercel + localhost)
const allowedOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter(Boolean);

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    // lets the browser read the filename of CSV downloads
    exposedHeaders: ['Content-Disposition'],
}));


app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use("/api/budgets", budgetRoutes);  
app.use("/api/goals", goalRoutes);
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/coach", coachRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/household", householdRoutes);






app.use(errorMiddleware)



app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'AI Financial Coach is running!',
    })

})

// Whether this server can reach the AI service, for checking the setup from
// outside. It shows no settings or keys, only the AI service's host name.
app.get('/health/ai', async (req, res) => {
    res.status(200).json(await checkAiService())
})


export default app