import { notify } from "./notify.js";

const MILESTONES = [100, 75, 50, 25];

const MESSAGES = {
    25: "A quarter of the way there — keep it up!",
    50: "Halfway there!",
    75: "Three quarters done — the finish line is in sight.",
    100: "Goal reached. Congratulations!",
};

const money = (amount, currency = "USD") => {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
        return `${currency} ${Number(amount).toFixed(2)}`;
    }
};

// Notifies the user the first time a goal passes 25%, 50%, 75% and 100%.
// Only the highest milestone reached is sent, so a big deposit doesn't
// produce a burst of notifications. Errors are only logged.
export const checkGoalMilestones = async (userId, goal, currency = "USD") => {
    try {
        if (!goal?.targetAmount) return;

        const percent = Math.floor(((goal.currentAmount || 0) / goal.targetAmount) * 100);
        const milestone = MILESTONES.find((m) => percent >= m);
        if (!milestone) return;

        await notify(userId, {
            type: "goal_milestone",
            level: milestone === 100 ? "success" : "info",
            title: milestone === 100 ? `You reached your goal "${goal.title}"!` : `"${goal.title}" is ${milestone}% complete`,
            body: `${money(goal.currentAmount || 0, currency)} saved of ${money(goal.targetAmount, currency)}. ${MESSAGES[milestone]}`,
            link: "/dashboard/goals",
            dedupeKey: `goal:${goal._id}:${milestone}`,
            metadata: { goalId: goal._id, milestone },
        });
    } catch (err) {
        console.error("Goal milestone check failed:", err.message);
    }
};
