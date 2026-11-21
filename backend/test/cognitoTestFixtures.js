const crypto = require("node:crypto");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = {
    iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testPool",
    client_id: "test-app-client",
    token_use: "access"
};

function tokenFor(claims = {}) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-cognito-key" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
        ...config,
        sub: "test-cognito-sub",
        username: "test@example.invalid",
        exp: Math.floor(Date.now() / 1000) + 600,
        ...claims
    })).toString("base64url");
    const input = `${header}.${payload}`;
    return `${input}.${crypto.sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

function installCognitoTestVerifier() {
    process.env.COGNITO_USER_POOL_ID = "us-east-1_testPool";
    process.env.COGNITO_APP_CLIENT_ID = "test-app-client";
    const cognitoAuth = require("../cognito-auth");
    const verify = async token => {
        const [headerPart, payloadPart, signaturePart] = token.split(".");
        const header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
        if (header.alg !== "RS256" || !crypto.verify(
            "RSA-SHA256", Buffer.from(`${headerPart}.${payloadPart}`), publicKey,
            Buffer.from(signaturePart, "base64url")
        )) throw new Error("Invalid Cognito test signature");
        if (payload.token_use !== "access" || payload.iss !== config.iss || payload.client_id !== config.client_id || payload.exp <= Date.now() / 1000) {
            throw new Error("Invalid Cognito test claims");
        }
        return payload;
    };
    cognitoAuth.requireCognitoAuth = cognitoAuth.createRequireCognitoAuth(() => ({ verify }));
    return { tokenFor, cognitoAuth };
}

module.exports = { tokenFor, installCognitoTestVerifier };
