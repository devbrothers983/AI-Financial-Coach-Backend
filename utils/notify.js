import Notification from "../models/Notification.js";

// Creates an in-app notification. Like logActivity it never throws, so it
// can't break the request that triggered it. With a dedupeKey, the same
// notification is only ever created once per user.
//
//   notify(userId, {
//       type: "budget_alert",
//       level: "warning",
//       title: "You've used 80% of your Food budget",
//       body: "...",
//       link: "/dashboard/budgets",
//       dedupeKey: "budget:<id>:food:80",
//   });
//
// Resolves to true when a new notification was created.
export const notify = async (userId, { type = "system", level = "info", title, body = "", link = "", dedupeKey = null, metadata = {} }) => {
    if (!userId || !title) return false;

    try {
        const doc = { userId, type, level, title, body, link, dedupeKey, metadata };

        if (!dedupeKey) {
            await Notification.create(doc);
            return true;
        }

        const result = await Notification.updateOne(
            { userId, dedupeKey },
            { $setOnInsert: { ...doc, readAt: null } },
            { upsert: true, timestamps: true }
        );
        return result.upsertedCount > 0;
    } catch (err) {
        // a duplicate-key race just means it already exists
        if (err.code !== 11000) console.error("Failed to create notification:", err.message);
        return false;
    }
};

// Same notification for many users at once (announcements)
export const notifyMany = async (userIds, payload) => {
    if (!userIds.length || !payload.title) return 0;

    try {
        const docs = userIds.map((userId) => ({
            userId,
            type: payload.type || "system",
            level: payload.level || "info",
            title: payload.title,
            body: payload.body || "",
            link: payload.link || "",
            dedupeKey: payload.dedupeKey || null,
            metadata: payload.metadata || {},
            readAt: null,
        }));
        const result = await Notification.insertMany(docs, { ordered: false });
        return result.length;
    } catch (err) {
        console.error("Failed to create notifications:", err.message);
        return err.insertedDocs?.length || 0;
    }
};
