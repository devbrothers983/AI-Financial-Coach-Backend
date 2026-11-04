import { promises as dns } from "dns";

const LOOKUP_TIMEOUT_MS = 4000;

// Catches typos like "udmey.com" by asking whether the address exists. It only
// looks the name up and never visits the site, so a user can't use this to make
// the server open other addresses. Only a clear "not found" counts as missing:
// a slow or failing lookup shouldn't stop someone saving a good link.
export const websiteExists = async (link, lookup = dns.lookup) => {
    try {
        const { hostname } = new URL(link);
        const timeout = new Promise((resolve) => {
            setTimeout(() => resolve("timeout"), LOOKUP_TIMEOUT_MS).unref();
        });
        await Promise.race([lookup(hostname), timeout]);
        return true;
    } catch (err) {
        return err.code !== "ENOTFOUND";
    }
};
