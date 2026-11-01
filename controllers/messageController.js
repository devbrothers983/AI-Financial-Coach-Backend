import ContactMessage from "../models/ContactMessage.js";
import { sendMail } from "../utils/mailer.js";
import { logActivity } from "../utils/activityLogger.js";

// A user's conversations: anything sent while signed in, plus older messages
// sent from the same email address before accounts were linked.
const ownQuery = (user) => ({ $or: [{ userId: user._id }, { email: user.email }] });

const unreadRepliesFor = (msg) =>
    (msg.replies || []).filter(
        (r) => r.from !== "user" && (!msg.userLastReadAt || new Date(r.createdAt) > new Date(msg.userLastReadAt))
    ).length;

const toThreadSummary = (msg) => {
    const last = msg.replies?.length ? msg.replies[msg.replies.length - 1] : null;
    return {
        _id: msg._id,
        subject: msg.subject,
        source: msg.source,
        createdAt: msg.createdAt,
        lastActivityAt: msg.lastActivityAt || last?.createdAt || msg.createdAt,
        replyCount: msg.replies?.length || 0,
        unreadCount: unreadRepliesFor(msg),
        lastMessage: {
            text: last ? last.message : msg.message,
            from: last ? last.from || "admin" : "user",
        },
    };
};

// ========================================
// List My Conversations
// ========================================

export const getMyMessages = async (req, res, next) => {
    try {
        const messages = await ContactMessage.find(ownQuery(req.user))
            .sort({ lastActivityAt: -1, createdAt: -1 })
            .limit(100)
            .lean();

        const threads = messages.map(toThreadSummary);

        return res.status(200).json({
            success: true,
            message: "Messages retrieved successfully",
            unreadCount: threads.reduce((sum, t) => sum + t.unreadCount, 0),
            threads,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Unread Count (sidebar badge)
// ========================================

export const getMyUnreadCount = async (req, res, next) => {
    try {
        const messages = await ContactMessage.find({ ...ownQuery(req.user), "replies.0": { $exists: true } })
            .select("replies userLastReadAt")
            .lean();

        return res.status(200).json({
            success: true,
            unreadCount: messages.reduce((sum, m) => sum + unreadRepliesFor(m), 0),
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Open a Conversation (marks it read)
// ========================================

export const getMyMessageById = async (req, res, next) => {
    try {
        // opening marks it read for the user, but not when an admin is viewing as them
        const message = req.impersonator
            ? await ContactMessage.findOne({ _id: req.params.id, ...ownQuery(req.user) }).lean()
            : await ContactMessage.findOneAndUpdate(
                  { _id: req.params.id, ...ownQuery(req.user) },
                  { userLastReadAt: new Date() },
                  { new: true, timestamps: false }
              ).lean();

        if (!message) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found",
                status: 404,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Conversation retrieved successfully",
            data: message,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Reply in a Conversation
// ========================================

export const replyToMyMessage = async (req, res, next) => {
    try {
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: "Reply message is required",
                status: 400,
            });
        }

        const contactMessage = await ContactMessage.findOne({ _id: req.params.id, ...ownQuery(req.user) });

        if (!contactMessage) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found",
                status: 404,
            });
        }

        const now = new Date();
        contactMessage.replies.push({
            message: message.trim(),
            repliedBy: req.user.username,
            from: "user",
            createdAt: now,
        });
        // back to unread for the support team
        contactMessage.isRead = false;
        contactMessage.userLastReadAt = now;
        contactMessage.lastActivityAt = now;
        if (!contactMessage.userId) contactMessage.userId = req.user._id;
        await contactMessage.save();

        logActivity(req, {
            action: "message.reply",
            description: `Replied in the conversation "${contactMessage.subject}"`,
            targetId: contactMessage._id,
            metadata: { subject: contactMessage.subject },
        });

        sendMail({
            to: process.env.EMAIL_USER,
            replyTo: req.user.email,
            subject: `[AI Financial Coach] New reply from ${req.user.username}: ${contactMessage.subject}`,
            text: `${req.user.username} (${req.user.email}) replied:\n\n${message.trim()}`,
            html: `
                <p><strong>${req.user.username}</strong> (${req.user.email}) replied in "${contactMessage.subject}":</p>
                <p>${message.trim().replace(/\n/g, "<br/>")}</p>
            `,
        }).catch((err) => {
            console.error("Failed to send reply notification:", err.message);
        });

        return res.status(200).json({
            success: true,
            message: "Reply sent",
            data: contactMessage,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
