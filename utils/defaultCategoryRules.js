// Starting guesses for common merchants, so a new user's bank file isn't all
// "other". Matched as whole words after cleaning, e.g. "UBER TRIP 8821" contains
// "uber". A user's own rules always come first. Add new merchants here.

const EXPENSE_KEYWORDS = {
    groceries: [
        "whole foods", "trader joes", "trader joe", "kroger", "safeway", "aldi", "publix", "wegmans", "costco",
        "sams club", "grocery", "groceries", "supermarket",
    ],
    food: [
        "uber eats", "doordash", "grubhub", "starbucks", "dunkin", "mcdonalds", "chipotle", "subway", "burger king",
        "taco bell", "wendys", "chick fil a", "kfc", "dominos", "pizza", "restaurant", "cafe", "coffee",
    ],
    transportation: [
        "uber", "lyft", "shell", "chevron", "exxon", "exxonmobil", "mobil", "bp", "texaco", "gas station", "fuel",
        "parking", "toll", "transit", "metro", "amtrak", "delta air", "united airlines", "southwest airlines",
    ],
    entertainment: ["amc", "regal", "cinema", "cinemark", "theatre", "theater", "ticketmaster", "steam", "playstation", "xbox", "nintendo"],
    subscriptions: [
        "netflix", "spotify", "hulu", "disney plus", "disneyplus", "hbo", "youtube premium", "apple music", "icloud",
        "amazon prime", "audible", "patreon", "planet fitness", "gym", "fitness", "membership", "subscription", "udemy", "coursera",
    ],
    bills: [
        "rent", "apartments", "mortgage", "electric", "utility", "utilities", "water", "internet", "comcast", "xfinity",
        "verizon", "t mobile", "att", "insurance", "geico", "progressive", "loan",
    ],
    shopping: ["amazon", "walmart", "target", "best buy", "ebay", "etsy", "macys", "nordstrom", "ikea", "home depot", "lowes"],
};

const INCOME_KEYWORDS = {
    salary: ["payroll", "salary", "paycheck", "direct deposit", "wages"],
    freelance: ["freelance", "upwork", "fiverr", "invoice", "consulting"],
    investment: ["dividend", "interest", "robinhood", "fidelity", "vanguard"],
    gift: ["gift"],
};

const toEntries = (table) =>
    Object.entries(table).flatMap(([category, words]) => words.map((matchText) => ({ matchText, category })));

// Same shape as a user's rules, so they're matched the same way
export const DEFAULT_RULES = {
    expense: toEntries(EXPENSE_KEYWORDS),
    income: toEntries(INCOME_KEYWORDS),
};
