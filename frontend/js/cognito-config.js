window.COGNITO_CONFIG = {
    userPoolId: "us-east-1_ySsGHRKUQ",
    clientId: "7onljgop56a811chbidtuppffq",
    region: "us-east-1"
};

// ตรวจว่ากำลังรันบนเครื่อง Local หรือไม่ (เช็คจาก hostname ไม่ใช่แค่ port 3000)
// รองรับทั้ง localhost, 127.0.0.1 และ Live Server (เช่น port 5500) ที่ไม่ได้ใช้ port 3000
window.IS_LOCAL = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(window.location.hostname);

// URLs ของ Backend:
// - Primary: AWS API Gateway + Lambda (Learner Lab)
// - Fallback: Render Web Service (รัน 24/7 เชื่อมต่อ TiDB Cloud ชุดเดียวกัน)
window.AWS_API_GATEWAY_URL = "https://htvtloifbzeywxdh4gawlqoxdq0tftsv.lambda-url.us-east-1.on.aws";
window.RENDER_API_URL = "https://docuflow-backend-z2md.onrender.com";

window.PRIMARY_API_URL = window.AWS_API_GATEWAY_URL;
window.FALLBACK_API_URL = window.RENDER_API_URL;
window.API_GATEWAY_URL = window.PRIMARY_API_URL;

// ตรวจสอบ endpoint ที่จำไว้ในเซสชัน เพื่อไม่ให้ต้องรอ timeout ซ้ำในหน้านั้นๆ
let savedActiveApi = null;
try {
    savedActiveApi = sessionStorage.getItem("docuflow_active_api");
} catch (_) {}

window.ACTIVE_API_URL = window.IS_LOCAL
    ? window.location.origin
    : (savedActiveApi || window.PRIMARY_API_URL);

// Origin ของ API
window.API_BASE_URL = window.ACTIVE_API_URL;

// ฟังก์ชันสลับไปใช้ Render สำรองเมื่อ AWS มีปัญหา
window.switchToFallbackApi = function () {
    if (window.ACTIVE_API_URL !== window.FALLBACK_API_URL) {
        console.warn("[DocuFlow] Primary AWS API unavailable. Switching to 24/7 Render Failover:", window.FALLBACK_API_URL);
        window.ACTIVE_API_URL = window.FALLBACK_API_URL;
        window.API_BASE_URL = window.FALLBACK_API_URL;
        try {
            sessionStorage.setItem("docuflow_active_api", window.FALLBACK_API_URL);
        } catch (_) {}
    }
};

// ฟังก์ชันสลับกลับมาใช้ AWS เมื่อเปิด Lab กลับมาใช้งานได้ตามปกติ
window.switchToPrimaryApi = function () {
    if (window.ACTIVE_API_URL !== window.PRIMARY_API_URL) {
        console.info("[DocuFlow] AWS API is active. Switching back to AWS Primary API:", window.PRIMARY_API_URL);
        window.ACTIVE_API_URL = window.PRIMARY_API_URL;
        window.API_BASE_URL = window.PRIMARY_API_URL;
        try {
            sessionStorage.removeItem("docuflow_active_api");
        } catch (_) {}
    }
};

// ฟังก์ชันกลางสำหรับหา Base URL ที่มี /api ต่อท้าย ใช้ร่วมกันทุกไฟล์
// (ป้องกันการเขียนตรรกะซ้ำที่ยึดติดกับ port 3000 ในหลายไฟล์)
// ใช้ชื่อ resolveApiBaseUrl เพื่อไม่ชนกับฟังก์ชัน getApiBaseUrl ที่ประกาศในไฟล์อื่น
window.resolveApiBaseUrl = function () {
    if (window.IS_LOCAL) {
        // dev server ตั้ง proxy ให้ /api ชี้ไป backend อยู่แล้ว ใช้ path แบบ relative
        return "/api";
    }
    const rawBase = window.ACTIVE_API_URL || window.API_BASE_URL || window.PRIMARY_API_URL;
    const base = String(rawBase || "").replace(/\/+$/, "");
    return base.endsWith("/api") ? base : `${base}/api`;
};

