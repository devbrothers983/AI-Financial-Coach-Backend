export const errorMiddleware = (err, req, res, next) => {

    // expired or tampered login tokens mean "sign in again", not a server error
    if (err.name === "TokenExpiredError" || err.name === "JsonWebTokenError") {
        return res.status(401).json({
            success: false,
            status: 401,
            message: err.name === "TokenExpiredError"
                ? "Your session has expired. Please sign in again."
                : "Invalid session. Please sign in again.",
        });
    }

    // malformed ids in the URL
    if (err.name === "CastError") {
        return res.status(400).json({
            success: false,
            status: 400,
            message: `Invalid ${err.path || "id"}`,
        });
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    return res.status(statusCode).json({
        success: false,
        status: statusCode,
        message: message,
    });
};
