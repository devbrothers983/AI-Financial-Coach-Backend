import crypto from "crypto";
import Household from "../models/Household.js";
import HouseholdInvite from "../models/HouseholdInvite.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { summarizeHousehold } from "../utils/householdSummary.js";
import { notify } from "../utils/notify.js";
import { sendMail } from "../utils/mailer.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { logActivity } from "../utils/activityLogger.js";

const MAX_MEMBERS = 6;
const INVITE_DAYS = 7;
const SHARE_LEVELS = ["none", "totals", "transactions"];
const DAY_MS = 24 * 60 * 60 * 1000;

const fail = (res, status, message) => res.status(status).json({ success: false, message, status });

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const frontendUrl = () => (process.env.FRONTEND_URL || "").split(",")[0].trim().replace(/\/+$/, "");

const findHouseholdOf = (userId) => Household.findOne({ "members.userId": userId });

const memberOf = (household, userId) => household.members.find((m) => String(m.userId) === String(userId));

const readName = (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");

// ========================================
// The Household Page
// ========================================

export const getHousehold = async (req, res, next) => {
    try {
        const now = new Date();
        const [household, invites] = await Promise.all([
            findHouseholdOf(req.user._id).lean(),
            HouseholdInvite.find({ email: req.user.email, status: "pending", expiresAt: { $gt: now } }).lean(),
        ]);

        // invitations to this person, with the household's name
        const inviteHouseholds = await Household.find({ _id: { $in: invites.map((i) => i.householdId) } }).select("name").lean();
        const myInvites = invites
            .map((i) => ({
                _id: i._id,
                householdName: inviteHouseholds.find((h) => String(h._id) === String(i.householdId))?.name,
                invitedByName: i.invitedByName,
                expiresAt: i.expiresAt,
                // an account made after the invite must use the emailed link, which proves the inbox is theirs
                canAcceptHere: new Date(req.user.createdAt) < new Date(i.createdAt),
            }))
            .filter((i) => i.householdName);

        if (!household) {
            return res.status(200).json({ success: true, household: null, myInvites, status: 200 });
        }

        const me = memberOf(household, req.user._id);
        const isOwner = me.role === "owner";

        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const sharerIds = household.members.filter((m) => m.shareLevel !== "none").map((m) => m.userId);

        const [users, transactions, pendingInvites] = await Promise.all([
            User.find({ _id: { $in: household.members.map((m) => m.userId) } }).select("username email currency").lean(),
            sharerIds.length
                ? Transaction.find({
                      userId: { $in: sharerIds },
                      transactionDate: { $gte: monthStart },
                      possibleDuplicateOf: null,
                  })
                      .select("userId transactionType transactionAmount transactionCategory description transactionDate")
                      .lean()
                : [],
            isOwner ? HouseholdInvite.find({ householdId: household._id, status: "pending", expiresAt: { $gt: now } }).lean() : [],
        ]);

        const userById = new Map(users.map((u) => [String(u._id), u]));

        return res.status(200).json({
            success: true,
            household: {
                _id: household._id,
                name: household.name,
                isOwner,
                myShareLevel: me.shareLevel,
                members: household.members.map((m) => ({
                    userId: m.userId,
                    name: userById.get(String(m.userId))?.username || "Member",
                    // only the owner sees email addresses
                    email: isOwner ? userById.get(String(m.userId))?.email : undefined,
                    role: m.role,
                    shareLevel: m.shareLevel,
                    joinedAt: m.joinedAt,
                    isMe: String(m.userId) === String(req.user._id),
                })),
                pendingInvites: pendingInvites.map((i) => ({ _id: i._id, email: i.email, expiresAt: i.expiresAt })),
                summary: summarizeHousehold({ members: household.members, users, transactions }),
                month: monthStart.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
            },
            myInvites,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Create / Rename / Delete
// ========================================

export const createHousehold = async (req, res, next) => {
    try {
        const name = readName(req.body.name);
        if (!name) return fail(res, 400, "Give your household a name");
        if (name.length > 60) return fail(res, 400, "That name is too long");

        if (await findHouseholdOf(req.user._id)) return fail(res, 400, "You're already in a household");

        const household = await Household.create({
            name,
            ownerId: req.user._id,
            members: [{ userId: req.user._id, role: "owner", shareLevel: "none" }],
        });

        logActivity(req, { action: "household.create", description: `Created household "${name}"`, targetId: household._id });

        return res.status(201).json({ success: true, message: "Household created", status: 201 });
    } catch (err) {
        // the unique index: joined another household at the same moment
        if (err.code === 11000) return fail(res, 400, "You're already in a household");
        next(err);
    }
};

export const renameHousehold = async (req, res, next) => {
    try {
        const name = readName(req.body.name);
        if (!name || name.length > 60) return fail(res, 400, "Enter a name up to 60 characters");

        const result = await Household.updateOne({ ownerId: req.user._id, "members.userId": req.user._id }, { name });
        if (!result.matchedCount) return fail(res, 403, "Only the household owner can rename it");

        return res.status(200).json({ success: true, message: "Household renamed", status: 200 });
    } catch (err) {
        next(err);
    }
};

const deleteHouseholdAndInvites = (householdId) =>
    Promise.all([Household.deleteOne({ _id: householdId }), HouseholdInvite.deleteMany({ householdId })]);

export const deleteHousehold = async (req, res, next) => {
    try {
        const household = await Household.findOne({ ownerId: req.user._id, "members.userId": req.user._id });
        if (!household) return fail(res, 403, "Only the household owner can delete it");

        await deleteHouseholdAndInvites(household._id);

        await Promise.all(
            household.members
                .filter((m) => String(m.userId) !== String(req.user._id))
                .map((m) =>
                    notify(m.userId, {
                        type: "system",
                        title: `The household "${household.name}" was deleted`,
                        body: "Your own data wasn't affected.",
                        link: "/dashboard/household",
                    })
                )
        );

        logActivity(req, { action: "household.delete", description: `Deleted household "${household.name}"`, targetId: household._id });

        return res.status(200).json({ success: true, message: "Household deleted. Everyone's own data is unchanged.", status: 200 });
    } catch (err) {
        next(err);
    }
};

// ========================================
// What I Share
// ========================================

export const updateMySharing = async (req, res, next) => {
    try {
        const { shareLevel } = req.body;
        if (!SHARE_LEVELS.includes(shareLevel)) return fail(res, 400, "Choose what to share");

        const result = await Household.updateOne(
            { "members.userId": req.user._id },
            { $set: { "members.$.shareLevel": shareLevel } }
        );
        if (!result.matchedCount) return fail(res, 404, "You're not in a household");

        logActivity(req, { action: "household.share", description: `Changed household sharing to "${shareLevel}"`, metadata: { shareLevel } });

        return res.status(200).json({
            success: true,
            message: shareLevel === "none" ? "You're not sharing anything" : "Your sharing is updated",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Invites
// ========================================

export const inviteMember = async (req, res, next) => {
    try {
        const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
        if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return fail(res, 400, "Enter a valid email address");
        if (email === req.user.email) return fail(res, 400, "You're already in this household");

        const household = await Household.findOne({ ownerId: req.user._id, "members.userId": req.user._id });
        if (!household) return fail(res, 403, "Only the household owner can invite people");

        const now = new Date();
        const [invitee, pending] = await Promise.all([
            User.findOne({ email }).select("_id username").lean(),
            HouseholdInvite.find({ householdId: household._id, status: "pending", expiresAt: { $gt: now } }).lean(),
        ]);

        if (invitee && memberOf(household, invitee._id)) return fail(res, 400, "They're already in this household");

        const alreadyInvited = pending.find((i) => i.email === email);
        if (!alreadyInvited && household.members.length + pending.length >= MAX_MEMBERS) {
            return fail(res, 400, `A household can have up to ${MAX_MEMBERS} people, including invites`);
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(now.getTime() + INVITE_DAYS * DAY_MS);

        // inviting the same person again sends a fresh link and replaces the old one
        const invite = alreadyInvited
            ? await HouseholdInvite.findByIdAndUpdate(alreadyInvited._id, { tokenHash: hashToken(token), expiresAt }, { new: true })
            : await HouseholdInvite.create({
                  householdId: household._id,
                  email,
                  invitedBy: req.user._id,
                  invitedByName: req.user.username,
                  tokenHash: hashToken(token),
                  expiresAt,
              });

        const link = `${frontendUrl()}/dashboard/household?invite=${token}`;

        let emailSent = true;
        try {
            await sendMail({
                to: email,
                subject: `${req.user.username} invited you to their household on AI Financial Coach`,
                text: `${req.user.username} invited you to join "${household.name}" on AI Financial Coach.\n\nAccept the invitation: ${link}\n\nYou choose what you share: nothing is shared until you turn it on. This link expires in ${INVITE_DAYS} days.`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
                        <h2 style="color: #059669;">You're invited to a household</h2>
                        <p><strong>${escapeHtml(req.user.username)}</strong> invited you to join "${escapeHtml(household.name)}" on AI Financial Coach.</p>
                        <p style="margin: 24px 0;"><a href="${link}" style="background: #059669; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Accept the invitation</a></p>
                        <p style="color: #64748b; font-size: 13px;">You choose what you share: nothing is shared until you turn it on. This link expires in ${INVITE_DAYS} days.</p>
                    </div>
                `,
            });
        } catch (mailErr) {
            console.error("Household invite email failed:", mailErr.message);
            emailSent = false;
        }

        // an existing account also hears about it in the app
        if (invitee) {
            notify(invitee._id, {
                type: "system",
                title: `${req.user.username} invited you to their household`,
                body: `Join "${household.name}" to see a shared view of your money. You choose what you share.`,
                link: "/dashboard/household",
                dedupeKey: `household-invite:${invite._id}`,
            });
        }

        logActivity(req, {
            action: "household.invite",
            description: `Invited ${email} to household "${household.name}"`,
            targetId: household._id,
            metadata: { email },
        });

        return res.status(200).json({
            success: true,
            message: emailSent ? `Invitation sent to ${email}` : `Invitation saved, but the email couldn't be sent to ${email}`,
            emailSent,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const cancelInvite = async (req, res, next) => {
    try {
        const household = await Household.findOne({ ownerId: req.user._id, "members.userId": req.user._id }).select("_id").lean();
        if (!household) return fail(res, 403, "Only the household owner can cancel invites");

        const result = await HouseholdInvite.updateOne(
            { _id: req.params.id, householdId: household._id, status: "pending" },
            { status: "cancelled" }
        );
        if (!result.matchedCount) return fail(res, 404, "Invite not found");

        return res.status(200).json({ success: true, message: "Invite cancelled", status: 200 });
    } catch (err) {
        next(err);
    }
};

// Shared by both ways of accepting
const joinFromInvite = async (req, res, invite) => {
    if (invite.email !== req.user.email) {
        return fail(res, 403, `This invite was sent to ${invite.email}. Sign in with that email to accept it.`);
    }
    if (await findHouseholdOf(req.user._id)) return fail(res, 400, "Leave your current household before joining another one");

    const household = await Household.findById(invite.householdId);
    if (!household) return fail(res, 404, "That household no longer exists");
    if (household.members.length >= MAX_MEMBERS) return fail(res, 400, "That household is full");

    // the condition stops two quick clicks adding the same person twice
    const joined = await Household.updateOne(
        { _id: household._id, "members.userId": { $ne: req.user._id } },
        { $push: { members: { userId: req.user._id, role: "member", shareLevel: "none" } } }
    );
    if (!joined.modifiedCount) return fail(res, 400, "You're already in this household");

    await HouseholdInvite.updateOne({ _id: invite._id }, { status: "accepted" });

    notify(household.ownerId, {
        type: "system",
        level: "success",
        title: `${req.user.username} joined "${household.name}"`,
        body: "They choose what they share, so you may not see their numbers yet.",
        link: "/dashboard/household",
    });

    logActivity(req, { action: "household.join", description: `Joined household "${household.name}"`, targetId: household._id });

    return res.status(200).json({
        success: true,
        message: `You joined ${household.name}. You're not sharing anything yet.`,
        status: 200,
    });
};

// From the emailed link
export const acceptInviteByToken = async (req, res, next) => {
    try {
        const token = typeof req.body.token === "string" ? req.body.token : "";
        if (!/^[a-f0-9]{64}$/.test(token)) return fail(res, 400, "This invitation link isn't valid");

        const invite = await HouseholdInvite.findOne({ tokenHash: hashToken(token) }).lean();
        if (!invite || invite.status !== "pending") return fail(res, 400, "This invitation has already been used or cancelled");
        if (new Date(invite.expiresAt) < new Date()) return fail(res, 400, "This invitation has expired. Ask for a new one.");

        return joinFromInvite(req, res, invite);
    } catch (err) {
        if (err.code === 11000) return fail(res, 400, "Leave your current household before joining another one");
        next(err);
    }
};

// From the Household page, for an account that existed before the invite was sent
export const acceptInvite = async (req, res, next) => {
    try {
        const invite = await HouseholdInvite.findOne({
            _id: req.params.id,
            email: req.user.email,
            status: "pending",
            expiresAt: { $gt: new Date() },
        }).lean();
        if (!invite) return fail(res, 404, "Invite not found");

        if (new Date(req.user.createdAt) >= new Date(invite.createdAt)) {
            return fail(res, 403, "Open the invitation link we emailed you to accept this invite");
        }

        return joinFromInvite(req, res, invite);
    } catch (err) {
        if (err.code === 11000) return fail(res, 400, "Leave your current household before joining another one");
        next(err);
    }
};

export const declineInvite = async (req, res, next) => {
    try {
        const result = await HouseholdInvite.updateOne(
            { _id: req.params.id, email: req.user.email, status: "pending" },
            { status: "declined" }
        );
        if (!result.matchedCount) return fail(res, 404, "Invite not found");

        return res.status(200).json({ success: true, message: "Invite declined", status: 200 });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Leaving and Removing
// ========================================

// Takes a person out of their household. If they owned it, the longest-standing
// member takes over; if they were the last one, the household is deleted.
// Also used when an account is deleted. Returns what happened.
export const removeFromHousehold = async (userId) => {
    const household = await findHouseholdOf(userId);
    if (!household) return null;

    const others = household.members
        .filter((m) => String(m.userId) !== String(userId))
        .sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    if (!others.length) {
        await deleteHouseholdAndInvites(household._id);
        return { household, deleted: true };
    }

    const wasOwner = String(household.ownerId) === String(userId);
    household.members = household.members.filter((m) => String(m.userId) !== String(userId));
    if (wasOwner) {
        const newOwner = household.members.find((m) => String(m.userId) === String(others[0].userId));
        newOwner.role = "owner";
        household.ownerId = newOwner.userId;
    }
    await household.save();

    if (wasOwner) {
        notify(household.ownerId, {
            type: "system",
            title: `You're now the owner of "${household.name}"`,
            body: "The previous owner left, so you can now invite and remove people.",
            link: "/dashboard/household",
        });
    }

    return { household, deleted: false, newOwnerId: wasOwner ? household.ownerId : null };
};

export const removeAllFromHouseholds = (userIds) => Promise.all(userIds.map((id) => removeFromHousehold(id)));

export const leaveHousehold = async (req, res, next) => {
    try {
        const result = await removeFromHousehold(req.user._id);
        if (!result) return fail(res, 404, "You're not in a household");

        logActivity(req, { action: "household.leave", description: `Left household "${result.household.name}"`, targetId: result.household._id });

        return res.status(200).json({
            success: true,
            message: result.deleted
                ? "You left, and the household was deleted because no one else was in it"
                : "You left the household. Your own data is unchanged.",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const removeMember = async (req, res, next) => {
    try {
        if (String(req.params.userId) === String(req.user._id)) return fail(res, 400, "Use Leave household to remove yourself");

        const household = await Household.findOne({ ownerId: req.user._id, "members.userId": req.user._id });
        if (!household) return fail(res, 403, "Only the household owner can remove people");

        const target = memberOf(household, req.params.userId);
        if (!target) return fail(res, 404, "That person isn't in your household");

        household.members = household.members.filter((m) => String(m.userId) !== String(req.params.userId));
        await household.save();

        notify(target.userId, {
            type: "system",
            title: `You were removed from "${household.name}"`,
            body: "Your own data wasn't affected.",
            link: "/dashboard/household",
        });

        logActivity(req, {
            action: "household.remove",
            description: `Removed a member from household "${household.name}"`,
            targetUserId: target.userId,
            targetId: household._id,
        });

        return res.status(200).json({ success: true, message: "Removed from the household", status: 200 });
    } catch (err) {
        next(err);
    }
};
