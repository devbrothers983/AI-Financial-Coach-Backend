import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
                status: 401,
            });
        }

        const token = authHeader.split(" ")[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found",
                status: 401,
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "This account has been deactivated. Contact support for help.",
                status: 403,
            });
        }

        req.user = user;

        next();
    } catch (error) {
        next(error);
    }
};



// Sets req.user when a valid token is sent, but never rejects the request;
// for routes like the contact form that work signed in or not.
export const optionalAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
            const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
            const user = await User.findById(decoded.userId);
            if (user?.isActive) req.user = user;
        }
    } catch {
        // invalid or expired token: carry on as a guest
    }
    next();
};



export const roleMiddleware = (role) => {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to access this route",
                status: 403,
            })
        }
        next();
       
    }


}