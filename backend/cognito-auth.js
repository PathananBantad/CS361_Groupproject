
const { CognitoJwtVerifier } = require("aws-jwt-verify");

let verifier;

function getVerifier() {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_APP_CLIENT_ID;

    if (!userPoolId || !clientId) {
        throw new Error("Cognito environment variables are not configured");
    }

    if (!verifier) {
        verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: "access",
            clientId
        });
    }

    return verifier;
}

async function requireCognitoAuth(req, res, next) {
    // 1. รองรับ Session Login (จาก login.html)
    if (req.session?.user) {
        req.auth = {
            sub: String(req.session.user.id),
            username: req.session.user.username,
            groups: req.session.user.roles || ["staff"]
        };
        return next();
    }

    // 2. รองรับ Role Switcher จาก Frontend (x-user-role หรือ query ?role=...)
    const roleHeader = req.headers["x-user-role"] || req.query.role || req.body?.role;
    const userHeader = req.headers["x-user-id"] || req.query.userId || req.body?.userId;
    if (roleHeader) {
        req.auth = {
            sub: userHeader || (roleHeader === "admin" ? "admin01" : "staff01"),
            username: userHeader || (roleHeader === "admin" ? "admin01" : "staff01"),
            groups: [roleHeader]
        };
        return next();
    }

    // 3. ตรวจสอบ Cognito Bearer Token
    const authorization = req.headers.authorization;
    if (authorization && /^Bearer\s+\S+$/i.test(authorization)) {
        const token = authorization.replace(/^Bearer\s+/i, "").trim();

        try {
            const payload = await getVerifier().verify(token);

            req.auth = {
                sub: payload.sub,
                username: payload.username || null,
                groups: payload["cognito:groups"] || []
            };

            return next();
        } catch (error) {
            if (error.message === "Cognito environment variables are not configured") {
                console.error(error.message);

                return res.status(503).json({
                    error: "Authentication service is not configured."
                });
            }

            return res.status(401).json({
                error: "Unauthorized",
                message: "The access token is invalid or expired."
            });
        }
    }

    // 4. Fallback สำหรับ Local Development หากยังไม่ได้ Login
    if (process.env.NODE_ENV !== "production") {
        req.auth = {
            sub: "staff01",
            username: "staff01",
            groups: ["staff"]
        };
        return next();
    }

    return res.status(401).json({
        error: "Unauthorized",
        message: "A valid session or Cognito access token is required."
    });
}

module.exports = { requireCognitoAuth };
