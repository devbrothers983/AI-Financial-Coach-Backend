import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Goal from "../models/Goal.js";
import ContactMessage from "../models/ContactMessage.js";
import ActivityLog from "../models/ActivityLog.js";
import Notification from "../models/Notification.js";
import Subscription from "../models/Subscription.js";
import CoachChat from "../models/CoachChat.js";
import Category from "../models/Category.js";
import CategoryRule from "../models/CategoryRule.js";
import { sendMail } from "../utils/mailer.js";
import { logActivity, describeDevice } from "../utils/activityLogger.js";
import { notify } from "../utils/notify.js";
import { removeAllConnectionsForUsers } from "../utils/bankSync.js";
import { removeAllFromHouseholds } from "./householdController.js";
import { escapeHtml, textToHtml } from "../utils/escapeHtml.js";
import { generateViewAsToken, VIEW_AS_MINUTES } from "../utils/token.js";
import { toCsv, sendCsv, USER_COLUMNS, TRANSACTION_COLUMNS, todayStamp } from "../utils/csv.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Activity-log categories as they're grouped in a user's timeline
const LOG_CATEGORY_TO_TYPE = {
    auth: "account",
    profile: "account",
    bank: "account",
    subscription: "account",
    category: "account",
    household: "account",
    transaction: "transaction",
    budget: "budget",
    goal: "goal",
    message: "message",
    admin: "admin",
};

