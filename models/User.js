import mongoose from 'mongoose';


const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'username is required'],
        trim: true,
        maxlength: [50, 'username must be less than 50 characters'],

    },

    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
    },

    password: {
        type: String,
        required: [
            function () {
                return this.authProvider === 'local';
            },
            'Password is required',
        ],
        minlength: [8, 'Password must be at least 8 characters long'],
        select: false,
    },

    googleId: {
        type: String,
        unique: true,
        sparse: true,
    },

    authProvider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local',
    },

    avatarUrl: {
        type: String,
        default: null,
    },

    avatarPublicId: {
        type: String,
        default: null,
        select: false,
    },

    resetPasswordOtp: {
        type: String,
        select: false,
    },

    resetPasswordOtpExpires: {
        type: Date,
        select: false,
    },


    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },

    currency: {
        type: String,
        default: "USD",
        uppercase: true,
    },

    financialProfile: {
        monthlyIncome: {
            type: Number,
            default: 0,
            min: 0,
        },

        employementType: {
            type: String,
            default: null,

        },

        dependents: {
            type: Number,
            default: 0,
            min: 0,
        },


    },

    onboardingCompleted: {
        type: Boolean,
        default: false,
    },

    isActive: {
        type: Boolean,
        default: true,
    },

    lastLoginAt: {
        type: Date,
        default: null,
    },
},
    {
        timestamps: true,
    }

);



const User = mongoose.model("User", userSchema);

export default User;