const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const express = require("express");
const { CognitoIdentityProviderClient } = require("@aws-sdk/client-cognito-identity-provider");
const AmazonCognitoIdentity = require("amazon-cognito-identity-js");

const testEnvironment = {
    COGNITO_REGION: "us-east-1",
    COGNITO_USER_POOL_ID: "us-east-1_testPool",
    COGNITO_APP_CLIENT_ID: "test-app-client",
    COGNITO_CLIENT_SECRET: "unit-test-cognito-secret",
    TU_API_URL: "https://tu-api.test/auth/verify",
    TU_API_KEY: "unit-test-tu-key",
    TU_APP_KEY: "",
    aws_access_key_id: "unit-test-access-key",
    aws_secret_access_key: "unit-test-secret-key",
    aws_session_token: "unit-test-session-token",
    AWS_ACCESS_KEY_ID: "unit-test-access-key",
    AWS_SECRET_ACCESS_KEY: "unit-test-secret-key",
    AWS_SESSION_TOKEN: "unit-test-session-token",
    DB_HOST: "localhost",
    DB_USER: "unit-test-user",
    DB_PASSWORD: "unit-test-password",
    DB_NAME: "unit_test"
};
const previousEnvironment = Object.fromEntries(
    Object.keys(testEnvironment).map(name => [name, process.env[name]])
);
Object.assign(process.env, testEnvironment);

const pool = require("../db");
const authRouter = require("../auth");

after(() => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
});

async function createLoginServer(t) {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise(resolve => server.close(resolve)));

    return `http://127.0.0.1:${server.address().port}/api/auth/tu-login`;
}

function mockTuApiFetch(t, originalFetch) {
    t.mock.method(globalThis, "fetch", async (input, init) => {
        if (String(input) === testEnvironment.TU_API_URL) {
            assert.equal(init.method, "POST");
            assert.equal(init.headers["Application-Key"], testEnvironment.TU_API_KEY);
            return {
                ok: true,
                json: async () => ({
                    status: true,
                    email: "staff@example.invalid",
                    displayname_en: "Test Staff"
                })
            };
        }

        return originalFetch(input, init);
    });
}

async function postLogin(
    url,
    username = "staff@example.invalid",
    password = "Unit-test-password-1!"
) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username,
            password
        })
    });

    return {
        status: response.status,
        body: await response.json()
    };
}

async function runTuLoginWithFailure(t, tuApiHandler, { missingApiKey = false } = {}) {
    const calls = { tuApi: [], cognito: [], database: [] };
    if (missingApiKey) {
        const previousTuApiKey = process.env.TU_API_KEY;
        const previousTuAppKey = process.env.TU_APP_KEY;
        delete process.env.TU_API_KEY;
        delete process.env.TU_APP_KEY;
        t.after(() => {
            if (previousTuApiKey === undefined) delete process.env.TU_API_KEY;
            else process.env.TU_API_KEY = previousTuApiKey;
            if (previousTuAppKey === undefined) delete process.env.TU_APP_KEY;
            else process.env.TU_APP_KEY = previousTuAppKey;
        });
    }

    const originalFetch = globalThis.fetch;
    t.mock.method(globalThis, "fetch", async (input, init) => {
        if (String(input) === testEnvironment.TU_API_URL) {
            calls.tuApi.push({ input, init });
            return tuApiHandler(input, init);
        }
        return originalFetch(input, init);
    });
    t.mock.method(pool, "query", async (...args) => {
        calls.database.push(args);
        return [[], []];
    });
    t.mock.method(CognitoIdentityProviderClient.prototype, "send", async command => {
        calls.cognito.push(command.constructor.name);
        if (command.constructor.name === "InitiateAuthCommand") {
            const error = new Error("Mock Cognito authentication rejection");
            error.name = "NotAuthorizedException";
            throw error;
        }
        throw new Error("Unexpected Cognito account operation in TU failure test");
    });

    const url = await createLoginServer(t);
    return {
        result: await postLogin(url, "staff@dome.tu.ac.th", "1234"),
        calls
    };
}

test("TU authentication does not return an identity when Cognito cannot issue a token", async t => {
    const originalFetch = globalThis.fetch;
    mockTuApiFetch(t, originalFetch);
    t.mock.method(pool, "query", async () => [[], []]);
    t.mock.method(CognitoIdentityProviderClient.prototype, "send", async (_command) => {
        const error = new Error("Cognito is unavailable in this test");
        error.name = "ServiceUnavailableException";
        throw error;
    });

    const url = await createLoginServer(t);
    const result = await postLogin(url);

    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, "COGNITO_TOKEN_UNAVAILABLE");
    assert.equal(Object.hasOwn(result.body, "access_token"), false);
    assert.equal(Object.hasOwn(result.body, "id_token"), false);
    assert.equal(Object.hasOwn(result.body, "username"), false);
    assert.equal(Object.hasOwn(result.body, "groups"), false);
    assert.equal(Object.hasOwn(result.body, "role"), false);
});

