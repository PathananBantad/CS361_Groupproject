const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
    CognitoConfigurationError,
    createCognitoVerifier,
    createRequireCognitoAuth
} = require("../cognito-auth");

const TEST_USER_POOL_ID = "us-east-1_testPool";
const TEST_APP_CLIENT_ID = "test-app-client";
const TEST_ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${TEST_USER_POOL_ID}`;
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048
});
const TEST_JWK = {
    ...publicKey.export({ format: "jwk" }),
    kid: "local-test-key",
    alg: "RS256",
    use: "sig"
};

function withCognitoEnvironment(values, callback) {
    const names = ["COGNITO_USER_POOL_ID", "COGNITO_APP_CLIENT_ID"];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));

    for (const name of names) {
        if (Object.hasOwn(values, name)) {
            process.env[name] = values[name];
        } else {
            delete process.env[name];
        }
    }

    const restore = () => {
        for (const name of names) {
            if (previous[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = previous[name];
            }
        }
    };

    try {
        const result = callback();
        if (result && typeof result.then === "function") {
            return result.finally(restore);
        }
        restore();
        return result;
    } catch (error) {
        restore();
        throw error;
    }
}

function createLocalCognitoVerifier() {
    return withCognitoEnvironment({
        COGNITO_USER_POOL_ID: TEST_USER_POOL_ID,
        COGNITO_APP_CLIENT_ID: TEST_APP_CLIENT_ID
    }, () => {
        const verifier = createCognitoVerifier();
        verifier.cacheJwks({ keys: [TEST_JWK] });
        return verifier;
    });
}

function signCognitoToken(overrides = {}, algorithm = "RS256") {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({
        alg: algorithm,
        kid: "local-test-key",
        typ: "JWT"
    })).toString("base64url");
    const payload = {
        iss: TEST_ISSUER,
        client_id: TEST_APP_CLIENT_ID,
        token_use: "access",
        sub: "verified-test-subject",
        username: "staff@example.invalid",
        iat: now,
        exp: now + 300,
        "cognito:groups": ["Staff/Instructor"],
        ...overrides
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signingInput = `${header}.${body}`;
    const signature = algorithm === "RS256"
        ? crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url")
        : crypto.createHmac("sha256", "unit-test-only-key").update(signingInput).digest("base64url");

    return `${signingInput}.${signature}`;
}

function responseRecorder() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function invokeMiddleware(middleware, token) {
    const req = {
        headers: { authorization: `Bearer ${token}` },
        query: {}
    };
    const res = responseRecorder();
    let nextCalls = 0;

    await middleware(req, res, () => {
        nextCalls += 1;
    });

    return { req, res, nextCalls };
}

test("Cognito verifier is bound to the configured pool, app client, and access-token use", () => {
    withCognitoEnvironment({
        COGNITO_USER_POOL_ID: TEST_USER_POOL_ID,
        COGNITO_APP_CLIENT_ID: TEST_APP_CLIENT_ID
    }, () => {
        let verifierOptions;
        const verifier = createCognitoVerifier(options => {
            verifierOptions = options;
            return { verify: async () => ({}) };
        });

        assert.deepEqual(verifierOptions, {
            userPoolId: TEST_USER_POOL_ID,
            tokenUse: "access",
            clientId: TEST_APP_CLIENT_ID
        });
        assert.equal(typeof verifier.verify, "function");
    });
});

test("Cognito verifier fails closed when pool or app-client configuration is missing", () => {
    withCognitoEnvironment({}, () => {
        assert.throws(
            () => createCognitoVerifier(() => {
                throw new Error("Verifier factory must not be called");
            }),
            CognitoConfigurationError
        );
    });
});

test("valid Cognito access tokens are verified and attached to the request", async () => {
    await withCognitoEnvironment({
        COGNITO_USER_POOL_ID: TEST_USER_POOL_ID,
        COGNITO_APP_CLIENT_ID: TEST_APP_CLIENT_ID
    }, async () => {
        const verifier = createLocalCognitoVerifier();
        const middleware = createRequireCognitoAuth(() => verifier);
        const { req, res, nextCalls } = await invokeMiddleware(
            middleware,
            signCognitoToken({ "cognito:groups": ["Staff/Instructor", 42] })
        );

        assert.equal(res.statusCode, null);
        assert.equal(nextCalls, 1);
        assert.deepEqual(req.auth, {
            sub: "verified-test-subject",
            username: "staff@example.invalid",
            groups: ["Staff/Instructor"]
        });
    });
});

test("HS256, malformed, expired, wrong-issuer, wrong-client, and ID tokens are rejected without fallback", async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalidSignatureParts = signCognitoToken().split(".");
    invalidSignatureParts[2] = "invalid-test-signature";
    const cases = [
        ["legacy HS256 token", signCognitoToken({ exp: now + 3600 }, "HS256")],
        ["token without expiration", signCognitoToken({ exp: undefined })],
        ["invalid signature", invalidSignatureParts.join(".")],
        ["malformed token", "not-a-jwt"],
        ["expired Cognito token", signCognitoToken({ exp: now - 60, iat: now - 360 })],
        ["wrong issuer", signCognitoToken({ iss: "https://issuer.example.invalid" })],
        ["wrong app client", signCognitoToken({ client_id: "another-app-client" })],
        ["ID token", signCognitoToken({ token_use: "id", aud: TEST_APP_CLIENT_ID })]
    ];

    await withCognitoEnvironment({
        COGNITO_USER_POOL_ID: TEST_USER_POOL_ID,
        COGNITO_APP_CLIENT_ID: TEST_APP_CLIENT_ID
    }, async () => {
        for (const [name, token] of cases) {
            let verifyCalls = 0;
            const cognitoVerifier = createLocalCognitoVerifier();
            const middleware = createRequireCognitoAuth(() => ({
                verify: async candidate => {
                    verifyCalls += 1;
                    return cognitoVerifier.verify(candidate);
                }
            }));

            const { req, res, nextCalls } = await invokeMiddleware(middleware, token);

            assert.equal(res.statusCode, 401, name);
            assert.equal(nextCalls, 0, name);
            assert.equal(req.auth, undefined, name);
            assert.equal(verifyCalls, 1, `${name}: verifier must be called once with no legacy fallback`);
        }
    });
});

test("verified payloads with invalid identity or non-access token use are rejected", async () => {
    await withCognitoEnvironment({
        COGNITO_USER_POOL_ID: TEST_USER_POOL_ID,
        COGNITO_APP_CLIENT_ID: TEST_APP_CLIENT_ID
    }, async () => {
        for (const payload of [
            {
                sub: "",
                iss: TEST_ISSUER,
                client_id: TEST_APP_CLIENT_ID,
                token_use: "access",
                exp: Math.floor(Date.now() / 1000) + 60
            },
            {
                sub: "verified-subject",
                iss: TEST_ISSUER,
                client_id: TEST_APP_CLIENT_ID,
                token_use: "id",
                exp: Math.floor(Date.now() / 1000) + 60
            }
        ]) {
            const middleware = createRequireCognitoAuth(() => ({
                verify: async () => payload
            }));
            const { req, res, nextCalls } = await invokeMiddleware(middleware, "verified-by-test-verifier");

            assert.equal(res.statusCode, 401);
            assert.equal(nextCalls, 0);
            assert.equal(req.auth, undefined);
        }
    });
});

test("Cognito verifier errors fail closed and never populate req.auth", async () => {
    let verifyCalls = 0;
    const middleware = createRequireCognitoAuth(() => ({
        verify: async () => {
            verifyCalls += 1;
            throw new Error("Cognito verification unavailable");
        }
    }));
    const { req, res, nextCalls } = await invokeMiddleware(middleware, "unverified-token");

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalls, 0);
    assert.equal(req.auth, undefined);
    assert.equal(verifyCalls, 1);
});
