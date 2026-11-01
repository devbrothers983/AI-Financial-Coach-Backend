import Announcement from "../models/Announcement.js";
import User from "../models/User.js";
import { notifyMany } from "../utils/notify.js";
import { sendMail } from "../utils/mailer.js";
import { logActivity } from "../utils/activityLogger.js";

const audienceQuery = (audience) => {
    const query = { isActive: { $ne: false } };
    if (audience === "users") query.role = "user";
    if (audience === "admins") query.role = "admin";
    return query;
};

const escapeHtml = (value = "") =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Emails go out one at a time in the background so a large audience doesn't
// hold up the request or trip Gmail's rate limits.
const emailAnnouncement = async (announcement, recipients) => {
    let sent = 0;
    for (const user of recipients) {
        try {
            await sendMail({
                to: user.email,
                subject: announcement.title,
                text: `Hi ${user.username},\n\n${announcement.body}\n\nThe AI Financial Coach Team`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                        <h2 style="color: #4f46e5;">${escapeHtml(announcement.title)}</h2>
                        <p>Hi ${escapeHtml(user.username)},</p>
                        <p>${escapeHtml(announcement.body).replace(/\n/g, "<br/>")}</p>
                        <p style="margin-top: 24px;">The AI Financial Coach Team</p>
                    </div>
                `,
            });
            sent += 1;
        } catch (err) {
            console.error(`Announcement email to ${user.email} failed:`, err.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await Announcement.updateOne({ _id: announcement._id }, { emailedCount: sent });
};

// ========================================
// Admin: list / create / update / delete
// ========================================

export const getAnnouncements = async (req, res, next) => {
    try {
        const announcements = await Announcement.find().sort({ createdAt: -1 }).limit(100).lean();

        return res.status(200).json({
            success: true,
            message: "Announcements retrieved successfully",
            announcements: announcements.map(({ dismissedBy, ...a }) => ({ ...a, dismissedCount: dismissedBy?.length || 0 })),
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const createAnnouncement = async (req, res, next) => {
    try {
        const { title, body, level, audience, link, linkLabel, expiresAt, sendEmail } = req.body;

        if (!title?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Title is required",
                status: 400,
            });
        }

        const announcement = await Announcement.create({
            title,
            body,
            level,
            audience,
            link: link?.startsWith("/") ? link : "",
            linkLabel,
            expiresAt: expiresAt || null,
            emailed: Boolean(sendEmail),
            createdBy: req.user._id,
            createdByName: req.user.username,
        });

        const recipients = await User.find(audienceQuery(announcement.audience)).select("_id username email").lean();

        const notified = await notifyMany(
            recipients.map((u) => u._id),
            {
                type: "announcement",
                level: announcement.level === "warning" ? "warning" : announcement.level === "success" ? "success" : "info",
                title: announcement.title,
                body: announcement.body,
                link: announcement.link,
                metadata: { announcementId: announcement._id },
            }
        );

        if (sendEmail) {
            emailAnnouncement(announcement, recipients).catch((err) =>
                console.error("Announcement emails failed:", err.message)
            );
        }

        logActivity(req, {
            action: "admin.announcement_create",
            description: `Published announcement "${announcement.title}" to ${announcement.audience} (${recipients.length} people${sendEmail ? ", with email" : ""})`,
            targetUserId: null,
            targetId: announcement._id,
            metadata: { audience: announcement.audience, recipients: recipients.length, emailed: Boolean(sendEmail) },
        });

        return res.status(201).json({
            success: true,
            message: `Announcement published to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`,
            announcement,
            recipients: recipients.length,
            notified,
            status: 201,
        });
    } catch (err) {
        next(err);
    }
};

export const updateAnnouncement = async (req, res, next) => {
    try {
        const allowed = ["title", "body", "level", "link", "linkLabel", "active", "expiresAt"];
        const updateData = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));

        const announcement = await Announcement.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
                status: 404,
            });
        }

        logActivity(req, {
            action: "admin.announcement_update",
            description:
                "active" in updateData
                    ? `${updateData.active ? "Re-published" : "Took down"} announcement "${announcement.title}"`
                    : `Edited announcement "${announcement.title}"`,
            targetUserId: null,
            targetId: announcement._id,
        });

        return res.status(200).json({
            success: true,
            message: "Announcement updated",
            announcement,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const deleteAnnouncement = async (req, res, next) => {
    try {
        const announcement = await Announcement.findByIdAndDelete(req.params.id);

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: "Announcement not found",
                status: 404,
            });
        }

        logActivity(req, {
            action: "admin.announcement_delete",
            description: `Deleted announcement "${announcement.title}"`,
            targetUserId: null,
            targetId: announcement._id,
        });

        return res.status(200).json({
            success: true,
            message: "Announcement deleted",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Users: active banners + dismiss
// ========================================

export const getActiveAnnouncements = async (req, res, next) => {
    try {
        const audiences = ["all", req.user.role === "admin" ? "admins" : "users"];

        const announcements = await Announcement.find({
            active: true,
            audience: { $in: audiences },
            dismissedBy: { $ne: req.user._id },
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        })
            .select("title body level link linkLabel createdAt")
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        return res.status(200).json({
            success: true,
            announcements,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const dismissAnnouncement = async (req, res, next) => {
    try {
        await Announcement.updateOne({ _id: req.params.id }, { $addToSet: { dismissedBy: req.user._id } });

        return res.status(200).json({
            success: true,
            message: "Announcement dismissed",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
