const crypto = require("node:crypto");
const { CognitoJwtVerifier } = require("aws-jwt-verify");

// Static JWKS keys for us-east-1_ySsGHRKUQ and us-east-1_1duzJEFfU (allows instant verification inside VPC without internet/NAT Gateway)
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

// Helper ฟังก์ชันสำหรับสร้างและตรวจสอบ HS256 Token (สำหรับ TU Auth Fallback เมื่อ AWS Learner Lab ถูกระงับหรือรันบน Render)
function signHs256Jwt(payload, secret) {
    const sec = secret || process.env.SESSION_SECRET || "cs361_docuflow_secret_key_2026";
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", sec).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${sig}`;
}

function verifyHs256Jwt(token, secret) {
    const sec = secret || process.env.SESSION_SECRET || "cs361_docuflow_secret_key_2026";
    const parts = (token || "").split(".");
    if (parts.length !== 3) return null;
    try {
        const expectedSig = crypto.createHmac("sha256", sec).update(`${parts[0]}.${parts[1]}`).digest("base64url");
        if (parts[2] !== expectedSig) return null;
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

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
        "7onljgop56a811chbidtuppffq",
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
    const userPoolId = process.env.COGNITO_USER_POOL_ID || "us-east-1_ySsGHRKUQ";
    const clientId = process.env.COGNITO_APP_CLIENT_ID || "7onljgop56a811chbidtuppffq";

    if (!userPoolId) {
        throw new Error("Cognito environment variables are not configured");
    }

    if (!verifier) {
        // รองรับทั้ง App Client ของ Frontend (7onljgop56a811chbidtuppffq / 454o0719rb9d6lkspv4m8tmb6i) และค่าจาก Environment
        const allowedClientIds = [
            clientId,
            "7onljgop56a811chbidtuppffq",
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
    // รองรับทั้ง Authorization Header และ Token ผ่าน Query Parameter (สำหรับ iframe/img preview)
    let authorization = req.headers.authorization;
    if (!authorization && req.query?.token) {
        authorization = `Bearer ${req.query.token}`;
    }

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
        // 1. ตรวจสอบ HS256 Token (กรณีล็อกอินผ่าน TU AD สำเร็จในขณะที่ Cognito Admin ไม่พร้อมใช้งาน)
        const fallbackPayload = verifyHs256Jwt(token);
        if (fallbackPayload) {
            req.auth = {
                sub: fallbackPayload.sub,
                username: fallbackPayload.username,
                groups: fallbackPayload["cognito:groups"] || []
            };
            return next();
        }

        // 2. ตรวจสอบ AWS Cognito RSA JWT Token แท้
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

module.exports = {
    requireCognitoAuth,
    signHs256Jwt,
    verifyHs256Jwt
};
