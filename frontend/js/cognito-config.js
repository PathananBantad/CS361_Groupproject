window.COGNITO_CONFIG = {
    userPoolId: "us-east-1_1duzJEFfU",
    clientId: "454o0719rb9d6lkspv4m8tmb6i",
    region: "us-east-1"
};

window.API_BASE_URL = window.location.port === "3000"
    ? window.location.origin
    : "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";

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

    if (isProtectedApiRequest) {
        const token = localStorage.getItem("docuflow_access_token") ||
            localStorage.getItem("access_token") || "";
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    return fetch(createInput(), { ...options, headers }).then(async response => {
        if (response.status !== 401 || !isProtectedApiRequest) return response;

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

