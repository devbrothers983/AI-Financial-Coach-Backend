import express from "express";

import {
    getHousehold,
    createHousehold,
    renameHousehold,
    deleteHousehold,
    updateMySharing,
    inviteMember,
    cancelInvite,
    acceptInviteByToken,
    acceptInvite,
    declineInvite,
    leaveHousehold,
    removeMember,
} from "../controllers/householdController.js";

import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getHousehold);
router.post("/", createHousehold);
router.put("/", renameHousehold);
router.delete("/", deleteHousehold);

router.put("/me/sharing", updateMySharing);
router.post("/leave", leaveHousehold);
router.delete("/members/:userId", removeMember);

router.post("/invites", inviteMember);
router.post("/invites/accept", acceptInviteByToken);
router.post("/invites/:id/accept", acceptInvite);
router.post("/invites/:id/decline", declineInvite);
router.delete("/invites/:id", cancelInvite);

export default router;
