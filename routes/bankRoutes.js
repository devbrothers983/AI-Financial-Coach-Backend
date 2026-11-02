import express from "express";

import {
    getBankAccess,
    requireBankAccess,
    getConnections,
    createLinkToken,
    exchangePublicToken,
    syncNow,
    disconnectBank,
    plaidWebhook,
} from "../controllers/bankController.js";

import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

// called by Plaid, so it's verified by signature instead of a login
router.post("/webhook", plaidWebhook);

router.use(authMiddleware);

router.get("/access", getBankAccess);

router.use(requireBankAccess);

router.get("/connections", getConnections);
router.post("/link-token", createLinkToken);
router.post("/exchange", exchangePublicToken);
router.post("/connections/:id/sync", syncNow);
router.delete("/connections/:id", disconnectBank);

export default router;
