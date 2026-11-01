import express from "express";

import {
    getMyMessages,
    getMyUnreadCount,
    getMyMessageById,
    replyToMyMessage,
} from "../controllers/messageController.js";

import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getMyMessages);
router.get("/unread-count", getMyUnreadCount);
router.get("/:id", getMyMessageById);
router.post("/:id/reply", replyToMyMessage);

export default router;
