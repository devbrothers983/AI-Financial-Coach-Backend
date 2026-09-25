import express from "express";

import {
    getDashboardOverview,
    getMonthlyTrends,
    getSavingsRate,
} from "../controllers/dashboardController.js";

import {
    authMiddleware
} from "../middlewares/authMiddleware.js";


const router = express.Router();


router.get(
    "/overview",
    authMiddleware,
    getDashboardOverview
);


router.get(
    "/monthly-trends",
    authMiddleware,
    getMonthlyTrends
);


router.get(
    "/savings-rate",
    authMiddleware,
    getSavingsRate
);


export default router;