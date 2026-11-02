import express from "express";
import { sendContactMessage } from "../controllers/contactController.js";
import { optionalAuthMiddleware } from "../middlewares/authMiddleware.js";
import { contactLimiter } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.post("/", contactLimiter, optionalAuthMiddleware, sendContactMessage);

export default router;
