// For putting user-written text into HTML emails, so it shows as plain text
// instead of becoming links or formatting.
export const escapeHtml = (value = "") =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

// Same, keeping the writer's line breaks
export const textToHtml = (value = "") => escapeHtml(value).replace(/\r?\n/g, "<br/>");
