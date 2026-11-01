import express from "express";

import { getActiveAnnouncements, dismissAnnouncement } from "../controllers/announcementController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/active", getActiveAnnouncements);
router.post("/:id/dismiss", dismissAnnouncement);

export default router;
