import jwt from "jsonwebtoken";

// Login token for a user. `tv` is the user's tokenVersion: tokens carrying an
// older version are rejected, which is how "sign out of all devices" works.
export const generateToken = (user) =>
    jwt.sign({ userId: user._id, tv: user.tokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

export const isTokenCurrent = (decoded, user) => (decoded.tv || 0) === (user.tokenVersion || 0);
