// Builds CSV text from rows. `columns` is [{ header, value: (row) => any }].
// Cells starting with = + - @ are prefixed with ' so spreadsheet apps don't
// run them as formulas (CSV injection).
const escapeCell = (value) => {
    if (value === null || value === undefined) return "";
    let text = value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (rows, columns) => {
    const header = columns.map((c) => escapeCell(c.header)).join(",");
    const lines = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(","));
    // BOM so Excel opens UTF-8 correctly
    return "﻿" + [header, ...lines].join("\r\n");
};

export const sendCsv = (res, filename, csv) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
};

const dateOnly = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

export const TRANSACTION_COLUMNS = [
    { header: "Date", value: (t) => dateOnly(t.transactionDate) },
    { header: "Type", value: (t) => t.transactionType },
    { header: "Category", value: (t) => t.transactionCategory },
    { header: "Amount", value: (t) => t.transactionAmount },
    { header: "Description", value: (t) => t.description },
    { header: "Payment method", value: (t) => t.paymentMethod },
    { header: "Recurring", value: (t) => (t.isRecurring ? t.recurringFrequency || "yes" : "") },
    { header: "Notes", value: (t) => t.transactionNotes },
];

export const USER_COLUMNS = [
    { header: "Username", value: (u) => u.username },
    { header: "Email", value: (u) => u.email },
    { header: "Role", value: (u) => u.role },
    { header: "Status", value: (u) => (u.isActive === false ? "deactivated" : "active") },
    { header: "Sign-in method", value: (u) => u.authProvider || "local" },
    { header: "Currency", value: (u) => u.currency },
    { header: "Joined", value: (u) => dateOnly(u.createdAt) },
    { header: "Last login", value: (u) => dateOnly(u.lastLoginAt) },
];

export const todayStamp = () => new Date().toISOString().slice(0, 10);
