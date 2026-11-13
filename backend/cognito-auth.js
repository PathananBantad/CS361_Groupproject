const crypto = require("node:crypto");
const { CognitoJwtVerifier } = require("aws-jwt-verify");
const {
    getPublicCognitoConfig,
    getAuthJwtSecret,
    getFallbackTokenTtlSeconds,
    FALLBACK_TOKEN_ISSUER
} = require("./config");

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

// Helper ฟังก์ชันสำหรับสร้างและตรวจสอบ HS256 Token (สำหรับ TU Auth Fallback เมื่อ AWS Learner Lab ถูกระงับ)
// Secret มาจาก AUTH_JWT_SECRET (หรือ SESSION_SECRET เดิม) ใน Environment เท่านั้น
const CLOCK_SKEW_SECONDS = 60;

function decodeJwtPart(part) {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function signHs256Jwt(payload, secret) {
    const sec = secret || getAuthJwtSecret();
    if (!sec) throw new Error("AUTH_JWT_SECRET or SESSION_SECRET (>= 16 chars) must be configured");
    const now = Math.floor(Date.now() / 1000);
    const claims = {
        iat: now,
        exp: now + getFallbackTokenTtlSeconds(),
        ...payload,
        iss: FALLBACK_TOKEN_ISSUER,
        token_use: "access"
    };
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const sig = crypto.createHmac("sha256", sec).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${sig}`;
}

function verifyHs256Jwt(token, secret) {
    const sec = secret || getAuthJwtSecret();
    if (!sec) return null;
    const parts = (token || "").split(".");
    if (parts.length !== 3) return null;
    try {
        const header = decodeJwtPart(parts[0]);
        if (header.alg !== "HS256") return null;

        const expectedSig = crypto.createHmac("sha256", sec).update(`${parts[0]}.${parts[1]}`).digest("base64url");
        const actual = Buffer.from(parts[2]);
        const expected = Buffer.from(expectedSig);
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

        const payload = decodeJwtPart(parts[1]);
        const now = Math.floor(Date.now() / 1000);
        if (payload.iss !== FALLBACK_TOKEN_ISSUER || payload.token_use !== "access") return null;
        if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
        if (Number.isFinite(payload.iat) && payload.iat > now + CLOCK_SKEW_SECONDS) return null;
        if (typeof payload.sub !== "string" || !payload.sub || typeof payload.username !== "string" || !payload.username) return null;
        return payload;
    } catch (_) {
        return null;
    }
}

function verifyWithEmbeddedJwks(token) {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT token format");

    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);

    if (header.alg !== "RS256") {
        throw new Error("Invalid token algorithm");
    }

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp <= now) {
        throw new Error("Token expired");
    }
    if (Number.isFinite(payload.iat) && payload.iat > now + CLOCK_SKEW_SECONDS) {
        throw new Error("Token issued in the future");
    }

    if (payload.token_use !== "access") {
        throw new Error("Invalid token_use: expected access token");
    }

    const { allowedClientIds, allowedIssuers } = getPublicCognitoConfig();
    if (!allowedIssuers.includes(payload.iss)) {
        throw new Error("Issuer not allowed");
    }
    if (!allowedClientIds.includes(payload.client_id)) {
        throw new Error("Client ID not allowed");
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
    // Public identifiers (ไม่ใช่ secret) มาจาก config.js — env มาก่อน แล้วจึงใช้ค่าเริ่มต้นของระบบเดิม
    const { userPoolId, allowedClientIds } = getPublicCognitoConfig();

    if (!userPoolId) {
        throw new Error("Cognito environment variables are not configured");
    }

    if (!verifier) {
        verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: "access",
            clientId: allowedClientIds
        });
    }

    return verifier;
}

async function requireCognitoAuth(req, res, next) {
    // รองรับทั้ง Authorization Header และ Token ผ่าน Query Parameter (สำหรับ iframe/img preview)
    let authorization = req.headers.authorization;
    // Token ผ่าน query string รับเฉพาะ GET (เช่น iframe/img preview) เพื่อลดโอกาส token รั่วใน log ของคำขอที่แก้ไขข้อมูล
    if (!authorization && req.method === "GET" && typeof req.query?.token === "string") {
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

    // Guest ระบุตัวตนแล้วแต่ไม่มีสิทธิ์ใน API ที่ต้องยืนยันตัวตน
    // (รายละเอียดเอกสาร, assignment, file metadata, preview/download, audit trail, ลงทะเบียน ฯลฯ)
    // Guest ใช้ได้เฉพาะ GET /api/documents ที่คืนแค่ reference_no และ status
    if (token.toLowerCase() === "guest") {
        return res.status(403).json({
            error: "Forbidden",
            code: "GUEST_FORBIDDEN",
            message: "Guest can only view document reference numbers and statuses."
        });
    }

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
