import bcrypt from "bcrypt";
import User from "../models/User.js";
import { getCloudinary } from "../config/cloudinary.js";
import { toTitleCase } from "../utils/formatText.js";

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

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Password updated successfully",
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

        return res.status(200).json({
            success: true,
            message: "Profile photo removed",
            status: 200,
        });

    } catch (err) {
        next(err);
    }
};
