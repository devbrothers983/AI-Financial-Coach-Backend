import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const tooMany = (message) => ({ success: false, message, status: 429 });

const emailOf = (req) => String(req.body?.email || "").trim().toLowerCase();

const limiter = (options) => rateLimit({ standardHeaders: true, legacyHeaders: false, ...options });

// Password guessing against one account from one address; correct logins don't count
export const loginAttemptLimiter = limiter({
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${emailOf(req)}`,
    message: tooMany("Too many failed sign-in attempts. Please wait 15 minutes and try again."),
});

// Trying many accounts, or creating many, from one address
export const authIpLimiter = limiter({
    windowMs: FIFTEEN_MINUTES,
    limit: 50,
    message: tooMany("Too many requests. Please wait a few minutes and try again."),
});

// Each request sends an email
export const forgotPasswordLimiter = limiter({
    windowMs: FIFTEEN_MINUTES,
    limit: 5,
    message: tooMany("Too many reset requests. Please wait 15 minutes and try again."),
});

// Guessing a reset code. Counted per email, so changing address doesn't give more guesses.
export const resetPasswordLimiter = limiter({
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    keyGenerator: (req) => emailOf(req) || ipKeyGenerator(req.ip),
    message: tooMany("Too many attempts. Please wait 15 minutes and request a new code."),
});

// Each question costs money at the AI provider. Counted per signed-in user.
export const coachChatLimiter = limiter({
    windowMs: ONE_HOUR,
    limit: 30,
    keyGenerator: (req) => String(req.user._id),
    message: tooMany("You've asked a lot of questions this hour. Please try again a little later."),
});

// Public form that sends an email for every message
export const contactLimiter = limiter({
    windowMs: ONE_HOUR,
    limit: 10,
    message: tooMany("Too many messages. Please try again later."),
});
