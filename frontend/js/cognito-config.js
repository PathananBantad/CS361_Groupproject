// Public Cognito identifiers (ไม่ใช่ความลับ — เบราว์เซอร์ต้องใช้เพื่อ login แบบ SRP)
// ห้ามใส่ Client Secret, API Key หรือ credential ใด ๆ ในไฟล์ฝั่ง Frontend
window.COGNITO_CONFIG = {
    userPoolId: "us-east-1_ySsGHRKUQ",
    clientId: "7onljgop56a811chbidtuppffq",
    region: "us-east-1"
};

// ชื่อ Role มาตรฐาน (ตรงกับ backend/documentAuthorization.js ROLE_PRIORITY)
window.DOCUFLOW_ROLES = ["admin", "executive", "document_officer", "responsible_person", "faculty_staff"];
// แปลงชื่อ Role เก่า ("staff") ที่อาจค้างใน localStorage ให้เป็นชื่อมาตรฐาน
// และล้างค่า "guest" ที่ค้างจากเวอร์ชันเก่า (ระบบไม่มีโหมด Guest แล้ว)
try {
    const legacyRole = (localStorage.getItem("docuflow_role") || "").toLowerCase().trim();
    if (legacyRole === "staff") {
        localStorage.setItem("docuflow_role", "faculty_staff");
    } else if (legacyRole === "guest") {
        localStorage.removeItem("docuflow_role");
        if (localStorage.getItem("docuflow_user") === "Guest") localStorage.removeItem("docuflow_user");
    }
} catch (_) {}

// ตรวจว่ากำลังรันบนเครื่อง Local หรือไม่ (เช็คจาก hostname ไม่ใช่แค่ port 3000)
// รองรับทั้ง localhost, 127.0.0.1 และ Live Server (เช่น port 5500) ที่ไม่ได้ใช้ port 3000
window.IS_LOCAL = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(window.location.hostname);

// URL ของ Backend: AWS Lambda Function URL (Learner Lab)
window.AWS_API_GATEWAY_URL = "https://htvtloifbzeywxdh4gawlqoxdq0tftsv.lambda-url.us-east-1.on.aws";
window.API_GATEWAY_URL = window.AWS_API_GATEWAY_URL;

// ล้างค่า endpoint สำรองเก่าที่อาจค้างอยู่ใน sessionStorage
try {
    sessionStorage.removeItem("docuflow_active_api");
} catch (_) {}

// Origin ของ API (Local ใช้ origin ของหน้าเว็บเอง)
window.API_BASE_URL = window.IS_LOCAL ? window.location.origin : window.AWS_API_GATEWAY_URL;

// ฟังก์ชันกลางสำหรับหา Base URL ที่มี /api ต่อท้าย ใช้ร่วมกันทุกไฟล์
// (ป้องกันการเขียนตรรกะซ้ำที่ยึดติดกับ port 3000 ในหลายไฟล์)
// ใช้ชื่อ resolveApiBaseUrl เพื่อไม่ชนกับฟังก์ชัน getApiBaseUrl ที่ประกาศในไฟล์อื่น
window.resolveApiBaseUrl = function () {
    if (window.IS_LOCAL) {
        // dev server ตั้ง proxy ให้ /api ชี้ไป backend อยู่แล้ว ใช้ path แบบ relative
        return "/api";
    }
    const base = String(window.API_BASE_URL || "").replace(/\/+$/, "");
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
window.apiFetch = async function (input, options = {}) {
    let rawUrl = input instanceof Request ? input.url : input;
    if (typeof rawUrl === "string" && !window.IS_LOCAL && rawUrl.startsWith("/api")) {
        const base = String(window.API_BASE_URL || "").replace(/\/+$/, "");
        rawUrl = `${base}${rawUrl}`;
    }

    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));

    const isProtectedApi = typeof rawUrl === "string" && rawUrl.includes("/api/");
    if (isProtectedApi && !headers.has("Authorization")) {
        const token = localStorage.getItem("docuflow_access_token") ||
            localStorage.getItem("access_token") ||
            localStorage.getItem("docuflow_id_token") ||
            localStorage.getItem("id_token") || "";
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const requestOptions = { ...options, headers };
    const reqInput = input instanceof Request ? new Request(rawUrl, requestOptions) : rawUrl;
    const response = await fetch(reqInput, requestOptions);

    // จัดการกรณี 401 Token หมดอายุ (Cognito Token Refresh)
    if (response.status === 401 && isProtectedApi) {
        try {
            const refreshedAccessToken = await refreshCognitoSession();
            const retryHeaders = new Headers(requestOptions.headers);
            retryHeaders.set("Authorization", `Bearer ${refreshedAccessToken}`);
            const retryOptions = { ...requestOptions, headers: retryHeaders };
            const retryInput = input instanceof Request ? new Request(rawUrl, retryOptions) : rawUrl;
            return fetch(retryInput, retryOptions);
        } catch (_) {
            return response;
        }
    }

    return response;
};
