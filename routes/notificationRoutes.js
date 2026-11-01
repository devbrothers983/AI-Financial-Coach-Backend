import express from "express";

import {
    getMyNotifications,
    getMyUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
} from "../controllers/notificationController.js";

import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getMyNotifications);
router.get("/unread-count", getMyUnreadNotificationCount);
router.put("/read-all", markAllNotificationsRead);
router.put("/:id/read", markNotificationRead);
router.delete("/:id", deleteNotification);

export default router;
