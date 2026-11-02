import bcrypt from "bcrypt";
import User from "../models/User.js";
import { getCloudinary } from "../config/cloudinary.js";
import { toTitleCase } from "../utils/formatText.js";
import { logActivity, describeDevice } from "../utils/activityLogger.js";
import { notify } from "../utils/notify.js";
import { generateToken } from "../utils/token.js";
import ActivityLog from "../models/ActivityLog.js";
import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Goal from "../models/Goal.js";
import Notification from "../models/Notification.js";
import ContactMessage from "../models/ContactMessage.js";
import Announcement from "../models/Announcement.js";
import { sendMail } from "../utils/mailer.js";
import { removeAllConnectionsForUsers } from "../utils/bankSync.js";

const LOGIN_HISTORY_ACTIONS = [
    "auth.login",
    "auth.login_failed",
    "auth.login_blocked",
    "auth.password_reset",
    "auth.logout_all",
    "profile.password_change",
];

// Whitelist exactly what the client is allowed to see, rather than trusting
// whatever fields happen to exist on the document (e.g. stale fields left
// over from a previous schema version).
const toSafeUser = (user, extra = {}) => ({
    _id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    authProvider: user.authProvider,
    avatarUrl: user.avatarUrl,
    currency: user.currency,
    financialProfile: user.financialProfile,
    onboardingCompleted: user.onboardingCompleted,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...extra,
});

const uploadBufferToCloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const uploadStream = getCloudinary().uploader.upload_stream(
            {
                folder: "ai-financial-coach/avatars",
                transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
};


// get current user's profile
export const getProfile = async (req, res, next) => {
    try {

        const user = await User.findById(req.user._id).select('+password');
        const hasPassword = Boolean(user.password);

        return res.status(200).json({
            success: true,
            message: "Profile retrieved successfully",
            user: toSafeUser(user, { hasPassword }),
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// update username / email
export const updateProfile = async (req, res, next) => {
    try {

        const { username, email } = req.body;
        const updateData = {};

        if (username !== undefined) {
            if (!username.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Username cannot be empty",
                    status: 400,
                });
            }
            updateData.username = toTitleCase(username);
        }

        if (email !== undefined && email !== req.user.email) {
            const existing = await User.findOne({ email });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: "Email already in use",
                    status: 400,
                });
            }
            updateData.email = email;
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            updateData,
            { new: true, runValidators: true }
        );

        const changed = Object.keys(updateData);
        if (changed.length) {
            logActivity(req, {
                action: "profile.update",
                description: `Updated profile (${changed.join(", ")})`,
                metadata: { fields: changed, ...(updateData.email && { previousEmail: req.user.email }) },
            });
        }

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            user: toSafeUser(updatedUser),
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// change (or set) password
export const changePassword = async (req, res, next) => {
    try {

        const { currentPassword, newPassword, confirmNewPassword } = req.body;

        if (!newPassword || !confirmNewPassword) {
            return res.status(400).json({
                success: false,
                message: "New password and confirmation are required",
                status: 400,
            });
        }

        if (newPassword !== confirmNewPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match",
                status: 400,
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters",
                status: 400,
            });
        }

        const user = await User.findById(req.user._id).select('+password');

        // Accounts that signed up with Google may not have a password yet.
        // In that case, this sets one for the first time instead of changing it.
        if (user.password) {
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    message: "Current password is required",
                    status: 400,
                });
            }

            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return res.status(400).json({
                    success: false,
                    message: "Current password is incorrect",
                    status: 400,
                });
            }
        }

        const hadPassword = Boolean(user.password);
        user.password = await bcrypt.hash(newPassword, 10);
        // signs out other devices; this one gets a fresh token below
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();

        logActivity(req, {
            action: "profile.password_change",
            description: hadPassword ? "Changed password" : "Set a password for the first time",
        });

        notify(user._id, {
            type: "security",
            level: "warning",
            title: hadPassword ? "Your password was changed" : "A password was added to your account",
            body: "Other devices have been signed out. If this wasn't you, reset your password right away.",
            link: "/dashboard/settings",
        });

        return res.status(200).json({
            success: true,
            message: "Password updated successfully",
            token: generateToken(user),
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// upload / replace profile photo
export const uploadAvatar = async (req, res, next) => {
    try {

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No image file provided",
                status: 400,
            });
        }

        const result = await uploadBufferToCloudinary(req.file.buffer);

        const user = await User.findById(req.user._id).select('+avatarPublicId');
        const oldPublicId = user.avatarPublicId;

        user.avatarUrl = result.secure_url;
        user.avatarPublicId = result.public_id;
        await user.save();

        if (oldPublicId) {
            getCloudinary().uploader.destroy(oldPublicId).catch((err) => {
                console.error("Failed to delete old avatar:", err.message);
            });
        }

        logActivity(req, { action: "profile.avatar_update", description: "Changed profile photo" });

        return res.status(200).json({
            success: true,
            message: "Profile photo updated successfully",
            avatarUrl: user.avatarUrl,
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// remove profile photo
export const deleteAvatar = async (req, res, next) => {
    try {

        const user = await User.findById(req.user._id).select('+avatarPublicId');

        if (user.avatarPublicId) {
            getCloudinary().uploader.destroy(user.avatarPublicId).catch((err) => {
                console.error("Failed to delete avatar:", err.message);
            });
        }

        user.avatarUrl = null;
        user.avatarPublicId = null;
        await user.save();

        logActivity(req, { action: "profile.avatar_remove", description: "Removed profile photo" });

        return res.status(200).json({
            success: true,
            message: "Profile photo removed",
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// recent sign-ins and security events for the signed-in user
export const getLoginHistory = async (req, res, next) => {
    try {
        const logs = await ActivityLog.find({ userId: req.user._id, action: { $in: LOGIN_HISTORY_ACTIONS } })
            .select("action description ip userAgent createdAt metadata")
            .sort({ createdAt: -1 })
            .limit(30)
            .lean();

        // the newest real sign-in from this browser is very likely this session
        const currentAgent = req.headers["user-agent"] || "";
        const currentIndex = logs.findIndex((l) => l.action === "auth.login" && l.userAgent && l.userAgent === currentAgent);

        return res.status(200).json({
            success: true,
            message: "Login history retrieved successfully",
            history: logs.map((l, i) => ({
                _id: l._id,
                action: l.action,
                description: l.description,
                device: describeDevice(l.userAgent),
                ip: l.ip,
                method: l.metadata?.method,
                isCurrent: i === currentIndex,
                createdAt: l.createdAt,
            })),
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// signs out every device, then hands this device a fresh token
export const logoutAllDevices = async (req, res, next) => {
    try {

        const user = await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } }, { new: true });

        logActivity(req, { action: "auth.logout_all", description: "Signed out of all other devices" });

        notify(user._id, {
            type: "security",
            level: "info",
            title: "Signed out of all other devices",
            body: "Any other browser or phone signed in to your account will need to sign in again.",
            link: "/dashboard/settings",
        });

        return res.status(200).json({
            success: true,
            message: "Signed out of all other devices",
            token: generateToken(user),
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};


// permanently delete the signed-in user's account and everything in it
export const deleteMyAccount = async (req, res, next) => {
    try {

        const { password, confirmation } = req.body;

        const user = await User.findById(req.user._id).select("+password +avatarPublicId");

        // accounts with a password confirm with it; Google-only accounts type DELETE
        if (user.password) {
            if (!password || !(await bcrypt.compare(password, user.password))) {
                return res.status(400).json({
                    success: false,
                    message: "Password is incorrect",
                    status: 400,
                });
            }
        } else if (confirmation !== "DELETE") {
            return res.status(400).json({
                success: false,
                message: 'Type DELETE to confirm',
                status: 400,
            });
        }

        if (user.role === "admin") {
            const otherAdmins = await User.countDocuments({ role: "admin", _id: { $ne: user._id } });
            if (!otherAdmins) {
                return res.status(400).json({
                    success: false,
                    message: "You're the only admin. Make someone else an admin before deleting your account.",
                    status: 400,
                });
            }
        }

        const userId = user._id;

        // ends Plaid's access to their bank, and its monthly fee
        await removeAllConnectionsForUsers([userId]);

        await Promise.all([
            Transaction.deleteMany({ userId }),
            Budget.deleteMany({ userId }),
            Goal.deleteMany({ userId }),
            Notification.deleteMany({ userId }),
            ContactMessage.deleteMany({ $or: [{ userId }, { email: user.email }] }),
            Announcement.updateMany({}, { $pull: { dismissedBy: userId } }),
        ]);

        if (user.avatarPublicId) {
            getCloudinary().uploader.destroy(user.avatarPublicId).catch((err) => {
                console.error("Failed to delete avatar:", err.message);
            });
        }

        await User.deleteOne({ _id: userId });

        // the audit trail keeps a record that the account existed and was closed
        logActivity(req, {
            action: "auth.account_delete",
            description: "Deleted their own account and data",
            actor: user,
            metadata: { email: user.email },
        });

        sendMail({
            to: user.email,
            subject: "Your AI Financial Coach account has been deleted",
            text: `Hi ${user.username},\n\nYour account and all of its data have been permanently deleted. We're sorry to see you go — you're always welcome back.\n\nThe AI Financial Coach Team`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                    <p>Hi ${user.username},</p>
                    <p>Your account and all of its data have been permanently deleted.</p>
                    <p>We're sorry to see you go — you're always welcome back.</p>
                    <p style="margin-top: 24px;">The AI Financial Coach Team</p>
                </div>
            `,
        }).catch((err) => console.error("Account deletion email failed:", err.message));

        return res.status(200).json({
            success: true,
            message: "Your account has been deleted",
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};
