import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import User from "../models/User.js";

dotenv.config();

const seedAdmin = async () => {
    const username = process.env.ADMIN_USERNAME || "Admin";
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
        console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before running this script.");
        process.exit(1);
    }

    if (password.length < 8) {
        console.error("ADMIN_PASSWORD must be at least 8 characters.");
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);

        const existing = await User.findOne({ email });

        if (existing) {
            if (existing.role === "admin") {
                console.log(`Admin already exists: ${email}`);
            } else {
                existing.role = "admin";
                await existing.save();
                console.log(`Existing user promoted to admin: ${email}`);
            }
        } else {
            const hashedPassword = await bcrypt.hash(password, 10);

            await User.create({
                username,
                email,
                password: hashedPassword,
                role: "admin",
            });

            console.log(`Admin account created: ${email}`);
        }
    } catch (err) {
        console.error("Failed to seed admin:", err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

seedAdmin();
