const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

Object.assign(process.env, {
    SESSION_SECRET: "unit-test-session-secret",
    COGNITO_REGION: "us-east-1",
    COGNITO_USER_POOL_ID: "us-east-1_unitTestPool",
    COGNITO_APP_CLIENT_ID: "unit-test-client",
    TU_API_URL: "https://tu-api.test/verify",
    TU_API_KEY: "unit-test-key",
    DB_HOST: "localhost",
    DB_USER: "unit-test-user",
    DB_PASSWORD: "unit-test-password",
    DB_NAME: "unit_test",
    AWS_REGION: "us-east-1"
});

const pool = require("../db");
const { installCognitoTestVerifier } = require("./cognitoTestFixtures");
const { tokenFor } = installCognitoTestVerifier();
const app = require("../server");

const officerToken = tokenFor({
    sub: "fallback-test-cognito-sub",
    username: "fallback-test-officer"
});
let server;
let baseUrl;

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = "http://127.0.0.1:" + server.address().port;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});

test("document officer fallback assigns an active faculty_staff through role mappings without warning", async t => {
    const observedQueries = [];
    const warnings = [];
    let connectionCount = 0;
    const fallbackUserId = 42;
    const documentId = 9001;

    t.mock.method(console, "warn", (...args) => warnings.push(args));
    t.mock.method(pool, "query", async (sql, params) => {
        observedQueries.push({ sql, params });

        if (sql.includes("FROM users u") && sql.includes("JOIN users_roles ur")) {
            return [[{ id: fallbackUserId }], []];
        }
        if (sql.includes("SELECT reference_no FROM documents")) {
            return [[], []];
        }
        if (sql.includes("FROM documents d") && sql.includes("WHERE d.id = ?")) {
            return [[{
                id: documentId,
                subject: "Fallback assignment test",
                assignee_id: fallbackUserId
            }], []];
        }

        throw new Error("Unexpected pool query: " + sql);
    });
    t.mock.method(pool, "getConnection", async () => {
        connectionCount += 1;

        if (connectionCount === 1) {
            return {
                beginTransaction: async () => {},
                execute: async sql => {
                    if (sql.includes("WHERE cognito_sub = ?")) {
                        return [[{
                            id: 7,
                            username: "fallback-test-officer",
                            full_name: "Fallback Test Officer",
                            cognito_sub: "fallback-test-cognito-sub",
                            role: "document_officer"
                        }], []];
                    }
                    if (sql.includes("FROM users_roles ur")) {
                        return [[{ id: 2, name: "document_officer" }], []];
                    }
                    throw new Error("Unexpected auth query: " + sql);
                },
                commit: async () => {},
                rollback: async () => {},
                release: () => {}
            };
        }

        return {
            beginTransaction: async () => {},
            query: async sql => {
                if (sql.includes("INSERT INTO documents")) {
                    return [{ insertId: documentId }, []];
                }
                return [{ insertId: 1 }, []];
            },
            commit: async () => {},
            rollback: async () => {},
            release: () => {}
        };
    });

    const response = await fetch(baseUrl + "/api/documents", {
        method: "POST",
        headers: {
            Authorization: "Bearer " + officerToken,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            subject: "Fallback assignment test",
            document_type: "เอกสารแจ้งเพื่อทราบ",
            sender_name: "Unit Test",
            receiving_channel: "EMAIL"
        })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.assignee_id, fallbackUserId);

    const fallbackQuery = observedQueries.find(query =>
        query.sql.includes("JOIN users_roles ur") && query.sql.includes("JOIN roles r")
    );
    assert.ok(fallbackQuery, "fallback must query users through users_roles and roles");
        assert.ok(fallbackQuery.sql.includes("r.name = ?"));
        assert.ok(fallbackQuery.sql.includes("u.is_active = 1"));
    assert.deepEqual(fallbackQuery.params, ["faculty_staff"]);
    assert.equal(
        warnings.some(args => String(args[0]).includes("Fallback faculty_staff assignment failed")),
        false
    );
});
