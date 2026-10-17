
const session = require("express-session");

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
    throw new Error("Session configuration is missing");
}

const sessionMiddleware = session({
    name: "edocs.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 60 * 1000
    }
});

module.exports = sessionMiddleware;
