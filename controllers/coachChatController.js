import CoachChat from "../models/CoachChat.js";
import { buildFinancialContext } from "../utils/financialContext.js";
import { logActivity } from "../utils/activityLogger.js";
import { aiServiceHeaders } from "../utils/aiService.js";

const MAX_QUESTION_LENGTH = 1000;
// how much of the conversation the AI sees, and how much is kept
const MESSAGES_SENT_TO_AI = 12;
const MESSAGES_KEPT = 100;
const AI_TIMEOUT_MS = 60000;

// ========================================
// Load the Conversation
// ========================================

export const getChat = async (req, res, next) => {
    try {
        const chat = await CoachChat.findOne({ userId: req.user._id }).lean();

        return res.status(200).json({
            success: true,
            messages: chat?.messages || [],
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Ask a Question
// ========================================

export const sendMessage = async (req, res, next) => {
    try {
        const message = typeof req.body.message === "string" ? req.body.message.trim() : "";

        if (!message) {
            return res.status(400).json({ success: false, message: "Type a question first", status: 400 });
        }

        if (message.length > MAX_QUESTION_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Questions can be up to ${MAX_QUESTION_LENGTH} characters`,
                status: 400,
            });
        }

        const [chat, financialContext] = await Promise.all([
            CoachChat.findOne({ userId: req.user._id }).lean(),
            buildFinancialContext(req.user),
        ]);

        const history = (chat?.messages || []).slice(-MESSAGES_SENT_TO_AI).map(({ role, content }) => ({ role, content }));

        let aiResponse;
        try {
            aiResponse = await fetch(`${process.env.AI_SERVICE_URL}/ai/chat`, {
                method: "POST",
                headers: aiServiceHeaders(),
                body: JSON.stringify({ message, history, financial_context: financialContext }),
                signal: AbortSignal.timeout(AI_TIMEOUT_MS),
            });
        } catch (err) {
            console.error(`AI chat request failed: ${err.name}`);
            aiResponse = null;
        }

        if (!aiResponse?.ok) {
            if (aiResponse) console.error(`AI chat failed with status ${aiResponse.status}`);
            return res.status(502).json({
                success: false,
                message: "The coach couldn't answer right now. Please try again in a moment.",
                status: 502,
            });
        }

        const { reply } = await aiResponse.json();

        // Saved only after a good answer, so a failed try leaves no half-finished chat
        const now = new Date();
        const newMessages = [
            { role: "user", content: message, createdAt: now },
            { role: "assistant", content: reply, createdAt: new Date(now.getTime() + 1) },
        ];

        await CoachChat.updateOne(
            { userId: req.user._id },
            { $push: { messages: { $each: newMessages, $slice: -MESSAGES_KEPT } } },
            { upsert: true }
        );

        // counted in the admin's usage chart; the question itself stays private
        logActivity(req, {
            action: "coach.ask",
            description: "Asked the AI coach a question",
        });

        return res.status(200).json({
            success: true,
            messages: newMessages,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Start Over
// ========================================

export const clearChat = async (req, res, next) => {
    try {
        await CoachChat.deleteOne({ userId: req.user._id });

        return res.status(200).json({
            success: true,
            message: "Conversation cleared",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
