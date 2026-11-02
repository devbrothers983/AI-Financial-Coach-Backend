import express from "express";
import { registerUser, loginUser, googleAuth, forgotPassword, resetPassword } from "../controllers/authController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import {
    authIpLimiter,
    loginAttemptLimiter,
    forgotPasswordLimiter,
    resetPasswordLimiter,
} from "../middlewares/rateLimitMiddleware.js";


const router = express.Router()

router.post('/register', authIpLimiter, registerUser)
router.post('/login', authIpLimiter, loginAttemptLimiter, loginUser)
router.post('/google', authIpLimiter, googleAuth)
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword)
router.post('/reset-password', resetPasswordLimiter, resetPassword)


export default router;
