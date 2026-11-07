// Headers for calling the AI service. AI_SERVICE_KEY must match the same
// setting on the AI service, which is how it knows the request came from here.
export const aiServiceHeaders = () => ({
    "Content-Type": "application/json",
    ...(process.env.AI_SERVICE_KEY && { "X-Internal-Key": process.env.AI_SERVICE_KEY }),
});
