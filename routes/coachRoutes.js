import express from "express";

import {
    checkAffordability,
} from "../controllers/coachController.js";

import {
    authMiddleware,
} from "../middlewares/authMiddleware.js";


const router =
    express.Router();


router.post(
    "/affordability",
    authMiddleware,
    checkAffordability
);


export default router;