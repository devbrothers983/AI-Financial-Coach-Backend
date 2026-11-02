import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

let client = null;

// Bank connections stay switched off until these are set on the server
export const isPlaidConfigured = () =>
    Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.BANK_TOKEN_ENCRYPTION_KEY);

export const getPlaidClient = () => {
    if (!client) {
        const env = process.env.PLAID_ENV || "sandbox";
        client = new PlaidApi(
            new Configuration({
                basePath: PlaidEnvironments[env],
                baseOptions: {
                    timeout: 30000,
                    headers: {
                        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
                        "PLAID-SECRET": process.env.PLAID_SECRET,
                    },
                },
            })
        );
    }
    return client;
};

// Plaid's own error code. Never log the raw axios error: its config contains the access token.
export const plaidErrorCode = (err) => err?.response?.data?.error_code || null;
