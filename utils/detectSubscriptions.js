const DAY_MS = 24 * 60 * 60 * 1000;

// How far apart the charges must be for each billing frequency
const FREQUENCIES = [
    { name: "weekly", typicalDays: 7, minDays: 6, maxDays: 8, minCharges: 4, chargesPerYear: 52 },
    { name: "monthly", typicalDays: 30, minDays: 26, maxDays: 35, minCharges: 3, chargesPerYear: 12 },
    { name: "quarterly", typicalDays: 91, minDays: 85, maxDays: 97, minCharges: 3, chargesPerYear: 4 },
    { name: "yearly", typicalDays: 365, minDays: 350, maxDays: 380, minCharges: 2, chargesPerYear: 1 },
];

// How much the price can change between one charge and the next, e.g. a price rise
const AMOUNT_TOLERANCE = 0.2;

// "NETFLIX.COM 8842" and "Netflix.com #1190" both become "netflix com"
export const normalizeMerchant = (description = "") =>
    description
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

// "netflix" and "netflix com" are the same merchant; "net" and "netflix" aren't
export const merchantsMatch = (a, b) => {
    if (!a || !b) return false;
    return ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
};

// "NETFLIX.COM #3321" reads better as "NETFLIX.COM"
const displayName = (description = "") => description.replace(/[\s#*-]*\d[\d\s#*-]*$/, "").trim() || description;

// The middle value of a list, which one unusual value can't skew
const median = (numbers) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const roundMoney = (amount) => Math.round(amount * 100) / 100;

// Works out the billing pattern from the charges alone, or returns null
const findPattern = (sorted) => {
    // Days between each charge and the one before it
    const gaps = sorted.slice(1).map((charge, i) => (new Date(charge.transactionDate) - new Date(sorted[i].transactionDate)) / DAY_MS);
    if (gaps.length === 0) return null;

    const typicalGap = median(gaps);
    const frequency = FREQUENCIES.find((f) => typicalGap >= f.minDays && typicalGap <= f.maxDays);
    if (!frequency || sorted.length < frequency.minCharges) return null;

    // Most of the gaps must fit, so one late payment doesn't rule it out
    const regularGaps = gaps.filter((gap) => gap >= frequency.minDays && gap <= frequency.maxDays);
    if (regularGaps.length / gaps.length < 0.7) return null;

    // Similar amounts each time: this separates Netflix from a regular grocery shop.
    // Each charge is compared with the one before it, so a price rise still counts.
    const amounts = sorted.map((charge) => charge.transactionAmount);
    const allSimilar = amounts.slice(1).every((amount, i) => Math.abs(amount - amounts[i]) <= amounts[i] * AMOUNT_TOLERANCE);
    if (!allSimilar) return null;

    return { frequency, typicalGap };
};

// Looks at one merchant's charges and returns a subscription, or null if it isn't one
const analyzeMerchant = (merchantKey, charges, now) => {
    const sorted = [...charges].sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate));
    const last = sorted[sorted.length - 1];

    // The user ticked "recurring" on the latest charge, so no need to wait for a pattern
    const ticked = last.isRecurring ? FREQUENCIES.find((f) => f.name === last.recurringFrequency) : null;
    const pattern = ticked ? { frequency: ticked, typicalGap: ticked.typicalDays } : findPattern(sorted);
    if (!pattern) return null;

    const { frequency, typicalGap } = pattern;
    const lastDate = new Date(last.transactionDate);
    const nextDate = new Date(lastDate.getTime() + typicalGap * DAY_MS);
    const daysSinceLast = (now - lastDate) / DAY_MS;
    const previous = sorted[sorted.length - 2];

    return {
        merchantKey,
        name: displayName(last.description),
        frequency: frequency.name,
        amount: roundMoney(last.transactionAmount),
        previousAmount: previous ? roundMoney(previous.transactionAmount) : null,
        monthlyCost: roundMoney((last.transactionAmount * frequency.chargesPerYear) / 12),
        yearlyCost: roundMoney(last.transactionAmount * frequency.chargesPerYear),
        category: last.transactionCategory,
        chargeCount: sorted.length,
        lastChargeDate: lastDate,
        nextChargeDate: nextDate,
        // A charge that's well overdue probably means it was cancelled
        isActive: daysSinceLast <= typicalGap * 1.5,
    };
};

// Main function: give it expense transactions, get back the subscriptions it found
export const detectSubscriptions = (transactions, now = new Date()) => {
    const byMerchant = new Map();

    for (const transaction of transactions) {
        const merchantKey = normalizeMerchant(transaction.description);
        if (!merchantKey) continue;
        if (!byMerchant.has(merchantKey)) byMerchant.set(merchantKey, []);
        byMerchant.get(merchantKey).push(transaction);
    }

    return [...byMerchant.entries()]
        .map(([merchantKey, charges]) => analyzeMerchant(merchantKey, charges, now))
        .filter(Boolean)
        .sort((a, b) => b.yearlyCost - a.yearlyCost);
};
