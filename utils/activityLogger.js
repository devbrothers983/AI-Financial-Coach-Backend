import ActivityLog from "../models/ActivityLog.js";
import User from "../models/User.js";

// "Chrome on Android", "Safari on iPhone", ... from a user-agent string
export const describeDevice = (userAgent = "") => {
    const ua = userAgent.toLowerCase();
    if (!ua) return "";

    const browser = ua.includes("edg/")
        ? "Edge"
        : ua.includes("opr/") || ua.includes("opera")
          ? "Opera"
          : ua.includes("samsungbrowser")
            ? "Samsung Internet"
            : ua.includes("chrome/") || ua.includes("crios/")
              ? "Chrome"
              : ua.includes("firefox/") || ua.includes("fxios/")
                ? "Firefox"
                : ua.includes("safari/")
                  ? "Safari"
                  : "";

    const os = ua.includes("iphone")
        ? "iPhone"
        : ua.includes("ipad")
          ? "iPad"
          : ua.includes("android")
            ? "Android"
            : ua.includes("windows")
              ? "Windows"
              : ua.includes("mac os")
                ? "Mac"
                : ua.includes("linux")
                  ? "Linux"
                  : "";

    if (browser && os) return `${browser} on ${os}`;
    return browser || os || "Unknown device";
};

// Records an activity without ever failing or slowing the request it came
// from: the write is fire-and-forget and errors only go to the console.
//
//   logActivity(req, {
//       action: "transaction.delete",
//       description: "Deleted expense of 25 (food)",
//       actor: user,          // defaults to req.user
//       targetUserId,         // defaults to the actor
//       targetId,             // id of the affected record
//       metadata: { ... },
//   });
export const logActivity = (req, { action, description = "", actor, targetUserId, targetId = null, metadata = {} }) => {
    try {
        const who = actor || req?.user || null;

        const entry = {
            userId: who?._id || null,
            username: who?.username || "",
            email: who?.email || metadata.email || "",
            role: who?.role || "user",
            action,
            category: action.split(".")[0],
            description,
            targetUserId: targetUserId !== undefined ? targetUserId : who?._id || null,
            targetId,
            metadata,
            ip: req?.ip || "",
            userAgent: (req?.headers?.["user-agent"] || "").slice(0, 300),
        };

        ActivityLog.create(entry).catch((err) => {
            console.error("Failed to write activity log:", err.message);
        });
    } catch (err) {
        console.error("Failed to write activity log:", err.message);
    }
};

// Runs once, while the activity log is empty, so it doesn't start blank:
// seeds every existing user's signup and most recent sign-in. Written straight
// to the collection so the original dates are kept.
export const backfillActivityLog = async () => {
    try {
        if (await ActivityLog.estimatedDocumentCount()) return;

        const users = await User.find().select("username email role createdAt lastLoginAt").lean();

        const base = (u) => ({
            userId: u._id,
            username: u.username,
            email: u.email,
            role: u.role || "user",
            targetUserId: u._id,
            targetId: null,
            ip: "",
            userAgent: "",
        });

        const entries = users.flatMap((u) => [
            {
                ...base(u),
                action: "auth.signup",
                category: "auth",
                description: "Created an account",
                metadata: { backfilled: true },
                createdAt: u.createdAt,
            },
            ...(u.lastLoginAt
                ? [
                      {
                          ...base(u),
                          action: "auth.login",
                          category: "auth",
                          description: "Signed in",
                          metadata: { backfilled: true },
                          createdAt: u.lastLoginAt,
                      },
                  ]
                : []),
        ]);

        if (entries.length) {
            await ActivityLog.collection.insertMany(entries);
            console.log(`Activity log backfilled with ${entries.length} entries`);
        }
    } catch (err) {
        console.error("Activity log backfill failed:", err.message);
    }
};
