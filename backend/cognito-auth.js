const crypto = require("node:crypto");
const { CognitoJwtVerifier } = require("aws-jwt-verify");
const { getPublicCognitoConfig } = require("./config");

const EMBEDDED_JWKS = {
    keys: [
        {
            alg: "RS256",
            e: "AQAB",
            kid: "kKgOT+Ardsd5C+CGHIVHk6cQjo/nk9CHPc3qXrec/LQ=",
            kty: "RSA",
            n: "wn9vlbPVuFTYGdRhpz1AOotJZGpJkG2Ux9UciEyKYN_cFjsAowR63W5_TBA_UiDdjLpQFEDl6JZPrrxTTtRQ1oPMQDTYcKOzlaOIrrNHbBZujK33K_Rehpmhe-AyFAyIZVtSbRYbNd5dUWDcm0o-90iIGsBWVWES4Shx-Ngv91N1h5l3cL3XKa953ZJRUnSOJUcX6Q9xLnuHIKjui6ITct4asgjl6H-Og4VuIvCrQb5mljR6YWhweUi3m7rTdXiNePwO4M4DVluggHaJGQjHTCJRnBrbXi80V0LPAc1LBSwQk-Ufpi34G7Bikt5x0wnde-Mq32Sf-FHyazSRRtVbWQ",
            use: "sig"
        },
        {
            alg: "RS256",
            e: "AQAB",
            kid: "ln2jiUH+KJDVCFJlDXpalujQmTbdJcqLE8w9dJC6lRY=",
            kty: "RSA",
            n: "69_nrYDzkRfslVdeNXQ7lpgSV-FrzrEC-ohCgmz0Y5q_hsQ0wcKXkWUODftFWP6fl7GAv_w36f_TVoWgWb6lJGAbnnoXbwI0FsY9eOa26yLXYwdNNK8JUa2bFg5aBknX7OvR3EOR_yzKPX0CD4UsrNrZDKNnNVWufupMsGqCoqQj12bZVblGvD7v9dgaJkMEYzG3rRXfUwjA7tO_9evm86iQebpDC2Jl5Tq2Q-lKBS3vAbXxayoEjtmNAoFcCl6g1kF69c0tKevYD5GAQWhov7yZ4xIHRFrI1euK8k2w4IPPFiuW6RL_6t0NKLqK96-zdUBxsgvpEMXob3fSaEuBbQ",
            use: "sig"
        },
        {
            alg: "RS256",
            e: "AQAB",
            kid: "LNiVP8fSfywwi49nP5F7dqNn7ayCVSbR9NNfVKR8+UY=",
            kty: "RSA",
            n: "vZSddIDhEvSFi2hTI9MgIEwnS9LL-_GzTZoGbUlWURYKk2dqPvH1C53vTozLD8tkDYUEfRopQwRM-sG0S02OhULzmp1JZG6V8Y9MqfsGzy6mWi7flEkUR0f0cBRIKQxu0EknuWq_16mT_J3X_vbBCVaC4GKb4FJ42Ozx1sciNASsDVzccEyn12aQAoF8Vly0-WG3LOzRbyzZ2UvjTRSa76BIN4C64fTVo7Sg1vu45mteufhaL8FkhLETfQYHBf8uKqQIFGF0kynexau_dT49hc0hwUrUqpoQapE176LcV0thBYKOTGqgI-NbZsIIqcGk76X_K9AXGQQcuhO0m9TtNw",
            use: "sig"
        },
        {
            alg: "RS256",
            e: "AQAB",
            kid: "ZpVieR1rxKMkhZRqF+cJeE+uBD0ZjFNXqKgjwkS/Dnc=",
            kty: "RSA",
            n: "9V9FH1vrRBEAEJxHPcpV-dkpS0JPyHTcdc-m06_CIeaROQw4iejnIBnAXD3g0Xyp4bIl1ehF-N3ffD_HFy-9cQqcHznGfYd-xj9ISfH0LXv8eJXk4oqrR0IUD0Hn-Rsr4muJKriPzrgwO-V1Yn6jLAFBnCQ7j2p8CHwD0UcD49lNHIC6ZqT7B_Saj8V8kXJxb9LHzJXzcLTpt6g78MTFgCFgU4wGu4Wm7SrGf-x0Uk4T0aMgfVWdP5mlgUQmKj3fwIGYQsZ0u-82l3fDvini1I0J1OLinuN656dZtIbqi7YSknlNQZjXeDwUQEfJCF5ITJ11pfD3cKvRMYqGhj5cew",
            use: "sig"
        }
    ]
};

