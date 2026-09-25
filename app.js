import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv'



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

dotenv.config()


const app = express()
app.use(express.json())
app.use(morgan('dev'))
app.use(helmet())
app.use(cors())


app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use("/api/budgets", budgetRoutes);  
app.use("/api/goals", goalRoutes);
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/coach", coachRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);






app.use(errorMiddleware)


app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'AI Financial Coach is running!',
    })

})


export default app