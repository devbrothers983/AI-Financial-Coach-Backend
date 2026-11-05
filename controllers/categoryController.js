import Category from "../models/Category.js";
import CategoryRule from "../models/CategoryRule.js";
import Transaction from "../models/Transaction.js";
import Budget from "../models/Budget.js";
import Subscription from "../models/Subscription.js";
import { normalizeMerchant } from "../utils/detectSubscriptions.js";
import { toTitleCase } from "../utils/formatText.js";
import { logActivity } from "../utils/activityLogger.js";
import {
    BUILT_IN_EXPENSE_CATEGORIES,
    BUILT_IN_INCOME_CATEGORIES,
    normalizeCategoryName,
    isBuiltInCategory,
    isValidCategory,
    loadRules,
    findMatchingRule,
} from "../utils/categories.js";

const MAX_CATEGORIES = 50;
const MAX_RULES = 200;
const NAME_PATTERN = /^[a-z0-9][a-z0-9 &'-]*$/;

const badRequest = (res, message) => res.status(400).json({ success: false, message, status: 400 });

const notFound = (res, what) => res.status(404).json({ success: false, message: `${what} not found`, status: 404 });

// Returns an error message, or null if the name can be used
const checkName = async (userId, name, currentId) => {
    if (!name) return "Enter a category name";
    if (name.length > 30) return "Category names can be up to 30 characters";
    if (!NAME_PATTERN.test(name)) return "Use letters, numbers, spaces, or & ' -";
    if (isBuiltInCategory(name)) return "That category already exists";

    const existing = await Category.findOne({ userId, name }).select("_id").lean();
    if (existing && String(existing._id) !== String(currentId)) return "That category already exists";
    return null;
};

// ========================================
// Everything the Categories Page Needs
// ========================================

export const getCategories = async (req, res, next) => {
    try {
        const [custom, rules] = await Promise.all([
            Category.find({ userId: req.user._id }).sort({ name: 1 }).lean(),
            CategoryRule.find({ userId: req.user._id }).sort({ matchText: 1 }).lean(),
        ]);

        return res.status(200).json({
            success: true,
            builtIn: { expense: BUILT_IN_EXPENSE_CATEGORIES, income: BUILT_IN_INCOME_CATEGORIES },
            custom,
            rules,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Custom Categories
// ========================================

export const createCategory = async (req, res, next) => {
    try {
        const name = normalizeCategoryName(req.body.name);
        const kind = ["expense", "income", "both"].includes(req.body.kind) ? req.body.kind : "expense";

        const problem = await checkName(req.user._id, name);
        if (problem) return badRequest(res, problem);

        const count = await Category.countDocuments({ userId: req.user._id });
        if (count >= MAX_CATEGORIES) return badRequest(res, `You can have up to ${MAX_CATEGORIES} custom categories`);

        const category = await Category.create({ userId: req.user._id, name, kind });

        logActivity(req, {
            action: "category.create",
            description: `Created category "${name}"`,
            targetId: category._id,
            metadata: { name, kind },
        });

        return res.status(201).json({ success: true, message: "Category added", category, status: 201 });
    } catch (err) {
        next(err);
    }
};

// Renaming also updates everything already using the old name
export const renameCategory = async (req, res, next) => {
    try {
        const category = await Category.findOne({ _id: req.params.id, userId: req.user._id });
        if (!category) return notFound(res, "Category");

        const name = normalizeCategoryName(req.body.name);
        if (name !== category.name) {
            const problem = await checkName(req.user._id, name, category._id);
            if (problem) return badRequest(res, problem);

            const oldName = category.name;
            const userId = req.user._id;

            await Promise.all([
                Transaction.updateMany({ userId, transactionCategory: oldName }, { transactionCategory: name }),
                CategoryRule.updateMany({ userId, category: oldName }, { category: name }),
                Subscription.updateMany({ userId, category: oldName }, { category: name }),
                Budget.updateMany(
                    { userId, "categories.category": toTitleCase(oldName) },
                    { $set: { "categories.$[match].category": toTitleCase(name) } },
                    { arrayFilters: [{ "match.category": toTitleCase(oldName) }] }
                ),
            ]);

            category.name = name;
            await category.save();
        }

        return res.status(200).json({ success: true, message: "Category renamed", category, status: 200 });
    } catch (err) {
        next(err);
    }
};

// Nothing is lost: its transactions move to "other"
export const deleteCategory = async (req, res, next) => {
    try {
        const category = await Category.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!category) return notFound(res, "Category");

        const userId = req.user._id;
        const [moved] = await Promise.all([
            Transaction.updateMany({ userId, transactionCategory: category.name }, { transactionCategory: "other" }),
            CategoryRule.deleteMany({ userId, category: category.name }),
            Subscription.updateMany({ userId, category: category.name }, { category: "other" }),
            Budget.updateMany({ userId }, { $pull: { categories: { category: toTitleCase(category.name) } } }),
        ]);

        logActivity(req, {
            action: "category.delete",
            description: `Deleted category "${category.name}"`,
            targetId: category._id,
            metadata: { name: category.name, moved: moved.modifiedCount },
        });

        return res.status(200).json({
            success: true,
            message: `Category deleted. ${moved.modifiedCount} ${moved.modifiedCount === 1 ? "transaction" : "transactions"} moved to Other.`,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

// ========================================
// Rules: "always put Uber under Transportation"
// ========================================

// Updates the user's existing transactions this rule applies to. If a longer
// rule also fits one, that rule decides, the same as it would for a new import.
const applyRuleToExisting = async (userId, rule) => {
    const [transactions, rules] = await Promise.all([
        Transaction.find({ userId, transactionCategory: { $ne: rule.category } }).select("description").lean(),
        loadRules(userId),
    ]);

    const ids = transactions
        .filter((t) => String(findMatchingRule(t.description, rules)?._id) === String(rule._id))
        .map((t) => t._id);

    if (!ids.length) return 0;

    const result = await Transaction.updateMany({ _id: { $in: ids }, userId }, { transactionCategory: rule.category });
    return result.modifiedCount;
};

export const saveRule = async (req, res, next) => {
    try {
        const matchText = normalizeMerchant(typeof req.body.matchText === "string" ? req.body.matchText : "");
        const category = normalizeCategoryName(req.body.category);

        if (matchText.length < 2) return badRequest(res, "Enter a word from the transaction, like Uber");
        if (matchText.length > 60) return badRequest(res, "That text is too long");
        if (!(await isValidCategory(req.user._id, category))) return badRequest(res, "Choose a valid category");

        const count = await CategoryRule.countDocuments({ userId: req.user._id });
        if (count >= MAX_RULES) return badRequest(res, `You can have up to ${MAX_RULES} rules`);

        // the same text again just changes its category
        const rule = await CategoryRule.findOneAndUpdate(
            { userId: req.user._id, matchText },
            { category },
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
        );

        const updated = req.body.applyToExisting === false ? 0 : await applyRuleToExisting(req.user._id, rule);

        logActivity(req, {
            action: "category.rule_save",
            description: `Rule: "${matchText}" goes under ${category}${updated ? ` (${updated} transactions updated)` : ""}`,
            targetId: rule._id,
            metadata: { matchText, category, updated },
        });

        return res.status(200).json({
            success: true,
            message: updated
                ? `Rule saved. ${updated} ${updated === 1 ? "transaction" : "transactions"} updated.`
                : "Rule saved",
            rule,
            updated,
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};

export const deleteRule = async (req, res, next) => {
    try {
        const rule = await CategoryRule.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!rule) return notFound(res, "Rule");

        return res.status(200).json({
            success: true,
            message: "Rule removed. Existing transactions keep their category.",
            status: 200,
        });
    } catch (err) {
        next(err);
    }
};
