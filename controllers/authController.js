import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import { sendWelcomeEmail, sendMail } from '../utils/mailer.js';
import { toTitleCase } from '../utils/formatText.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes


const generateToken = (id) => {

    return jwt.sign(
        { userId: id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    )
}


// register user
export const registerUser = async (req, res, next) => {
    try {

        let { username, email, password, confirmPassword } = req.body;


        if (!username || !email || !password || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "All fields are required",
                status: 400,
            })
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match",
                status: 400,
            })
        }

        username = toTitleCase(username);

        const user = await User.findOne({ email });



        if (user) {
            return res.status(400).json({
                success: false,
                message: "Email already exists"
            })
        }


        const hashedPassword = await bcrypt.hash(password, 10);

        await User.create({
            username,
            email,
            password: hashedPassword,
        })

        sendWelcomeEmail(username, email).catch((err) => {
            console.error("Failed to send welcome email:", err.message);
        });


        res.status(200).json({
            success: true,
            message: "User created successfully",
            status: 200,
            username,
            email
             


        })


    } catch (err) {
        next(err)
    }
}


// login user
export const loginUser = async (req, res, next) => {
    try {

        const { email, password } = req.body;

        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                status: 404
            })
        }

        if (!user.password) {
            return res.status(400).json({
                success: false,
                message: "This account uses Google Sign-In. Please continue with Google.",
                status: 400
            })
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);

        if (!isPasswordCorrect) {
            return res.status(400).json({
                success: false,
                message: "Incorrect password",
                status: 400
            })
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "This account has been deactivated. Contact support for help.",
                status: 403
            })
        }

        user.lastLoginAt = new Date();
        await user.save();

        const token = generateToken(user._id);

        res.status(200).json({
            success: true,
            message: "Login successful",
            status: 200,
            username: user.username,
            email: user.email,
            role: user.role,
            token


        })


    } catch (err) {
        next(err)
    }
}


// google oauth login/register
export const googleAuth = async (req, res, next) => {
    try {

        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({
                success: false,
                message: "Google credential is required",
                status: 400,
            })
        }

        let ticket;
        try {
            ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
        } catch {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired Google credential",
                status: 401,
            })
        }

        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;

        let user = await User.findOne({ email });
        let isNewUser = false;

        if (!user) {
            user = await User.create({
                username: toTitleCase(name),
                email,
                googleId,
                authProvider: "google",
            });
            isNewUser = true;
        } else if (!user.googleId) {
            user.googleId = googleId;
            await user.save();
        }

        if (!isNewUser && !user.isActive) {
            return res.status(403).json({
                success: false,
                message: "This account has been deactivated. Contact support for help.",
                status: 403,
            })
        }

        if (isNewUser) {
            sendWelcomeEmail(user.username, user.email).catch((err) => {
                console.error("Failed to send welcome email:", err.message);
            });
        }

        user.lastLoginAt = new Date();
        await user.save();

        const token = generateToken(user._id);

        res.status(200).json({
            success: true,
            message: "Google login successful",
            status: 200,
            username: user.username,
            email: user.email,
            role: user.role,
            token,
        })

    } catch (err) {
        next(err)
    }
}


// forgot password - request a reset code
export const forgotPassword = async (req, res, next) => {
    try {

        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required",
                status: 400,
            })
        }

        const user = await User.findOne({ email });

        // Only send a reset code for accounts that have a local password.
        // Respond identically either way so we never reveal whether an email is registered.
        if (user && user.authProvider === 'local') {

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

            user.resetPasswordOtp = hashedOtp;
            user.resetPasswordOtpExpires = Date.now() + OTP_TTL_MS;
            await user.save();

            sendMail({
                to: user.email,
                subject: "Your AI Financial Coach password reset code",
                text: `Hi ${user.username},\n\nYour password reset code is: ${otp}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                        <h2 style="color: #059669;">Reset your password</h2>
                        <p>Hi ${user.username},</p>
                        <p>Use the code below to reset your AI Financial Coach password. It expires in 10 minutes.</p>
                        <p style="margin: 24px 0; text-align: center;">
                            <span style="display: inline-block; padding: 14px 28px; font-size: 28px; font-weight: 700; letter-spacing: 8px; background: #f1f5f9; border-radius: 10px; color: #059669;">${otp}</span>
                        </p>
                        <p style="color: #64748b; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
                    </div>
                `,
            }).catch((err) => {
                console.error("Failed to send password reset code:", err.message);
            });
        }

        return res.status(200).json({
            success: true,
            message: "If an account with that email exists, a reset code has been sent.",
            status: 200,
        })

    } catch (err) {
        next(err)
    }
}


// reset password using the emailed code
export const resetPassword = async (req, res, next) => {
    try {

        const { email, otp, password, confirmPassword } = req.body;

        if (!email || !otp || !password || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Email, code, password and confirm password are required",
                status: 400,
            })
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match",
                status: 400,
            })
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters",
                status: 400,
            })
        }

        const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

        const user = await User.findOne({
            email,
            resetPasswordOtp: hashedOtp,
            resetPasswordOtpExpires: { $gt: Date.now() },
        }).select('+resetPasswordOtp +resetPasswordOtpExpires');

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired code",
                status: 400,
            })
        }

        user.password = await bcrypt.hash(password, 10);
        user.resetPasswordOtp = undefined;
        user.resetPasswordOtpExpires = undefined;
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Password reset successful. You can now sign in.",
            status: 200,
        })

    } catch (err) {
        next(err)
    }
}