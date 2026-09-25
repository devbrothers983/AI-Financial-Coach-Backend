// ========================================
// Shared goal pace/progress math.
// Used by both the Goal endpoints (to show progress)
// and the Budget sweep (to detect a missed savings pace).
// ========================================

export const calculateGoalPace = (goal) => {
    const today = new Date();
    const targetDate = new Date(goal.targetDate);
    const createdAt = new Date(goal.createdAt);

    const remainingAmount = Math.max(goal.targetAmount - goal.currentAmount, 0);

    const daysRemaining = Math.max(
        Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
        0
    );

    const monthsRemaining = Math.max(Math.ceil(daysRemaining / 30), 1);

    const requiredMonthlyPace = remainingAmount / monthsRemaining;

    // Linear expected-progress check: how much should be saved by now
    // if progress were spread evenly from creation to the target date.
    // Rounded to whole days so a goal isn't flagged off-track within
    // seconds/minutes of being created.
    const totalDurationDays = Math.max(
        Math.ceil((targetDate.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
        1
    );

    const elapsedDays = Math.max(
        Math.floor((today.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
        0
    );

    const elapsedFraction = Math.min(elapsedDays / totalDurationDays, 1);

    const expectedAmountByNow = elapsedFraction * goal.targetAmount;

    let progressStatus = "on_track";

    if (goal.currentAmount >= goal.targetAmount) {
        progressStatus = "completed";
    } else if (daysRemaining === 0) {
        progressStatus = "deadline_reached";
    } else if (goal.currentAmount < expectedAmountByNow) {
        progressStatus = "off_track";
    }

    const isOffTrack = progressStatus === "off_track" || progressStatus === "deadline_reached";

    return {
        remainingAmount,
        daysRemaining,
        monthsRemaining,
        requiredMonthlyPace: Number(requiredMonthlyPace.toFixed(2)),
        expectedAmountByNow: Number(expectedAmountByNow.toFixed(2)),
        percentageCompleted:
            goal.targetAmount > 0
                ? Number(((goal.currentAmount / goal.targetAmount) * 100).toFixed(2))
                : 0,
        progressStatus,
        isOffTrack,
    };
};