// Already shown in the timeline from the user's own records
const ACTIONS_COVERED_BY_RECORDS = ["auth.signup", "transaction.create", "budget.create", "goal.create", "goal.complete"];

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
            const regex = new RegExp(escapeRegex(search.trim()), "i");
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

        // The timeline combines two sources: records the user created (which
        // also covers activity from before the activity log existed) and the
        // activity log (every sign-in, edit, delete and admin action). Log
        // entries that the records already describe are skipped.
        const wants = (kind) => !type || type === kind;

        const logCategories = Object.entries(LOG_CATEGORY_TO_TYPE)
            .filter(([, kind]) => wants(kind))
            .map(([category]) => category);

        const [transactions, budgets, goals, messages, logs] = await Promise.all([
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
            logCategories.length
                ? ActivityLog.find({
                      targetUserId: id,
                      category: { $in: logCategories },
                      action: { $nin: ACTIONS_COVERED_BY_RECORDS },
                  })
                      .sort({ createdAt: -1 })
                      .limit(limit)
                : [],
        ]);

        const hasLoggedLogins = logs.some((l) => l.action === "auth.login");

        const accountEvents = [];
        if (wants("account")) {
            accountEvents.push({ type: "account", action: "signup", title: "Created an account", timestamp: user.createdAt });
            if (user.lastLoginAt && !hasLoggedLogins) {
                accountEvents.push({ type: "account", action: "login", title: "Signed in", detail: "Most recent sign-in", timestamp: user.lastLoginAt });
            }
        }

        const logEvents = logs.map((l) => ({
            type: LOG_CATEGORY_TO_TYPE[l.category],
            action: l.action.split(".")[1],
            title: l.description,
            amount: l.metadata?.amount ?? l.metadata?.totalBudget ?? undefined,
            meta: {
                ...(l.category === "admin" && { by: l.username }),
                ...(l.ip && { ip: l.ip }),
                ...(l.userAgent && { device: describeDevice(l.userAgent) }),
            },
            timestamp: l.createdAt,
        }));

        const monthName = (m, y) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

        const events = [
            ...accountEvents,
            ...logEvents,
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

        logActivity(req, {
            action: "admin.user_role",
            description: `Changed ${user.username}'s role to ${role}`,
            targetUserId: user._id,
            metadata: { targetUsername: user.username, targetEmail: user.email, role },
        });

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

        logActivity(req, {
            action: "admin.user_status",
            description: `${isActive ? "Reactivated" : "Deactivated"} ${user.username}'s account`,
            targetUserId: user._id,
            metadata: { targetUsername: user.username, targetEmail: user.email, isActive },
        });

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

        // ends Plaid's access to their bank, and its monthly fee
        await removeAllConnectionsForUsers([id]);
        await removeAllFromHouseholds([id]);

        await Promise.all([
            Transaction.deleteMany({ userId: id }),
            Budget.deleteMany({ userId: id }),
            Goal.deleteMany({ userId: id }),
            Notification.deleteMany({ userId: id }),
            Subscription.deleteMany({ userId: id }),
            CoachChat.deleteOne({ userId: id }),
            Category.deleteMany({ userId: id }),
            CategoryRule.deleteMany({ userId: id }),
        ]);

        logActivity(req, {
            action: "admin.user_delete",
            description: `Deleted ${user.username}'s account and data`,
            targetUserId: user._id,
            metadata: { targetUsername: user.username, targetEmail: user.email },
        });

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
            ContactMessage.find(query).sort({ lastActivityAt: -1, createdAt: -1 }).skip(skip).limit(limitNumber),
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

        const now = new Date();
        contactMessage.replies.push({
            message: message.trim(),
            repliedBy: req.user.username,
            from: "admin",
            createdAt: now,
        });
        contactMessage.isRead = true;
        contactMessage.lastActivityAt = now;

        const recipient = contactMessage.userId
            ? { _id: contactMessage.userId }
            : await User.findOne({ email: contactMessage.email }).select("_id");
        if (recipient && !contactMessage.userId) contactMessage.userId = recipient._id;

        // Saved first so the reply is never lost; users with an account also
        // see it in their dashboard inbox, so the email is a notification.
        await contactMessage.save();

        logActivity(req, {
            action: "admin.message_reply",
            description: `Replied to ${contactMessage.name}'s message "${contactMessage.subject}"`,
            targetUserId: recipient?._id || null,
            targetId: contactMessage._id,
            metadata: { targetEmail: contactMessage.email, subject: contactMessage.subject },
        });

        if (recipient) {
            notify(recipient._id, {
                type: "message_reply",
                level: "info",
                title: "New reply from support",
                body: `Re: ${contactMessage.subject}`,
                link: `/dashboard/inbox?thread=${contactMessage._id}`,
            });
        }

        const frontendUrl = (process.env.FRONTEND_URL || "").split(",")[0].trim().replace(/\/+$/, "");
        const inboxLink = recipient && frontendUrl ? `${frontendUrl}/dashboard/inbox?thread=${contactMessage._id}` : null;

        let emailSent = true;
        try {
            await sendMail({
                to: contactMessage.email,
                subject: `Re: ${contactMessage.subject || "Your message to AI Financial Coach"}`,
                text: `Hi ${contactMessage.name},\n\n${message}${inboxLink ? `\n\nView or reply in your dashboard: ${inboxLink}` : ""}\n\n---\nYour original message:\n${contactMessage.message}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                        <p>Hi ${escapeHtml(contactMessage.name)},</p>
                        <p>${textToHtml(message)}</p>
                        ${inboxLink ? `<p style="margin: 24px 0;"><a href="${inboxLink}" style="background: #4f46e5; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">View or reply in your dashboard</a></p>` : ""}
                        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;" />
                        <p style="color: #64748b; font-size: 13px;"><strong>Your original message:</strong><br/>${textToHtml(contactMessage.message)}</p>
                    </div>
                `,
            });
        } catch (mailErr) {
            console.error("Reply email failed:", mailErr.message);
            emailSent = false;
        }

        if (!emailSent && !recipient) {
            return res.status(502).json({
                success: false,
                message: "Reply saved, but the email couldn't be sent and this person has no account to see it in. Check the email settings on the server.",
                data: contactMessage,
                status: 502,
            });
        }

        return res.status(200).json({
            success: true,
            message: emailSent
                ? "Reply sent successfully"
                : "Reply saved and shown in the user's inbox, but the email couldn't be sent",
            emailSent,
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

        logActivity(req, {
            action: "admin.message_delete",
            description: `Deleted a message from ${deletedMessage.name} ("${deletedMessage.subject}")`,
            targetUserId: null,
            targetId: deletedMessage._id,
            metadata: { targetEmail: deletedMessage.email, subject: deletedMessage.subject },
        });

        return res.status(200).json({
            success: true,
            message: "Message deleted successfully",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Activity Log (audit trail)
// ========================================

export const getActivityLogs = async (req, res, next) => {
    try {
        const { search, category, action, userId, page = 1, limit = 25 } = req.query;

        const query = {};

        if (search?.trim()) {
            const regex = new RegExp(escapeRegex(search.trim()), "i");
            query.$or = [{ username: regex }, { email: regex }, { description: regex }, { "metadata.targetEmail": regex }];
        }
        if (category) query.category = category;
        if (action) query.action = { $in: String(action).split(",") };
        if (userId) query.$and = [{ $or: [{ userId }, { targetUserId: userId }] }];

        const pageNumber = Math.max(Number(page) || 1, 1);
        const limitNumber = Math.min(Math.max(Number(limit) || 25, 1), 100);
        const skip = (pageNumber - 1) * limitNumber;

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [logs, totalLogs, last24h] = await Promise.all([
            ActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNumber).lean(),
            ActivityLog.countDocuments(query),
            ActivityLog.aggregate([
                { $match: { createdAt: { $gte: since } } },
                { $group: { _id: "$action", count: { $sum: 1 } } },
            ]),
        ]);

        const countFor = (predicate) => last24h.filter((r) => predicate(r._id)).reduce((sum, r) => sum + r.count, 0);

        return res.status(200).json({
            success: true,
            message: "Activity logs retrieved successfully",
            pagination: {
                currentPage: pageNumber,
                totalPages: Math.ceil(totalLogs / limitNumber),
                totalLogs,
                limit: limitNumber,
            },
            summary: {
                signIns: countFor((a) => a === "auth.login"),
                failedSignIns: countFor((a) => a === "auth.login_failed" || a === "auth.login_blocked"),
                dataChanges: countFor((a) => /^(transaction|budget|goal|profile)\./.test(a)),
                adminActions: countFor((a) => a.startsWith("admin.")),
            },
            logs: logs.map((l) => ({ ...l, device: describeDevice(l.userAgent) })),
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Unread Messages Count (sidebar badge)
// ========================================

export const getUnreadMessageCount = async (req, res, next) => {
    try {
        const unreadCount = await ContactMessage.countDocuments({ isRead: false });

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
// CSV Exports
// ========================================

export const exportUsers = async (req, res, next) => {
    try {
        const { search, role, status } = req.query;

        const query = {};
        if (search) {
            const regex = new RegExp(escapeRegex(search.trim()), "i");
            query.$or = [{ username: regex }, { email: regex }];
        }
        if (role) query.role = role;
        if (status === "active") query.isActive = { $ne: false };
        if (status === "inactive") query.isActive = false;

        const users = await User.find(query).select(SAFE_USER_FIELDS).sort({ createdAt: -1 }).lean();

        logActivity(req, {
            action: "admin.export_users",
            description: `Exported ${users.length} users to CSV`,
            targetUserId: null,
            metadata: { count: users.length, search, role, status },
        });

        return sendCsv(res, `users-${todayStamp()}.csv`, toCsv(users, USER_COLUMNS));
    } catch (err) {
        next(err);
    }
};

export const exportUserTransactions = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id).select("username email").lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404,
            });
        }

        const transactions = await Transaction.find({ userId: user._id }).sort({ transactionDate: -1 }).lean();

        logActivity(req, {
            action: "admin.export_transactions",
            description: `Exported ${user.username}'s ${transactions.length} transactions to CSV`,
            targetUserId: user._id,
            metadata: { targetUsername: user.username, targetEmail: user.email, count: transactions.length },
        });

        const safeName = user.username.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        return sendCsv(res, `${safeName}-transactions-${todayStamp()}.csv`, toCsv(transactions, TRANSACTION_COLUMNS));
    } catch (err) {
        next(err);
    }
};

// ========================================
// Bulk User Actions
// ========================================

const BULK_ACTIONS = ["activate", "deactivate", "delete"];
const MAX_BULK = 200;

export const bulkUserAction = async (req, res, next) => {
    try {
        const { ids, action } = req.body;

        if (!BULK_ACTIONS.includes(action)) {
            return res.status(400).json({
                success: false,
                message: `action must be one of: ${BULK_ACTIONS.join(", ")}`,
                status: 400,
            });
        }

        if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK) {
            return res.status(400).json({
                success: false,
                message: `Select between 1 and ${MAX_BULK} users`,
                status: 400,
            });
        }

        // never act on your own account
        const selfId = req.user._id.toString();
        const targetIds = [...new Set(ids.map(String))].filter((id) => id !== selfId);
        const users = await User.find({ _id: { $in: targetIds } }).select("username email role isActive").lean();

        if (!users.length) {
            return res.status(400).json({
                success: false,
                message: "None of the selected users can be changed",
                status: 400,
            });
        }

        const userIds = users.map((u) => u._id);

        if (action === "delete") {
            await removeAllConnectionsForUsers(userIds);
            await removeAllFromHouseholds(userIds);
            await Promise.all([
                User.deleteMany({ _id: { $in: userIds } }),
                Transaction.deleteMany({ userId: { $in: userIds } }),
                Budget.deleteMany({ userId: { $in: userIds } }),
                Goal.deleteMany({ userId: { $in: userIds } }),
                Notification.deleteMany({ userId: { $in: userIds } }),
                Subscription.deleteMany({ userId: { $in: userIds } }),
                CoachChat.deleteMany({ userId: { $in: userIds } }),
                Category.deleteMany({ userId: { $in: userIds } }),
                CategoryRule.deleteMany({ userId: { $in: userIds } }),
            ]);
        } else {
            await User.updateMany({ _id: { $in: userIds } }, { isActive: action === "activate" });
        }

        const verb = { activate: "Reactivated", deactivate: "Deactivated", delete: "Deleted" }[action];

        users.forEach((u) =>
            logActivity(req, {
                action: action === "delete" ? "admin.user_delete" : "admin.user_status",
                description: `${verb} ${u.username}'s account (bulk action)`,
                targetUserId: u._id,
                metadata: { targetUsername: u.username, targetEmail: u.email, bulk: true, ...(action !== "delete" && { isActive: action === "activate" }) },
            })
        );

        const skippedSelf = ids.map(String).includes(selfId);

        return res.status(200).json({
            success: true,
            message: `${verb} ${users.length} ${users.length === 1 ? "user" : "users"}${skippedSelf ? " (your own account was skipped)" : ""}`,
            affected: users.length,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Growth (weekly series for the overview charts)
// ========================================

// Monday 00:00 UTC of the week containing `date`
const startOfWeekUTC = (date) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const daysSinceMonday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - daysSinceMonday);
    return d;
};

const weekTrunc = (field) => ({ $dateTrunc: { date: field, unit: "week", startOfWeek: "monday", timezone: "UTC" } });

export const getAdminGrowth = async (req, res, next) => {
    try {
        const weeks = Math.min(Math.max(Number(req.query.weeks) || 12, 4), 52);

        const thisWeek = startOfWeekUTC(new Date());
        const start = new Date(thisWeek);
        start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7);

        const [signups, active, coach] = await Promise.all([
            User.aggregate([
                { $match: { createdAt: { $gte: start } } },
                { $group: { _id: weekTrunc("$createdAt"), count: { $sum: 1 } } },
            ]),
            // distinct people who did anything that week (signed in, saved data, used the coach...)
            ActivityLog.aggregate([
                { $match: { createdAt: { $gte: start }, userId: { $ne: null }, role: "user" } },
                { $group: { _id: { week: weekTrunc("$createdAt"), user: "$userId" } } },
                { $group: { _id: "$_id.week", count: { $sum: 1 } } },
            ]),
            ActivityLog.aggregate([
                { $match: { createdAt: { $gte: start }, action: "coach.ask" } },
                { $group: { _id: weekTrunc("$createdAt"), count: { $sum: 1 } } },
            ]),
        ]);

        const byWeek = (rows) => Object.fromEntries(rows.map((r) => [new Date(r._id).toISOString(), r.count]));
        const signupMap = byWeek(signups);
        const activeMap = byWeek(active);
        const coachMap = byWeek(coach);

        const series = Array.from({ length: weeks }, (_, i) => {
            const weekStart = new Date(start);
            weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
            const key = weekStart.toISOString();
            return {
                weekStart: key,
                signups: signupMap[key] || 0,
                activeUsers: activeMap[key] || 0,
                coachUses: coachMap[key] || 0,
            };
        });

        return res.status(200).json({
            success: true,
            message: "Growth data retrieved successfully",
            weeks: series,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Read-only "view as user"
// ========================================

export const createViewAsToken = async (req, res, next) => {
    try {
        const target = await User.findById(req.params.id).select("username email role isActive tokenVersion");

        if (!target) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404,
            });
        }

        if (target.role === "admin") {
            return res.status(400).json({
                success: false,
                message: "Admin accounts can't be viewed this way",
                status: 400,
            });
        }

        if (target.isActive === false) {
            return res.status(400).json({
                success: false,
                message: "Reactivate this account to view it",
                status: 400,
            });
        }

        const token = generateViewAsToken(target, req.user);

        logActivity(req, {
            action: "admin.view_as",
            description: `Viewed ${target.username}'s dashboard (read-only)`,
            targetUserId: target._id,
            metadata: { targetUsername: target.username, targetEmail: target.email },
        });

        return res.status(200).json({
            success: true,
            message: "Read-only view ready",
            token,
            user: { _id: target._id, username: target.username, email: target.email, role: target.role },
            expiresInMinutes: VIEW_AS_MINUTES,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
