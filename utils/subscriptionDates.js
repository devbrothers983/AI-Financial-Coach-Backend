// Date and cost calculations for subscriptions. All dates are UTC midnights.

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHARGES_PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
const MONTHS_BETWEEN = { monthly: 1, quarterly: 3, yearly: 12 };

const roundMoney = (amount) => Math.round(amount * 100) / 100;

export const startOfDayUTC = (date = new Date()) => {
    const d = new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// "2026-11-05" to a date, or null if it isn't a real date
export const parseDateOnly = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
};

// The next charge after `date`. `billingDay` keeps a subscription billed on the
// 31st on the last day of shorter months, then back on the 31st afterwards.
export const nextDateAfter = (date, frequency, billingDay = new Date(date).getUTCDate()) => {
    const current = new Date(date);

    if (frequency === "weekly") return new Date(current.getTime() + 7 * DAY_MS);

    const target = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + MONTHS_BETWEEN[frequency], 1));
    const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(billingDay, daysInMonth));
    return target;
};

// Moves a past date forward to today or later
export const rollForwardToToday = (date, frequency, billingDay, now = new Date()) => {
    const today = startOfDayUTC(now);
    let next = new Date(date);
    while (next < today) next = nextDateAfter(next, frequency, billingDay);
    return next;
};

export const yearlyCostOf = (amount, frequency) => roundMoney(amount * CHARGES_PER_YEAR[frequency]);

export const monthlyCostOf = (amount, frequency) => roundMoney((amount * CHARGES_PER_YEAR[frequency]) / 12);

// What a subscription will cost in the next `days` days
export const costInNextDays = (amount, frequency, nextChargeDate, billingDay, days = 30, now = new Date()) => {
    const end = startOfDayUTC(now).getTime() + days * DAY_MS;
    let next = new Date(nextChargeDate);
    let total = 0;
    while (next.getTime() <= end) {
        total += amount;
        next = nextDateAfter(next, frequency, billingDay);
    }
    return roundMoney(total);
};

export const daysUntil = (date, now = new Date()) =>
    Math.round((startOfDayUTC(date).getTime() - startOfDayUTC(now).getTime()) / DAY_MS);
