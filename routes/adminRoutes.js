import express from "express";

import {
    getAdminOverview,
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    deleteUser,
    getUserActivity,
    getAdminReports,
    getAllMessages,
    updateMessageReadStatus,
    replyToMessage,
    deleteMessage,
} from "../controllers/adminController.js";

import { authMiddleware, roleMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware, roleMiddleware("admin"));

router.get("/overview", getAdminOverview);
router.get("/reports", getAdminReports);
router.get("/activity", getUserActivity);

router.get("/users", getAllUsers);
router.get("/users/:id", getUserById);
router.put("/users/:id/role", updateUserRole);
router.put("/users/:id/status", updateUserStatus);
router.delete("/users/:id", deleteUser);

router.get("/messages", getAllMessages);
router.put("/messages/:id/read", updateMessageReadStatus);
router.post("/messages/:id/reply", replyToMessage);
router.delete("/messages/:id", deleteMessage);

export default router;
