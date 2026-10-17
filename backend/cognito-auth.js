
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

    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
        return res.status(401).json({
            error: "Unauthorized",
            message: "A valid Cognito access token is required."
        });
    }

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

module.exports = { requireCognitoAuth };
