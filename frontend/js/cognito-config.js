window.COGNITO_CONFIG = {
    userPoolId: "us-east-1_1duzJEFfU",
    clientId: "454o0719rb9d6lkspv4m8tmb6i",
    region: "us-east-1"
};

// ตรวจว่ากำลังรันบนเครื่อง Local หรือไม่ (เช็คจาก hostname ไม่ใช่แค่ port 3000)
// รองรับทั้ง localhost, 127.0.0.1 และ Live Server (เช่น port 5500) ที่ไม่ได้ใช้ port 3000
window.IS_LOCAL = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(window.location.hostname);

// URL ของ Backend API Gateway บน Production (AWS)
window.API_GATEWAY_URL = "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";

// Origin ของ API:
// - Local: ยิงไปที่ origin เดียวกับหน้าเว็บ (dev server มี proxy /api ไปยัง backend)
// - Production (Amplify): ยิงไปที่ API Gateway โดยตรง
window.API_BASE_URL = window.IS_LOCAL
    ? window.location.origin
    : window.API_GATEWAY_URL;

// ฟังก์ชันกลางสำหรับหา Base URL ที่มี /api ต่อท้าย ใช้ร่วมกันทุกไฟล์
// (ป้องกันการเขียนตรรกะซ้ำที่ยึดติดกับ port 3000 ในหลายไฟล์)
// ใช้ชื่อ resolveApiBaseUrl เพื่อไม่ชนกับฟังก์ชัน getApiBaseUrl ที่ประกาศในไฟล์อื่น
window.resolveApiBaseUrl = function () {
    if (window.IS_LOCAL) {
        // dev server ตั้ง proxy ให้ /api ชี้ไป backend อยู่แล้ว ใช้ path แบบ relative
        return "/api";
    }
    const base = window.API_BASE_URL || window.API_GATEWAY_URL;
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

// Add the Cognito access token to protected API requests. The server remains
// the authority for identity, role, and document-level permissions.
window.apiFetch = function (input, options = {}) {
    const requestUrl = input instanceof Request ? input.url : input;
    const url = new URL(requestUrl, window.location.href);
    const apiOrigin = new URL(window.API_BASE_URL).origin;
    const isProtectedApiRequest = url.origin === apiOrigin && url.pathname.includes("/api/");
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    const createInput = () => input instanceof Request ? input.clone() : input;

    // Guest ไม่แนบ Token และไม่พยายาม refresh เมื่อเจอ 401 (ป้องกัน Token เก่าค้างและลูป refresh ที่ไม่จำเป็น)
    const isGuest = (localStorage.getItem("docuflow_role") || "").toLowerCase().trim() === "guest";

    if (isProtectedApiRequest && !isGuest) {
        const token = localStorage.getItem("docuflow_access_token") ||
            localStorage.getItem("access_token") || "";
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    return fetch(createInput(), { ...options, headers }).then(async response => {
        if (response.status !== 401 || !isProtectedApiRequest || isGuest) return response;

        try {
            const refreshedAccessToken = await refreshCognitoSession();
            const retryHeaders = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
            retryHeaders.set("Authorization", `Bearer ${refreshedAccessToken}`);
            return fetch(createInput(), { ...options, headers: retryHeaders });
        } catch (error) {
            // Keep the original 401 response; never log or expose token material.
            return response;
        }
    });
};

