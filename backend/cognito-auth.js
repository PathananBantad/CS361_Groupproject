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
    const authorization = req.headers.authorization;

    // ต้องมี Bearer Access Token เท่านั้น
    if (
        typeof authorization !== "string" ||
        !/^Bearer\s+\S+$/i.test(authorization)
    ) {
        return res.status(401).json({
            error: "Unauthorized",
            message: "A valid Cognito access token is required."
        });
    }

    const token = authorization.replace(/^Bearer\s+/i, "").trim();

    try {
        const payload = await getVerifier().verify(token);

        if (
            typeof payload.sub !== "string" ||
            payload.sub.length === 0
        ) {
            return res.status(401).json({
                error: "Unauthorized",
                message: "The access token has no valid user identity."
            });
        }

        const groups = payload["cognito:groups"];

        req.auth = {
            sub: payload.sub,
            username:
                payload.username ||
                payload["cognito:username"] ||
                null,
            groups: Array.isArray(groups)
                ? groups.filter(group => typeof group === "string")
                : []
        };

        return next();
    } catch (error) {
        if (
            error.message ===
            "Cognito environment variables are not configured"
        ) {
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

module.exports = { requireCognitoAuth };
