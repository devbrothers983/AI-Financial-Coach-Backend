import express from "express";
import {
    getProfile,
    updateProfile,
    changePassword,
    uploadAvatar,
    deleteAvatar,
} from "../controllers/userController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/uploadMiddleware.js";

const router = express.Router();

router.get("/me", authMiddleware, getProfile);
router.put("/me", authMiddleware, updateProfile);
router.put("/me/password", authMiddleware, changePassword);
router.post("/me/avatar", authMiddleware, upload.single("avatar"), uploadAvatar);
router.delete("/me/avatar", authMiddleware, deleteAvatar);

export default router;