// ฟังก์ชันกลางป้องกัน XSS ใช้ร่วมกันหลายไฟล์ (รวม escapeHtml ที่เดิมเขียนซ้ำใน dashboard.js และ document-modal.js)
// ใช้ชื่อ escapeHtmlSafe เพื่อไม่ชนกับ function declaration ชื่อ escapeHtml ในไฟล์อื่น (กัน recursion)
window.escapeHtmlSafe = function (value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

let cognitoRefreshPromise;

function refreshCognitoSession() {
    if (cognitoRefreshPromise) return cognitoRefreshPromise;

    cognitoRefreshPromise = new Promise((resolve, reject) => {
        const config = window.COGNITO_CONFIG;
        const identity = window.AmazonCognitoIdentity;
        const username = localStorage.getItem("docuflow_user");

        if (!identity || !config?.userPoolId || !config?.clientId || !username) {
            reject(new Error("Cognito session refresh is unavailable"));
            return;
        }

        const pool = new identity.CognitoUserPool({
            UserPoolId: config.userPoolId,
            ClientId: config.clientId
        });
        const user = new identity.CognitoUser({ Username: username, Pool: pool });

        user.getSession((error, session) => {
            if (error || !session || !session.isValid()) {
                reject(error || new Error("Cognito session is invalid"));
                return;
            }

            const accessToken = session.getAccessToken().getJwtToken();
            const idToken = session.getIdToken().getJwtToken();
            localStorage.setItem("docuflow_access_token", accessToken);
            localStorage.setItem("access_token", accessToken);
            localStorage.setItem("docuflow_id_token", idToken);
            localStorage.setItem("id_token", idToken);
            resolve(accessToken);
        });
    }).finally(() => {
        cognitoRefreshPromise = null;
    });

    return cognitoRefreshPromise;
}

// ปรับเปลี่ยน URL ให้เป็น Render หาก Active API กำลังชี้ไปที่ Render
function rewriteApiUrl(rawUrl) {
    if (typeof rawUrl !== "string" || window.IS_LOCAL) return rawUrl;
    if (window.ACTIVE_API_URL === window.FALLBACK_API_URL) {
        if (rawUrl.startsWith(window.PRIMARY_API_URL)) {
            return rawUrl.replace(window.PRIMARY_API_URL, window.FALLBACK_API_URL);
        }
    }
    return rawUrl;
}

// Add the Cognito access token to protected API requests. The server remains
// the authority for identity, role, and document-level permissions.
// พร้อมระบบ Smart Auto-Fallback: เมื่อ AWS API Gateway ล่ม/ส่ง 500 (เช่น Lab ดับ) จะสลับไปยิง Render อัตโนมัติทันที
window.apiFetch = async function (input, options = {}) {
    let rawUrl = input instanceof Request ? input.url : input;
    if (typeof rawUrl === "string" && !window.IS_LOCAL && rawUrl.startsWith("/api")) {
        const base = String(window.ACTIVE_API_URL || window.API_BASE_URL || window.PRIMARY_API_URL || "").replace(/\/+$/, "");
        rawUrl = `${base}${rawUrl}`;
    }
    rawUrl = rewriteApiUrl(rawUrl);

    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));

    // Guest ไม่แนบ Token และไม่พยายาม refresh เมื่อเจอ 401 (ป้องกัน Token เก่าค้างและลูป refresh ที่ไม่จำเป็น)
    const isGuest = (localStorage.getItem("docuflow_role") || "").toLowerCase().trim() === "guest";

    const isProtectedApi = typeof rawUrl === "string" && rawUrl.includes("/api/") && !isGuest;
    if (isProtectedApi && !headers.has("Authorization")) {
        const token = localStorage.getItem("docuflow_access_token") ||
            localStorage.getItem("access_token") ||
            localStorage.getItem("docuflow_id_token") ||
            localStorage.getItem("id_token") || "";
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const requestOptions = { ...options, headers };

    const executeFetch = async (targetUrl) => {
        const reqInput = input instanceof Request ? new Request(targetUrl, requestOptions) : targetUrl;
        return fetch(reqInput, requestOptions);
    };

    let response;
    let primaryFailed = false;

    try {
        response = await executeFetch(rawUrl);

        // ตรวจสอบกรณีเซิร์ฟเวอร์หลัก (AWS) ส่ง Error 500/502/503/504
        if (
            !window.IS_LOCAL &&
            response.status >= 500 &&
            typeof rawUrl === "string" &&
            rawUrl.startsWith(window.PRIMARY_API_URL)
        ) {
            console.warn(`[DocuFlow] Primary API returned HTTP ${response.status}. Initiating seamless failover to Render...`);
            primaryFailed = true;
        }
    } catch (networkErr) {
        // กรณีเชื่อมต่อไม่ได้ (เช่น Network error, CORS error เมื่อ API Gateway ปิดตัวลง)
        if (
            !window.IS_LOCAL &&
            typeof rawUrl === "string" &&
            rawUrl.startsWith(window.PRIMARY_API_URL)
        ) {
            console.warn("[DocuFlow] Primary API connection error. Initiating seamless failover to Render...", networkErr.message);
            primaryFailed = true;
        } else {
            throw networkErr;
        }
    }

    // หาก Primary ล้มเหลว ให้ Failover ไปยัง Render สำรองทันที
    if (primaryFailed) {
        window.switchToFallbackApi();
        const fallbackUrl = rawUrl.replace(window.PRIMARY_API_URL, window.FALLBACK_API_URL);
        try {
            response = await executeFetch(fallbackUrl);
            console.info("[DocuFlow] Failover to Render successful (Status:", response.status, ")");
        } catch (fallbackErr) {
            console.error("[DocuFlow] Both Primary AWS and Render fallback failed:", fallbackErr);
            throw fallbackErr;
        }
    }

    // จัดการกรณี 401 Token หมดอายุ (Cognito Token Refresh)
    if (response && response.status === 401 && isProtectedApi) {
        try {
            const refreshedAccessToken = await refreshCognitoSession();
            const retryHeaders = new Headers(requestOptions.headers);
            retryHeaders.set("Authorization", `Bearer ${refreshedAccessToken}`);
            const currentUrl = window.ACTIVE_API_URL === window.FALLBACK_API_URL
                ? rawUrl.replace(window.PRIMARY_API_URL, window.FALLBACK_API_URL)
                : rawUrl;
            return fetch(currentUrl, { ...requestOptions, headers: retryHeaders });
        } catch (_) {
            return response;
        }
    }

    return response;
};

// ตรวจสอบสถานะ AWS ในเบื้องหลังเป็นระยะ หาก AWS Learner Lab ถูกเปิดใช้งานอีกครั้ง จะสลับกลับมาใช้ AWS อัตโนมัติ
if (!window.IS_LOCAL && typeof window !== "undefined") {
    const probePrimaryApi = async () => {
        if (window.ACTIVE_API_URL === window.FALLBACK_API_URL) {
            try {
                const testRes = await fetch(`${window.PRIMARY_API_URL}/api/health`, {
                    signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
                });
                if (testRes.ok) {
                    window.switchToPrimaryApi();
                }
            } catch (_) {}
        }
    };

    setTimeout(probePrimaryApi, 30000);
    setInterval(probePrimaryApi, 120000);
}
