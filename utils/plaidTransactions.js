// Turns Plaid transactions into this app's transaction fields.

const DUPLICATE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const categoryFor = (primary, detailed) => {
    if (detailed === "INCOME_WAGES") return "salary";
    if (detailed === "INCOME_DIVIDENDS" || detailed === "INCOME_INTEREST_EARNED") return "investment";
    if (detailed === "FOOD_AND_DRINK_GROCERIES") return "groceries";

    switch (primary) {
        case "FOOD_AND_DRINK":
            return "food";
        case "ENTERTAINMENT":
            return "entertainment";
        case "TRANSPORTATION":
        case "TRAVEL":
            return "transportation";
        case "RENT_AND_UTILITIES":
        case "LOAN_PAYMENTS":
            return "bills";
        default:
            return "other";
    }
};

// Moving money between your own accounts isn't income or spending; importing
// it would count the same money twice in every total.
const isOwnTransfer = (primary, detailed) =>
    primary === "TRANSFER_IN" || primary === "TRANSFER_OUT" || detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

// Returns the fields to store, or null if this transaction shouldn't be imported.
export const mapPlaidTransaction = (transaction, accountsById = {}) => {
    const primary = transaction.personal_finance_category?.primary;
    const detailed = transaction.personal_finance_category?.detailed;

    if (isOwnTransfer(primary, detailed)) return null;

    const amount = Math.round(Math.abs(transaction.amount) * 100) / 100;
    if (amount < 0.01) return null;

    const account = accountsById[transaction.account_id];

    return {
        // Plaid: positive = money out of the account, negative = money in
        transactionType: transaction.amount > 0 ? "expense" : "income",
        transactionAmount: amount,
        transactionCategory: categoryFor(primary, detailed),
        description: String(transaction.merchant_name || transaction.name || "").trim().slice(0, 200),
        transactionDate: new Date(`${transaction.date}T00:00:00.000Z`),
        paymentMethod: account?.type === "credit" ? "credit_card" : "other",
        bankAccountName: account ? `${account.name}${account.mask ? ` ••${account.mask}` : ""}` : "",
        isPending: Boolean(transaction.pending),
    };
};

// A manually entered transaction with the same type and amount, within 2 days,
// is probably the same purchase. Each manual entry is only matched once.
export const findLikelyDuplicate = (fields, manualTransactions, alreadyMatched = new Set()) =>
    manualTransactions.find(
        (m) =>
            !alreadyMatched.has(String(m._id)) &&
            m.transactionType === fields.transactionType &&
            m.transactionAmount === fields.transactionAmount &&
            Math.abs(new Date(m.transactionDate) - fields.transactionDate) <= DUPLICATE_WINDOW_MS
    ) || null;
