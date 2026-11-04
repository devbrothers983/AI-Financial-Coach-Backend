import express from "express";

import {
    getSubscriptions,
    createSubscription,
    checkLink,
    updateSubscription,
    cancelSubscription,
    reactivateSubscription,
    deleteSubscription,
    dismissSubscription,
    restoreSubscription,
} from "../controllers/subscriptionController.js";

import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getSubscriptions);
router.post("/", createSubscription);
router.post("/check-link", checkLink);
router.post("/dismiss", dismissSubscription);
router.post("/restore", restoreSubscription);
router.put("/:id", updateSubscription);
router.post("/:id/cancel", cancelSubscription);
router.post("/:id/reactivate", reactivateSubscription);
router.delete("/:id", deleteSubscription);

export default router;
