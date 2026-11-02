import crypto from "crypto";

// AES-256-GCM for secrets stored in the database (Plaid access tokens).
// BANK_TOKEN_ENCRYPTION_KEY can be any long random string; it's hashed to 32 bytes.
const getKey = () => {
    const secret = process.env.BANK_TOKEN_ENCRYPTION_KEY;
    if (!secret) throw new Error("BANK_TOKEN_ENCRYPTION_KEY is not set");
    return crypto.createHash("sha256").update(secret).digest();
};

export const encryptSecret = (plainText) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64")).join(".");
};

export const decryptSecret = (stored) => {
    const [iv, tag, encrypted] = stored.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};
