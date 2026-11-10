// Headers for calling the AI service. AI_SERVICE_KEY must match the same
// setting on the AI service, which is how it knows the request came from here.
export const aiServiceHeaders = () => ({
    "Content-Type": "application/json",
    ...(process.env.AI_SERVICE_KEY && { "X-Internal-Key": process.env.AI_SERVICE_KEY }),
});

// The full address for an AI service path. Tolerates a trailing slash, and a
// setting typed without "https://".
export const aiServiceUrl = (path) => {
    let base = (process.env.AI_SERVICE_URL || "").trim().replace(/\/+$/, "");
    if (base && !/^https?:\/\//i.test(base)) base = `https://${base}`;
    return `${base}${path}`;
};

// Explains a failed call in the server log: a wrong address, a sleeping
// service and a key mismatch each need a different fix
export const describeAiFailure = (err) => {
    if (err?.name === "TimeoutError") return "timed out (the AI service may have been asleep)";
    // Node's fetch reports connection problems as "fetch failed", with the reason inside
    const code = err?.cause?.code || err?.cause?.errors?.[0]?.code || err?.code;
    if (code || err?.message === "fetch failed") return `couldn't connect (${code || "no response"}). Check AI_SERVICE_URL`;
    return err?.message || err?.name || "unknown error";
};

// Hosting can put an idle service to sleep, and waking it takes about a
// minute, which a user would see as a failed question. A light request every
// 10 minutes keeps it awake.
const KEEP_WARM_MS = 10 * 60 * 1000;

const ping = async () => {
    const response = await fetch(aiServiceUrl("/"), { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
};

export const startAiKeepWarm = () => {
    if (!process.env.AI_SERVICE_URL) {
        console.error("AI_SERVICE_URL is not set, so the AI coach can't work");
        return;
    }

    // a check at startup puts any setup problem in the log straight away
    ping()
        .then(() => console.log(`AI service reachable at ${aiServiceUrl("")}`))
        .catch((err) => console.error(`Can't reach the AI service at ${aiServiceUrl("")}: ${describeAiFailure(err)}`));

    setInterval(() => {
        ping().catch((err) => console.error(`AI service keep-warm failed: ${describeAiFailure(err)}`));
    }, KEEP_WARM_MS).unref();
};

// For /health/ai: can this server reach the AI service, and does it accept our
// key? An empty question is sent, which the AI service rejects without calling
// the AI, so this costs nothing. Cached for a minute so it can't be used to flood it.
let lastCheck = null;

export const checkAiService = async () => {
    if (lastCheck && Date.now() - lastCheck.at < 60000) return lastCheck.result;

    let host = null;
    try {
        host = new URL(aiServiceUrl("/")).host;
    } catch {
        // AI_SERVICE_URL isn't a valid address
    }

    let result;
    if (!host) {
        result = { aiService: "not set up", detail: "AI_SERVICE_URL is missing or isn't a valid address" };
    } else {
        try {
            const response = await fetch(aiServiceUrl("/ai/chat"), {
                method: "POST",
                headers: aiServiceHeaders(),
                body: "{}",
                signal: AbortSignal.timeout(90000),
            });
            result =
                response.status === 422
                    ? { aiService: "reachable", host }
                    : response.status === 401
                      ? { aiService: "key mismatch", host, detail: "AI_SERVICE_KEY must be identical on the backend and the AI service" }
                      : { aiService: "unexpected response", host, detail: `status ${response.status}` };
        } catch (err) {
            result = { aiService: "unreachable", host, detail: describeAiFailure(err) };
        }
    }

    lastCheck = { at: Date.now(), result };
    return result;
};
