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

        const [transactionCount, budgetCount, goalCount, messageCount, totals, budgets, goals] = await Promise.all([
            Transaction.countDocuments({ userId: id }),
            Budget.countDocuments({ userId: id }),
            Goal.countDocuments({ userId: id }),
            ContactMessage.countDocuments({ email: user.email }),
            Transaction.aggregate([
                { $match: { userId: user._id } },
                { $group: { _id: "$transactionType", total: { $sum: "$transactionAmount" } } },
            ]),
            Budget.find({ userId: id }).select("month year totalBudget categories").sort({ year: -1, month: -1 }).limit(12),
            Goal.find({ userId: id }).select("title targetAmount currentAmount targetDate status priority").sort({ createdAt: -1 }),
        ]);

        const totalIncome = totals.find((t) => t._id === "income")?.total || 0;
        const totalExpense = totals.find((t) => t._id === "expense")?.total || 0;

        return res.status(200).json({
            success: true,
            message: "User retrieved successfully",
            user: {
                ...user.toObject(),
                stats: { transactionCount, budgetCount, goalCount, messageCount, totalIncome, totalExpense },
                budgets,
                goals,
            },
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// A User's Transactions
// ========================================

export const getUserTransactions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { type, page = 1, limit = 20 } = req.query;

        const query = { userId: id };
        if (type === "income" || type === "expense") query.transactionType = type;

        const pageNumber = Math.max(Number(page) || 1, 1);
        const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const skip = (pageNumber - 1) * limitNumber;

        const [transactions, totalTransactions] = await Promise.all([
            Transaction.find(query).sort({ transactionDate: -1, createdAt: -1 }).skip(skip).limit(limitNumber),
            Transaction.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            message: "User transactions retrieved successfully",
            pagination: {
                currentPage: pageNumber,
                totalPages: Math.ceil(totalTransactions / limitNumber),
                totalTransactions,
                limit: limitNumber,
            },
            transactions,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// A User's Activity Timeline
// ========================================

export const getUserActivityTimeline = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { type } = req.query;
        const limit = Math.min(Math.max(Number(req.query.limit) || 150, 1), 300);

        const user = await User.findById(id).select("username email createdAt lastLoginAt");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404,
            });
        }

        // There's no dedicated activity log, so the timeline is built from
        // the timestamps on everything the user has created.
        const wants = (kind) => !type || type === kind;

        const [transactions, budgets, goals, messages] = await Promise.all([
            wants("transaction")
                ? Transaction.find({ userId: id })
                      .select("transactionType transactionAmount transactionCategory description paymentMethod transactionDate isRecurring createdAt")
                      .sort({ createdAt: -1 })
                      .limit(limit)
                : [],
            wants("budget")
                ? Budget.find({ userId: id }).select("month year totalBudget categories createdAt").sort({ createdAt: -1 }).limit(limit)
                : [],
            wants("goal")
                ? Goal.find({ userId: id })
                      .select("title targetAmount currentAmount targetDate status priority createdAt updatedAt")
                      .sort({ createdAt: -1 })
                      .limit(limit)
                : [],
            wants("message")
                ? ContactMessage.find({ email: user.email }).select("subject message source replies createdAt").sort({ createdAt: -1 }).limit(limit)
                : [],
        ]);

        const accountEvents = [];
        if (wants("account")) {
            accountEvents.push({ type: "account", action: "signup", title: "Created an account", timestamp: user.createdAt });
            if (user.lastLoginAt) {
                accountEvents.push({ type: "account", action: "login", title: "Signed in", detail: "Most recent sign-in", timestamp: user.lastLoginAt });
            }
        }

        const monthName = (m, y) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

        const events = [
            ...accountEvents,
            ...transactions.map((t) => ({
                type: "transaction",
                action: t.transactionType,
                title: `Recorded ${t.transactionType === "income" ? "income" : "an expense"}`,
                detail: t.description || undefined,
                amount: t.transactionAmount,
                meta: {
                    category: t.transactionCategory,
                    paymentMethod: t.paymentMethod,
                    transactionDate: t.transactionDate,
                    recurring: t.isRecurring,
                },
                timestamp: t.createdAt,
            })),
            ...budgets.map((b) => ({
                type: "budget",
                action: "created",
                title: `Set a budget for ${monthName(b.month, b.year)}`,
                amount: b.totalBudget,
                meta: { categoryCount: b.categories?.length || 0 },
                timestamp: b.createdAt,
            })),
            ...goals.flatMap((g) => {
                const created = {
                    type: "goal",
                    action: "created",
                    title: `Created goal "${g.title}"`,
                    amount: g.targetAmount,
                    meta: { priority: g.priority, targetDate: g.targetDate, status: g.status },
                    timestamp: g.createdAt,
                };
                if (g.status !== "completed") return [created];
                return [
                    created,
                    {
                        type: "goal",
                        action: "completed",
                        title: `Completed goal "${g.title}"`,
                        amount: g.currentAmount,
                        timestamp: g.updatedAt,
                    },
                ];
            }),
            ...messages.map((m) => ({
                type: "message",
                action: m.source,
                title: m.source === "feedback" ? "Sent feedback" : "Contacted support",
                detail: m.subject,
                meta: {
                    preview: m.message?.slice(0, 160),
                    replied: (m.replies?.length || 0) > 0,
                },
                timestamp: m.createdAt,
            })),
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.status(200).json({
            success: true,
            message: "User activity retrieved successfully",
            events: events.slice(0, limit),
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

        try {
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
        } catch (mailErr) {
            console.error("Reply email failed:", mailErr.message);
            return res.status(502).json({
                success: false,
                message: "Couldn't send the reply email. Check the email settings on the server and try again.",
                status: 502,
            });
        }

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
