// Normalizes freeform name input to Title Case, regardless of how the
// user typed it (e.g. "john DOE" -> "John Doe", "MARY-jane o'brien" -> "Mary-Jane O'Brien").
export const toTitleCase = (str) => {
    if (!str) return str;

    return str
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .replace(/(^|[\s'-])([a-z])/g, (match, boundary, letter) => boundary + letter.toUpperCase());
};
