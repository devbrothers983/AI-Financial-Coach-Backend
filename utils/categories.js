import Category from "../models/Category.js";
import CategoryRule from "../models/CategoryRule.js";
import { normalizeMerchant } from "./detectSubscriptions.js";

export const BUILT_IN_EXPENSE_CATEGORIES = ["food", "groceries", "entertainment", "transportation", "bills", "subscriptions", "other"];
export const BUILT_IN_INCOME_CATEGORIES = ["salary", "freelance", "investment", "gift", "other"];
export const BUILT_IN_CATEGORIES = [...new Set([...BUILT_IN_EXPENSE_CATEGORIES, ...BUILT_IN_INCOME_CATEGORIES])];

// Categories are stored in one form, so "Pet Care" and "pet  care" are the same one
export const normalizeCategoryName = (name) =>
    typeof name === "string" ? name.trim().replace(/\s+/g, " ").toLowerCase() : "";

export const isBuiltInCategory = (name) => BUILT_IN_CATEGORIES.includes(normalizeCategoryName(name));

// Built-in categories, plus this user's own
export const isValidCategory = async (userId, name) => {
    const category = normalizeCategoryName(name);
    if (!category) return false;
    if (isBuiltInCategory(category)) return true;
    return Boolean(await Category.exists({ userId, name: category }));
};

export const loadCategoryNames = async (userId) => {
    const custom = await Category.find({ userId }).select("name").lean();
    return new Set([...BUILT_IN_CATEGORIES, ...custom.map((c) => c.name)]);
};

export const loadRules = (userId) => CategoryRule.find({ userId }).select("matchText category").lean();

// The rule that fits a description, matching whole words. The longest wins, so
// "uber eats" beats "uber", and "uber" doesn't match "Super Uberman".
export const findMatchingRule = (description, rules) => {
    const text = ` ${normalizeMerchant(description)} `;
    let best = null;
    for (const rule of rules) {
        if (text.includes(` ${rule.matchText} `) && (!best || rule.matchText.length > best.matchText.length)) {
            best = rule;
        }
    }
    return best;
};