const cachedPublicKeys = new Map();
const CLOCK_SKEW_SECONDS = 60;

function decodeJwtPart(part) {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

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
    const publicConfig = getPublicCognitoConfig();

    return {
        userPoolId,
        clientId,
        issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
        allowedIssuers: publicConfig.allowedIssuers,
        allowedClientIds: publicConfig.allowedClientIds
    };
}

function verifyWithEmbeddedJwks(token, config = getCognitoConfiguration()) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT token format");

    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    const now = Math.floor(Date.now() / 1000);

    if (header.alg !== "RS256") throw new Error("Invalid token algorithm");
    if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error("Token expired");
    if (Number.isFinite(payload.iat) && payload.iat > now + CLOCK_SKEW_SECONDS) {
        throw new Error("Token issued in the future");
    }
    if (payload.token_use !== "access") throw new Error("Invalid token use");
    if (!config.allowedIssuers.includes(payload.iss)) throw new Error("Issuer not allowed");
    if (!config.allowedClientIds.includes(payload.client_id)) throw new Error("Client ID not allowed");

    const jwk = EMBEDDED_JWKS.keys.find(key => key.kid === header.kid);
    if (!jwk) throw new Error("Cognito signing key is not embedded");

    let publicKey = cachedPublicKeys.get(jwk.kid);
    if (!publicKey) {
        publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
        cachedPublicKeys.set(jwk.kid, publicKey);
    }

    if (!crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        publicKey,
        Buffer.from(parts[2], "base64url")
    )) {
        throw new Error("Invalid token signature");
    }

    return payload;
}

function createCognitoVerifier(createVerifier = options => CognitoJwtVerifier.create(options)) {
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
        const { userPoolId, allowedClientIds } = getCognitoConfiguration();
        verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: "access",
            clientId: allowedClientIds
        });
    }
    return verifier;
}

function createRequireCognitoAuth(verifierProvider = getVerifier) {
    return async function requireCognitoAuth(req, res, next) {
        let authorization = req.headers.authorization;
        if (!authorization && req.method === "GET" && typeof req.query?.token === "string") {
            authorization = `Bearer ${req.query.token}`;
        }

        if (typeof authorization !== "string" || !/^Bearer\s+\S+$/i.test(authorization)) {
            return res.status(401).json({
                error: "Unauthorized",
                message: "A valid Cognito access token is required."
            });
        }

        const token = authorization.replace(/^Bearer\s+/i, "").trim();

        try {
            let config;
            let payload;
            try {
                config = getCognitoConfiguration();
                payload = verifyWithEmbeddedJwks(token, config);
            } catch {
                payload = await verifierProvider().verify(token);
            }
            if (!config) config = getCognitoConfiguration();
            const hasValidExpiration =
                typeof payload.exp === "number" &&
                Number.isFinite(payload.exp) &&
                payload.exp > Math.floor(Date.now() / 1000);

            if (
                typeof payload.sub !== "string" ||
                payload.sub.length === 0 ||
                payload.token_use !== "access" ||
                !config.allowedIssuers.includes(payload.iss) ||
                !config.allowedClientIds.includes(payload.client_id) ||
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
                username: payload.username || payload["cognito:username"] || null,
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
