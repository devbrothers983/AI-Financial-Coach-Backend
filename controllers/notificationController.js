import Notification from "../models/Notification.js";

// ========================================
// List My Notifications
// ========================================

export const getMyNotifications = async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        const query = { userId: req.user._id };
        if (status === "unread") query.readAt = null;

        const pageNumber = Math.max(Number(page) || 1, 1);
        const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const skip = (pageNumber - 1) * limitNumber;

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNumber).lean(),
            Notification.countDocuments(query),
            Notification.countDocuments({ userId: req.user._id, readAt: null }),
        ]);

        return res.status(200).json({
            success: true,
            message: "Notifications retrieved successfully",
            unreadCount,
            pagination: {
                currentPage: pageNumber,
                totalPages: Math.ceil(total / limitNumber),
                total,
                limit: limitNumber,
            },
            notifications,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Unread Count (bell badge)
// ========================================

export const getMyUnreadNotificationCount = async (req, res, next) => {
    try {
        const unreadCount = await Notification.countDocuments({ userId: req.user._id, readAt: null });

        return res.status(200).json({
            success: true,
            unreadCount,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Mark One / All Read
// ========================================

export const markNotificationRead = async (req, res, next) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: "Notification not found",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Notification marked as read",
            notification,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const markAllNotificationsRead = async (req, res, next) => {
    try {
        const result = await Notification.updateMany({ userId: req.user._id, readAt: null }, { readAt: new Date() });

        return res.status(200).json({
            success: true,
            message: "All notifications marked as read",
            updated: result.modifiedCount,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Delete
// ========================================

export const deleteNotification = async (req, res, next) => {
    try {
        const deleted = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: "Notification not found",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Notification deleted",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
