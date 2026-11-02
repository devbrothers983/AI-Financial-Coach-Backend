import crypto from "crypto";
import jwt from "jsonwebtoken";
import { getPlaidClient } from "../config/plaid.js";

const keyCache = new Map();

const getVerificationKey = async (keyId, client) => {
    if (keyCache.has(keyId)) return keyCache.get(keyId);

    const { data } = await client.webhookVerificationKeyGet({ key_id: keyId });
    if (data.key.expired_at) throw new Error("Webhook key has expired");

    const publicKey = crypto.createPublicKey({ key: data.key, format: "jwk" });
    keyCache.set(keyId, publicKey);
    return publicKey;
};

// Confirms a webhook really came from Plaid and wasn't altered or replayed:
// ES256 signature, at most 5 minutes old, and a matching SHA-256 of the raw body.
export const verifyPlaidWebhook = async (signedJwt, rawBody, client) => {
    if (!signedJwt || !rawBody) return false;

    try {
        const header = jwt.decode(signedJwt, { complete: true })?.header;
        if (header?.alg !== "ES256" || !header.kid) return false;

        const publicKey = await getVerificationKey(header.kid, client || getPlaidClient());
        const claims = jwt.verify(signedJwt, publicKey, { algorithms: ["ES256"], maxAge: "5m" });

        const actual = crypto.createHash("sha256").update(rawBody).digest("hex");
        const expected = String(claims.request_body_sha256 || "");
        return (
            actual.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
        );
    } catch {
        return false;
    }
};
