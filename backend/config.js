// ศูนย์รวมการตั้งค่าที่อ่านจาก Environment Variables
//
// แบ่งเป็น 2 กลุ่มชัดเจน:
//   1) PUBLIC  — ค่าระบุตัวตนสาธารณะ (Cognito User Pool ID, App Client ID, Origin ของเว็บ)
//                ไม่ใช่ความลับ (ฝั่ง Browser ก็เห็นค่าเหล่านี้) จึงมีค่าเริ่มต้นได้เพื่อไม่ให้ Login เดิมพัง
//   2) SECRET  — SESSION_SECRET, AUTH_JWT_SECRET, TU_API_KEY, COGNITO_CLIENT_SECRET, DB/AWS credentials
//                ต้องมาจาก Environment เท่านั้น ห้ามมีค่า fallback ในซอร์สโค้ด

function readList(value) {
    return String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function readEnv(name) {
    const value = process.env[name];
    return typeof value === "string" ? value.replace(/^['"]|['"]$/g, "").trim() : "";
}

const isProduction = () => readEnv("NODE_ENV").toLowerCase() === "production";

// ---------- PUBLIC identifiers ----------
const DEFAULT_COGNITO_REGION = "us-east-1";
const DEFAULT_COGNITO_USER_POOL_ID = "us-east-1_ySsGHRKUQ";
const DEFAULT_COGNITO_APP_CLIENT_ID = "7onljgop56a811chbidtuppffq";
// User Pool / App Client ที่ระบบยอมรับ token อยู่เดิม (ตรงกับ Embedded JWKS ใน cognito-auth.js)
const DEFAULT_ALLOWED_USER_POOL_IDS = ["us-east-1_ySsGHRKUQ", "us-east-1_1duzJEFfU"];
const DEFAULT_ALLOWED_CLIENT_IDS = [
    "7onljgop56a811chbidtuppffq",
    "454o0719rb9d6lkspv4m8tmb6i",
    "7k0t8e6499bro55f8faso44m2c"
];
// Origin ของ Frontend ที่ deploy จริง + Local dev
const DEFAULT_CORS_ALLOWED_ORIGINS = [
    "https://main.d29fui7wfvh5a0.amplifyapp.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

function getPublicCognitoConfig() {
    const region = readEnv("COGNITO_REGION") || DEFAULT_COGNITO_REGION;
    const userPoolId = readEnv("COGNITO_USER_POOL_ID") || DEFAULT_COGNITO_USER_POOL_ID;
    const appClientId = readEnv("COGNITO_APP_CLIENT_ID") || DEFAULT_COGNITO_APP_CLIENT_ID;
    const extraPools = readList(process.env.COGNITO_ALLOWED_USER_POOL_IDS);
    const extraClients = readList(process.env.COGNITO_ALLOWED_CLIENT_IDS);

    const allowedUserPoolIds = [...new Set([userPoolId, ...(extraPools.length ? extraPools : DEFAULT_ALLOWED_USER_POOL_IDS)])];
    const allowedClientIds = [...new Set([appClientId, ...(extraClients.length ? extraClients : DEFAULT_ALLOWED_CLIENT_IDS)])];

    return {
        region,
        userPoolId,
        appClientId,
        allowedUserPoolIds,
        allowedClientIds,
        allowedIssuers: allowedUserPoolIds.map(poolId => {
            const poolRegion = poolId.split("_")[0] || region;
            return `https://cognito-idp.${poolRegion}.amazonaws.com/${poolId}`;
        })
    };
}

function getCorsAllowedOrigins() {
    const configured = readList(process.env.CORS_ALLOWED_ORIGINS);
    return (configured.length ? configured : DEFAULT_CORS_ALLOWED_ORIGINS)
        .map(origin => origin.replace(/\/+$/, "").toLowerCase());
}

// ---------- SECRETS (Environment เท่านั้น) ----------
const MIN_JWT_SECRET_LENGTH = 16;

// Secret สำหรับเซ็น HS256 fallback token: ใช้ AUTH_JWT_SECRET ถ้ามี (แนะนำ) ไม่งั้นใช้ SESSION_SECRET เดิม
function getAuthJwtSecret() {
    const secret = readEnv("AUTH_JWT_SECRET") || readEnv("SESSION_SECRET");
    return secret.length >= MIN_JWT_SECRET_LENGTH ? secret : null;
}

function getTuApiConfig() {
    return {
        url: readEnv("TU_API_URL") || "https://restapi.tu.ac.th/api/v1/auth/Ad/verify",
        apiKey: readEnv("TU_API_KEY") || readEnv("TU_APP_KEY") || null
    };
}

// โหมดข้ามการตรวจ TU API (ยอมรับอีเมล @dome.tu.ac.th โดยไม่ตรวจรหัสผ่าน) — ใช้ได้เฉพาะ Local dev เท่านั้น
function isTuDevBypassEnabled() {
    return !isProduction() && readEnv("TU_AUTH_DEV_BYPASS").toLowerCase() === "true";
}

function getFallbackTokenTtlSeconds() {
    const hours = Number(readEnv("AUTH_FALLBACK_TOKEN_TTL_HOURS") || 8);
    const safeHours = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24) : 8;
    return Math.round(safeHours * 3600);
}

const FALLBACK_TOKEN_ISSUER = "docuflow-auth-fallback";

module.exports = {
    isProduction,
    getPublicCognitoConfig,
    getCorsAllowedOrigins,
    getAuthJwtSecret,
    getTuApiConfig,
    isTuDevBypassEnabled,
    getFallbackTokenTtlSeconds,
    FALLBACK_TOKEN_ISSUER,
    MIN_JWT_SECRET_LENGTH
};
