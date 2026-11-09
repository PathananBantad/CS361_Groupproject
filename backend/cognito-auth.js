const { CognitoJwtVerifier } = require("aws-jwt-verify");

class CognitoConfigurationError extends Error {
    constructor() {
        super("Cognito environment variables are not configured");
        this.name = "CognitoConfigurationError";
    }
}

function getCognitoConfiguration() {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_APP_CLIENT_ID;

    if (!userPoolId || !clientId) {
        throw new CognitoConfigurationError();
    }

    const region = userPoolId.split("_")[0];

    return {
        userPoolId,
        clientId,
        issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`
    };
}

function createCognitoVerifier(createVerifier = (options) => CognitoJwtVerifier.create(options)) {
    const { userPoolId, clientId } = getCognitoConfiguration();

    return createVerifier({
        userPoolId,
        tokenUse: "access",
        clientId
    });
}

let verifier;

function getVerifier() {
    if (!verifier) {
        verifier = createCognitoVerifier();
    }

    return verifier;
}

function createRequireCognitoAuth(verifierProvider = getVerifier) {
    return async function requireCognitoAuth(req, res, next) {
        let authorization = req.headers.authorization;
        if (!authorization && typeof req.query?.token === "string") {
            authorization = `Bearer ${req.query.token}`;
        }

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
            const payload = await verifierProvider().verify(token);
            const { clientId, issuer } = getCognitoConfiguration();
            const hasValidExpiration =
                typeof payload.exp === "number" &&
                Number.isFinite(payload.exp) &&
                payload.exp > Math.floor(Date.now() / 1000);

            if (
                typeof payload.sub !== "string" ||
                payload.sub.length === 0 ||
                payload.token_use !== "access" ||
                payload.iss !== issuer ||
                payload.client_id !== clientId ||
                !hasValidExpiration
            ) {
                return res.status(401).json({
                    error: "Unauthorized",
                    message: "The access token is invalid or expired."
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
            if (error instanceof CognitoConfigurationError) {
                return res.status(503).json({
                    error: "Authentication service is not configured."
                });
            }

            return res.status(401).json({
                error: "Unauthorized",
                message: "The access token is invalid or expired."
            });
        }
    };
}

const requireCognitoAuth = createRequireCognitoAuth();

module.exports = {
    requireCognitoAuth,
    createCognitoVerifier,
    createRequireCognitoAuth,
    CognitoConfigurationError
};
