window.COGNITO_CONFIG = {
    userPoolId: "us-east-1_1duzJEFfU",
    clientId: "454o0719rb9d6lkspv4m8tmb6i"
};

window.API_BASE_URL =
    "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";

window.getApiBaseUrl = function () {
    const base = window.API_BASE_URL || "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";
    return base.endsWith("/api") ? base : `${base}/api`;
};
