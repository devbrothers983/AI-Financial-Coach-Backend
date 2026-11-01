import express from "express";

import {
    getAdminOverview,
    getAllUsers,
    getUserById,
    getUserTransactions,
    getUserActivityTimeline,
    updateUserRole,
    updateUserStatus,
    deleteUser,
    getUserActivity,
    getAdminReports,
    getAllMessages,
    updateMessageReadStatus,
    replyToMessage,
    deleteMessage,
    getActivityLogs,
    getUnreadMessageCount,
} from "../controllers/adminController.js";

import {
    getAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
} from "../controllers/announcementController.js";

import { authMiddleware, roleMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware, roleMiddleware("admin"));

router.get("/overview", getAdminOverview);
router.get("/reports", getAdminReports);
router.get("/activity", getUserActivity);
router.get("/logs", getActivityLogs);

router.get("/announcements", getAnnouncements);
router.post("/announcements", createAnnouncement);
router.put("/announcements/:id", updateAnnouncement);
router.delete("/announcements/:id", deleteAnnouncement);

router.get("/users", getAllUsers);
router.get("/users/:id", getUserById);
router.get("/users/:id/transactions", getUserTransactions);
router.get("/users/:id/activity", getUserActivityTimeline);
router.put("/users/:id/role", updateUserRole);
router.put("/users/:id/status", updateUserStatus);
router.delete("/users/:id", deleteUser);

router.get("/messages", getAllMessages);
router.get("/messages/unread-count", getUnreadMessageCount);
router.put("/messages/:id/read", updateMessageReadStatus);
router.post("/messages/:id/reply", replyToMessage);
router.delete("/messages/:id", deleteMessage);

export default router;
