const crypto = require("node:crypto");
const { CognitoJwtVerifier } = require("aws-jwt-verify");

// Static JWKS keys for us-east-1_1duzJEFfU (allows instant verification inside VPC without internet/NAT Gateway)
const EMBEDDED_JWKS = {
    keys: [
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

function verifyWithEmbeddedJwks(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT token format");

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
        throw new Error("Token expired");
    }

    if (payload.token_use !== "access") {
        throw new Error("Invalid token_use: expected access token");
    }

    const allowedClientIds = [
        process.env.COGNITO_APP_CLIENT_ID,
        "454o0719rb9d6lkspv4m8tmb6i",
        "7k0t8e6499bro55f8faso44m2c"
    ].filter(Boolean);

    if (allowedClientIds.length > 0 && !allowedClientIds.includes(payload.client_id)) {
        throw new Error(`Client ID not allowed: ${payload.client_id}`);
    }

    const jwk = EMBEDDED_JWKS.keys.find(k => k.kid === header.kid);
    if (!jwk) {
        throw new Error(`Key ID not found: ${header.kid}`);
    }

    let publicKey = cachedPublicKeys.get(jwk.kid);
    if (!publicKey) {
        publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
        cachedPublicKeys.set(jwk.kid, publicKey);
    }

    const isValid = crypto.verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        publicKey,
        Buffer.from(parts[2], "base64url")
    );

    if (!isValid) {
        throw new Error("Invalid token signature");
    }

    return payload;
}

let verifier;

function getVerifier() {
    const userPoolId = process.env.COGNITO_USER_POOL_ID || "us-east-1_1duzJEFfU";
    const clientId = process.env.COGNITO_APP_CLIENT_ID;

    if (!userPoolId) {
        throw new Error("Cognito environment variables are not configured");
    }

    if (!verifier) {
        // รองรับทั้ง App Client ของ Frontend (454o0719rb9d6lkspv4m8tmb6i) และค่าจาก Environment
        const allowedClientIds = [
            clientId,
            "454o0719rb9d6lkspv4m8tmb6i",
            "7k0t8e6499bro55f8faso44m2c"
        ].filter(Boolean);

        verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: "access",
            clientId: allowedClientIds.length > 0 ? [...new Set(allowedClientIds)] : null
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

    // Support mock tokens for local testing when not in AWS Lambda production
    if ((process.env.NODE_ENV !== "production" && !process.env.LAMBDA_TASK_ROOT) && token.startsWith("mock-")) {
        const identifier = token.replace(/^mock-/, "").toLowerCase().trim();
        const mockMap = {
            "admin": { sub: "5448a408-e021-707c-1d11-b55e3d175081", username: "admin", groups: ["admin"] },
            "pathanan.ban@dome.tu.ac.th": { sub: "5448a408-e021-707c-1d11-b55e3d175081", username: "admin", groups: ["admin"] },
            "staff-1": { sub: "staff-1-mock-sub", username: "STAFF-1", groups: ["document_officer"] },
            "document_officer": { sub: "647894e8-3051-7035-4815-dfaf9bd1c5be", username: "document_officer", groups: ["document_officer"] },
            "head-1": { sub: "head-1-mock-sub", username: "HEAD-1", groups: ["case_owner"] },
            "case_owner": { sub: "04385448-d091-708b-05de-9acd6a322b40", username: "case_owner", groups: ["case_owner"] },
            "fac-a": { sub: "fac-a-mock-sub", username: "FAC-A", groups: ["faculty_staff"] },
            "fac-b": { sub: "fac-b-mock-sub", username: "FAC-B", groups: ["faculty_staff"] },
            "staff": { sub: "44487458-e051-70c5-f8b2-51e4398c001f", username: "staff", groups: ["faculty_staff"] },
            "faculty_staff": { sub: "fac-a-mock-sub", username: "FAC-A", groups: ["faculty_staff"] },
            "executive": { sub: "34487488-a021-70a9-118b-19e5a44505ae", username: "executive", groups: ["executive"] }
        };

        const resolved = mockMap[identifier] || { sub: `mock-sub-${identifier}`, username: identifier, groups: [] };
        req.auth = {
            sub: resolved.sub,
            username: resolved.username,
            groups: resolved.groups
        };
        return next();
    }

    try {
        let payload;
        try {
            payload = verifyWithEmbeddedJwks(token);
        } catch (embeddedErr) {
            payload = await getVerifier().verify(token);
        }

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
