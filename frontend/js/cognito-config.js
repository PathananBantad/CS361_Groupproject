window.COGNITO_CONFIG = {
    userPoolId: "us-east-1_1duzJEFfU",
    clientId: "454o0719rb9d6lkspv4m8tmb6i",
    region: "us-east-1"
};

window.API_BASE_URL = window.location.port === "3000"
    ? window.location.origin
    : "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";

// Add the Cognito access token to protected API requests. The server remains
// the authority for identity, role, and document-level permissions.
window.apiFetch = function (input, options = {}) {
    const url = new URL(input, window.location.href);
    const apiOrigin = new URL(window.API_BASE_URL).origin;
    const headers = new Headers(options.headers || {});
    if (url.origin === apiOrigin && url.pathname.includes("/api/")) {
        const token = localStorage.getItem("docuflow_access_token") ||
            localStorage.getItem("access_token") || "";
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...options, headers });
};

