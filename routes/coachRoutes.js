import express from "express";

import {
    checkAffordability,
} from "../controllers/coachController.js";

import {
    getChat,
    sendMessage,
    clearChat,
} from "../controllers/coachChatController.js";

import {
    authMiddleware,
} from "../middlewares/authMiddleware.js";

import {
    coachChatLimiter,
} from "../middlewares/rateLimitMiddleware.js";


const router =
    express.Router();


router.post(
    "/affordability",
    authMiddleware,
    checkAffordability
);

router.get("/chat", authMiddleware, getChat);
router.post("/chat", authMiddleware, coachChatLimiter, sendMessage);
router.delete("/chat", authMiddleware, clearChat);


export default router;
