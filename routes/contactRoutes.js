import express from "express";
import { sendContactMessage } from "../controllers/contactController.js";
import { optionalAuthMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/", optionalAuthMiddleware, sendContactMessage);

export default router;
