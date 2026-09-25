import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Goal from "../models/Goal.js";
import ContactMessage from "../models/ContactMessage.js";
import { sendMail } from "../utils/mailer.js";

const SAFE_USER_FIELDS = "username email role currency isActive lastLoginAt createdAt onboardingCompleted avatarUrl authProvider";

// ========================================
// Platform Overview
// ========================================

export const getAdminOverview = async (req, res, next) => {
    try {
        const now = new Date();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

        // Accounts created before the isActive field existed have no
        // stored value for it; treat "not explicitly false" as active
        // rather than requiring an exact `true` match.
        const [
            totalUsers,
            activeUsers,
            totalAdmins,
            newUsersThisMonth,
            totalTransactions,
            totalBudgets,
            totalActiveGoals,
            monthSummary,
            recentSignups,
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ isActive: { $ne: false } }),
            User.countDocuments({ role: "admin" }),
            User.countDocuments({ createdAt: { $gte: startOfMonth } }),
            Transaction.countDocuments(),
            Budget.countDocuments(),
            Goal.countDocuments({ status: "active" }),
            Transaction.aggregate([
                { $match: { transactionDate: { $gte: startOfMonth, $lt: endOfMonth } } },
                { $group: { _id: "$transactionType", totalAmount: { $sum: "$transactionAmount" } } },
            ]),
            User.find().select(SAFE_USER_FIELDS).sort({ createdAt: -1 }).limit(5),
        ]);

        let platformIncome = 0;
        let platformExpenses = 0;

        monthSummary.forEach((item) => {
            if (item._id === "income") platformIncome = item.totalAmount;
            if (item._id === "expense") platformExpenses = item.totalAmount;
        });

        return res.status(200).json({
            success: true,
            message: "Admin overview retrieved successfully",
            overview: {
                period: { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() },
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    inactive: totalUsers - activeUsers,
                    admins: totalAdmins,
                    newThisMonth: newUsersThisMonth,
                },
                platformFinances: {
                    totalTransactions,
                    totalBudgets,
                    totalActiveGoals,
                    monthlyVolume: platformIncome + platformExpenses,
                    monthlyIncome: platformIncome,
                    monthlyExpenses: platformExpenses,
                },
                recentSignups,
            },
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// List / Search Users
// ========================================

export const getAllUsers = async (req, res, next) => {
    try {
        const { search, role, status, page = 1, limit = 20 } = req.query;

        const query = {};

        if (search) {
            const regex = new RegExp(search.trim(), "i");
            query.$or = [{ username: regex }, { email: regex }];
        }

        if (role) query.role = role;
        if (status === "active") query.isActive = { $ne: false };
        if (status === "inactive") query.isActive = false;

        const pageNumber = Math.max(Number(page) || 1, 1);
        const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const skip = (pageNumber - 1) * limitNumber;

        const [users, totalUsers] = await Promise.all([
            User.find(query).select(SAFE_USER_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limitNumber),
            User.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            message: "Users retrieved successfully",
            count: users.length,
            pagination: {
                currentPage: pageNumber,
                totalPages: Math.ceil(totalUsers / limitNumber),
                totalUsers,
                limit: limitNumber,
            },
            users,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Get Single User (with activity counts)
// ========================================

export const getUserById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const user = await User.findById(id).select(SAFE_USER_FIELDS);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404,
            });
        }

        const [transactionCount, budgetCount, goalCount] = await Promise.all([
            Transaction.countDocuments({ userId: id }),
            Budget.countDocuments({ userId: id }),
            Goal.countDocuments({ userId: id }),
        ]);

        return res.status(200).json({
            success: true,
            message: "User retrieved successfully",
            user: {
                ...user.toObject(),
                stats: { transactionCount, budgetCount, goalCount },
            },
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Update Role
// ========================================

export const updateUserRole = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!["user", "admin"].includes(role)) {
            return res.status(400).json({
                success: false,
                message: "role must be 'user' or 'admin'",
                status: 400,
            });
        }

        if (id === req.user._id.toString() && role !== "admin") {
            return res.status(400).json({
                success: false,
                message: "You can't remove your own admin access",
                status: 400,
            });
        }

        const user = await User.findByIdAndUpdate(id, { role }, { new: true, runValidators: true }).select(SAFE_USER_FIELDS);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "User role updated successfully",
            user,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Activate / Deactivate
// ========================================

export const updateUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (typeof isActive !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "isActive must be true or false",
                status: 400,
            });
        }

        if (id === req.user._id.toString() && !isActive) {
            return res.status(400).json({
                success: false,
                message: "You can't deactivate your own account",
                status: 400,
            });
        }

        const user = await User.findByIdAndUpdate(id, { isActive }, { new: true }).select(SAFE_USER_FIELDS);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: `User ${isActive ? "activated" : "deactivated"} successfully`,
            user,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Delete User (and their data)
// ========================================

export const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (id === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: "You can't delete your own account",
                status: 400,
            });
        }

        const user = await User.findByIdAndDelete(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404,
            });
        }

        await Promise.all([
            Transaction.deleteMany({ userId: id }),
            Budget.deleteMany({ userId: id }),
            Goal.deleteMany({ userId: id }),
        ]);

        return res.status(200).json({
            success: true,
            message: "User and their data deleted successfully",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Recent Activity (signups + logins)
// ========================================

export const getUserActivity = async (req, res, next) => {
    try {
        const [recentSignups, recentLogins] = await Promise.all([
            User.find().select("username email role createdAt").sort({ createdAt: -1 }).limit(20),
            User.find({ lastLoginAt: { $ne: null } }).select("username email role lastLoginAt").sort({ lastLoginAt: -1 }).limit(20),
        ]);

        const events = [
            ...recentSignups.map((u) => ({
                type: "signup",
                userId: u._id,
                username: u.username,
                email: u.email,
                role: u.role,
                timestamp: u.createdAt,
            })),
            ...recentLogins.map((u) => ({
                type: "login",
                userId: u._id,
                username: u.username,
                email: u.email,
                role: u.role,
                timestamp: u.lastLoginAt,
            })),
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.status(200).json({
            success: true,
            message: "User activity retrieved successfully",
            events: events.slice(0, 30),
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Platform-Wide Reports
// ========================================

export const getAdminReports = async (req, res, next) => {
    try {
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth();

        const trendStart = new Date(Date.UTC(currentYear, currentMonth - 5, 1));
        const trendEnd = new Date(Date.UTC(currentYear, currentMonth + 1, 1));

        const [transactionResults, userGrowthResults, categoryResults] = await Promise.all([
            Transaction.aggregate([
                { $match: { transactionDate: { $gte: trendStart, $lt: trendEnd } } },
                {
                    $group: {
                        _id: {
                            year: { $year: "$transactionDate" },
                            month: { $month: "$transactionDate" },
                            type: "$transactionType",
                        },
                        totalAmount: { $sum: "$transactionAmount" },
                    },
                },
            ]),
            User.aggregate([
                { $match: { createdAt: { $gte: trendStart, $lt: trendEnd } } },
                {
                    $group: {
                        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
                        count: { $sum: 1 },
                    },
                },
            ]),
            Transaction.aggregate([
                {
                    $match: {
                        transactionType: "expense",
                        transactionDate: { $gte: trendStart, $lt: trendEnd },
                    },
                },
                {
                    $group: {
                        _id: "$transactionCategory",
                        totalAmount: { $sum: "$transactionAmount" },
                    },
                },
                { $sort: { totalAmount: -1 } },
                { $limit: 8 },
            ]),
        ]);

        const trends = [];

        for (let i = 5; i >= 0; i--) {
            const date = new Date(Date.UTC(currentYear, currentMonth - i, 1));
            const year = date.getUTCFullYear();
            const month = date.getUTCMonth() + 1;
            const monthName = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });

            const incomeRecord = transactionResults.find(
                (item) => item._id.year === year && item._id.month === month && item._id.type === "income"
            );
            const expenseRecord = transactionResults.find(
                (item) => item._id.year === year && item._id.month === month && item._id.type === "expense"
            );
            const newUsersRecord = userGrowthResults.find(
                (item) => item._id.year === year && item._id.month === month
            );

            trends.push({
                month,
                monthName,
                year,
                income: incomeRecord ? incomeRecord.totalAmount : 0,
                expenses: expenseRecord ? expenseRecord.totalAmount : 0,
                newUsers: newUsersRecord ? newUsersRecord.count : 0,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Admin reports retrieved successfully",
            trends,
            topExpenseCategories: categoryResults.map((c) => ({ category: c._id, totalAmount: c.totalAmount })),
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Contact / Feedback Messages
// ========================================

export const getAllMessages = async (req, res, next) => {
    try {
        const { source, status, page = 1, limit = 20 } = req.query;

        const query = {};
        if (source === "contact" || source === "feedback") query.source = source;
        if (status === "unread") query.isRead = false;
        if (status === "read") query.isRead = true;

        const pageNumber = Math.max(Number(page) || 1, 1);
        const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const skip = (pageNumber - 1) * limitNumber;

        const [messages, totalMessages, unreadCount] = await Promise.all([
            ContactMessage.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNumber),
            ContactMessage.countDocuments(query),
            ContactMessage.countDocuments({ isRead: false }),
        ]);

        return res.status(200).json({
            success: true,
            message: "Messages retrieved successfully",
            count: messages.length,
            unreadCount,
            pagination: {
                currentPage: pageNumber,
                totalPages: Math.ceil(totalMessages / limitNumber),
                totalMessages,
                limit: limitNumber,
            },
            messages,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const updateMessageReadStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isRead } = req.body;

        if (typeof isRead !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "isRead must be true or false",
                status: 400,
            });
        }

        const updatedMessage = await ContactMessage.findByIdAndUpdate(id, { isRead }, { new: true });

        if (!updatedMessage) {
            return res.status(404).json({
                success: false,
                message: "Message not found",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Message updated successfully",
            data: updatedMessage,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const replyToMessage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: "Reply message is required",
                status: 400,
            });
        }

        const contactMessage = await ContactMessage.findById(id);

        if (!contactMessage) {
            return res.status(404).json({
                success: false,
                message: "Message not found",
                status: 404,
            });
        }

        await sendMail({
            to: contactMessage.email,
            subject: `Re: ${contactMessage.subject || "Your message to AI Financial Coach"}`,
            text: `Hi ${contactMessage.name},\n\n${message}\n\n---\nYour original message:\n${contactMessage.message}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                    <p>Hi ${contactMessage.name},</p>
                    <p>${message.replace(/\n/g, "<br/>")}</p>
                    <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;" />
                    <p style="color: #64748b; font-size: 13px;"><strong>Your original message:</strong><br/>${contactMessage.message.replace(/\n/g, "<br/>")}</p>
                </div>
            `,
        });

        contactMessage.replies.push({
            message: message.trim(),
            repliedBy: req.user.username,
        });
        contactMessage.isRead = true;
        await contactMessage.save();

        return res.status(200).json({
            success: true,
            message: "Reply sent successfully",
            data: contactMessage,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const deleteMessage = async (req, res, next) => {
    try {
        const { id } = req.params;

        const deletedMessage = await ContactMessage.findByIdAndDelete(id);

        if (!deletedMessage) {
            return res.status(404).json({
                success: false,
                message: "Message not found",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Message deleted successfully",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
