// Tries subscription detection on made-up data, without using the database:
//   node scripts/testSubscriptions.js
import { detectSubscriptions } from "../utils/detectSubscriptions.js";

const charge = (description, transactionAmount, date, transactionCategory = "entertainment") => ({
    description,
    transactionAmount,
    transactionDate: new Date(date),
    transactionCategory,
});

const sampleTransactions = [
    // Monthly, with a different code on each charge: should be found
    charge("NETFLIX.COM 8842", 15.49, "2026-08-05"),
    charge("Netflix.com #1190", 15.49, "2026-09-05"),
    charge("NETFLIX.COM 3321", 17.99, "2026-10-05"),

    // Yearly: should be found
    charge("Amazon Prime", 139, "2024-10-20", "other"),
    charge("Amazon Prime", 139, "2025-10-20", "other"),

    // Weekly: should be found
    charge("Meal Box", 40, "2026-10-06", "food"),
    charge("Meal Box", 40, "2026-10-13", "food"),
    charge("Meal Box", 40, "2026-10-20", "food"),
    charge("Meal Box", 40, "2026-10-27", "food"),

    // Stopped months ago: should be found, but not active
    charge("Old Gym", 30, "2026-01-10", "other"),
    charge("Old Gym", 30, "2026-02-10", "other"),
    charge("Old Gym", 30, "2026-03-10", "other"),

    // Regular shop, but the amount varies: should NOT be found
    charge("Walmart", 42.1, "2026-08-02", "groceries"),
    charge("Walmart", 118.6, "2026-09-01", "groceries"),
    charge("Walmart", 67.25, "2026-10-01", "groceries"),

    // Only one charge: should NOT be found
    charge("Coffee Shop", 4.5, "2026-10-15", "food"),
];

const results = detectSubscriptions(sampleTransactions, new Date("2026-11-04"));

console.table(
    results.map((s) => ({
        name: s.name,
        frequency: s.frequency,
        amount: s.amount,
        monthlyCost: s.monthlyCost,
        yearlyCost: s.yearlyCost,
        active: s.isActive,
    }))
);