test("successful TU authentication continues to issue and return Cognito tokens", async t => {
    const originalFetch = globalThis.fetch;
    mockTuApiFetch(t, originalFetch);
    t.mock.method(pool, "query", async () => [[], []]);
    t.mock.method(CognitoIdentityProviderClient.prototype, "send", async command => {
        switch (command.constructor.name) {
            case "InitiateAuthCommand": {
                const error = new Error("No direct Cognito account for this test");
                error.name = "NotAuthorizedException";
                throw error;
            }
            case "AdminGetUserCommand":
                return {
                    Username: "staff@example.invalid",
                    UserAttributes: [{ Name: "sub", Value: "test-cognito-subject" }]
                };
            case "AdminListGroupsForUserCommand":
                return { Groups: [{ GroupName: "Staff/Instructor" }] };
            case "AdminSetUserPasswordCommand":
                return {};
            default:
                throw new Error(`Unexpected Cognito command: ${command.constructor.name}`);
        }
    });
    t.mock.method(
        AmazonCognitoIdentity.CognitoUser.prototype,
        "authenticateUser",
        (_details, callbacks) => {
            callbacks.onSuccess({
                getAccessToken: () => ({ getJwtToken: () => "test-cognito-access-token" }),
                getIdToken: () => ({
                    getJwtToken: () => "test-cognito-id-token",
                    decodePayload: () => ({ "cognito:groups": ["Staff/Instructor"] })
                })
            });
        }
    );

    const url = await createLoginServer(t);
    const result = await postLogin(url);

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.access_token, "test-cognito-access-token");
    assert.equal(result.body.id_token, "test-cognito-id-token");
    assert.equal(result.body.role, "faculty_staff");
    assert.deepEqual(result.body.groups, ["Staff/Instructor"]);
});

test("invalid TU credentials are rejected without Cognito account changes", async t => {
    const { result, calls } = await runTuLoginWithFailure(t, async () => ({
        ok: true,
        json: async () => ({ status: false, message: "do not expose upstream details" })
    }));

    assert.equal(result.status, 401);
    assert.equal(result.body.code, "INVALID_CREDENTIALS");
    assert.equal(result.body.message, "Invalid username or password.");
    assert.equal(JSON.stringify(result.body).includes("do not expose upstream details"), false);
    assert.deepEqual(calls.cognito, ["InitiateAuthCommand"]);
    assert.deepEqual(calls.database, []);
});

for (const [failureName, failure] of [
    ["timeout", () => { throw Object.assign(new Error("mock timeout detail"), { name: "TimeoutError" }); }],
    ["network failure", () => { throw new Error("mock network detail"); }],
    ["HTTP error", () => ({ ok: false, status: 503, json: async () => ({ status: true }) })],
    ["malformed JSON", () => ({ ok: true, json: async () => { throw new Error("mock parse detail"); } })],
    ["malformed response", () => ({ ok: true, json: async () => "not an object" })]
]) {
    test(`TU API ${failureName} fails closed without Cognito account changes`, async t => {
        const { result, calls } = await runTuLoginWithFailure(t, failure);

        assert.equal(result.status, 503);
        assert.equal(result.body.code, "TU_AUTH_UNAVAILABLE");
        assert.equal(result.body.message, "TU authentication is temporarily unavailable. Please try again later.");
        assert.equal(JSON.stringify(result.body).includes("mock"), false);
        assert.deepEqual(calls.cognito, ["InitiateAuthCommand"]);
        assert.deepEqual(calls.database, []);
    });
}

test("missing TU API credentials fail safely without calling TU or changing Cognito", async t => {
    const { result, calls } = await runTuLoginWithFailure(
        t,
        async () => {
            throw new Error("TU API must not be called without a configured key");
        },
        { missingApiKey: true }
    );

    assert.equal(result.status, 503);
    assert.equal(result.body.code, "TU_AUTH_UNAVAILABLE");
    assert.deepEqual(calls.tuApi, []);
    assert.deepEqual(calls.cognito, ["InitiateAuthCommand"]);
    assert.deepEqual(calls.database, []);
});
