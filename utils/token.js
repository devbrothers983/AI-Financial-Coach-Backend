import jwt from "jsonwebtoken";

// Login token for a user. `tv` is the user's tokenVersion: tokens carrying an
// older version are rejected, which is how "sign out of all devices" works.
export const generateToken = (user) =>
    jwt.sign({ userId: user._id, tv: user.tokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

export const isTokenCurrent = (decoded, user) => (decoded.tv || 0) === (user.tokenVersion || 0);

export const VIEW_AS_MINUTES = 30;

// Short-lived token that lets an admin see a user's dashboard. `imp` is the
// admin's id and `ro` marks it read-only; authMiddleware enforces both.
export const generateViewAsToken = (target, admin) =>
    jwt.sign(
        { userId: target._id, tv: target.tokenVersion || 0, imp: admin._id, ro: true },
        process.env.JWT_SECRET,
        { expiresIn: `${VIEW_AS_MINUTES}m` }
    );
