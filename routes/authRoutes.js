import express from "express";
import { registerUser, loginUser, googleAuth, forgotPassword, resetPassword } from "../controllers/authController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";


const router = express.Router()

router.post('/register', registerUser)
router.post('/login', loginUser)
router.post('/google', googleAuth)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)


export default router;