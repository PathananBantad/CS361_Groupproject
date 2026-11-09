const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { Readable, PassThrough } = require("node:stream");

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
const cognitoAuth = require("../cognito-auth");
const s3 = require("../s3");
const validTestToken = "unit-test-valid-token";
let s3ObjectFactory = async () => ({
    Body: Readable.from([]),
    ContentLength: 0
});
let observedS3Keys = [];

s3.getS3Object = async fileKey => {
    observedS3Keys.push(fileKey);
    return s3ObjectFactory(fileKey);
};

cognitoAuth.requireCognitoAuth = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${validTestToken}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    req.auth = {
        sub: "unit-test-cognito-sub",
        username: "unit-test-user",
        groups: []
    };
    return next();
};

const app = require("../server");
let server;
let baseUrl;
let currentRole = "faculty_staff";
let queryRows = [];
let observedQueries = [];

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

function installDatabaseMocks(t) {
    observedQueries = [];
    observedS3Keys = [];
    t.mock.method(pool, "query", async (sql, params) => {
        observedQueries.push({ sql, params });
        return [queryRows, []];
    });
    t.mock.method(pool, "getConnection", async () => ({
        beginTransaction: async () => {},
        execute: async (sql) => {
            if (sql.includes("WHERE cognito_sub = ?")) {
                return [[{
                    id: 17,
                    username: "unit-test-user",
                    full_name: "Unit Test User",
                    cognito_sub: "unit-test-cognito-sub",
                    role: currentRole
                }], []];
            }
            if (sql.includes("FROM users_roles ur")) {
                return [[{ name: currentRole }], []];
            }
            throw new Error("Unexpected database statement in route test");
        },
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
    }));
}

async function getDownload(t, { authorization } = {}) {
    installDatabaseMocks(t);
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`${baseUrl}/api/documents/44/download-file`, { headers });
    return {
        status: response.status,
        headers: response.headers,
        body: Buffer.from(await response.arrayBuffer())
    };
}

async function getDocuments(t, { authorization, query = "" } = {}) {
    installDatabaseMocks(t);
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await fetch(`${baseUrl}/api/documents${query}`, { headers });
    return {
        status: response.status,
        body: await response.json()
    };
}

test("Guest list returns exactly the four approved document fields", async (t) => {
    queryRows = [{
        reference_no: "PUBLIC-001",
        document_type: "Notice",
        receive_date: "2026-01-02",
        status: "Received",
        id: 101,
        subject: "private subject",
        sender_contact: "private contact",
        owner_id: 17,
        file_key: "private/key",
        owner_username: "private-user",
        nested: { private: true }
    }];

    const { status, body } = await getDocuments(t);

    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.data[0]).sort(), [
        "document_type",
        "receive_date",
        "reference_no",
        "status"
    ]);
    assert.deepEqual(body.data, [{
        reference_no: "PUBLIC-001",
        document_type: "Notice",
        receive_date: "2026-01-02",
        status: "Received"
    }]);
    assert.equal(body.total, 1);
});

test("Guest SQL selects only approved columns without joins or d.*", async (t) => {
    queryRows = [];

    await getDocuments(t);

    const { sql } = observedQueries[0];
    assert.match(sql, /SELECT\s+reference_no,\s*document_type,\s*receive_date,\s*status\s+FROM documents/i);
    assert.doesNotMatch(sql, /\bd\s*\.\s*\*/i);
    assert.doesNotMatch(sql, /\bJOIN\b/i);
    assert.doesNotMatch(sql, /\b(id|owner_id|assignee_id|file_key|subject|sender_name)\b/i);
});

test("Guest filters ignore fields outside the public registry", async (t) => {
    queryRows = [];

    await getDocuments(t, {
        query: "?subject=private&sender_name=private&receiver_name=private&search=private&reference_no=PUBLIC&document_type=Notice&status=Received&from_date=2026-01-01"
    });

    const { sql, params } = observedQueries[0];
    assert.doesNotMatch(sql, /\b(subject|sender_name|receiver_name|search)\b/i);
    assert.deepEqual(params, ["%PUBLIC%", "Notice", "Received", "2026-01-01"]);
});

test("faculty_staff list SQL remains scoped to owned or assigned documents", async (t) => {
    currentRole = "faculty_staff";
    queryRows = [{
        id: 17,
        reference_no: "STAFF-001",
        document_type: "Notice",
        receive_date: "2026-01-02",
        status: "Received",
        file_key: "private/key",
        file_name: "staff.pdf",
        file_size: 10,
        mime_type: "application/pdf"
    }];

    const { status, body } = await getDocuments(t, {
        authorization: `Bearer ${validTestToken}`
    });

    assert.equal(status, 200);
    assert.match(observedQueries[0].sql, /AND \(d\.owner_id = \? OR d\.assignee_id = \?\)/);
    assert.deepEqual(observedQueries[0].params.slice(0, 2), [17, 17]);
    assert.equal(body.data[0].id, 17);
    assert.equal(body.data[0].file_name, "staff.pdf");
});

test("admin, executive, and document_officer retain system-wide list access", async (t) => {
    for (const role of ["admin", "executive", "document_officer"]) {
        currentRole = role;
        queryRows = [{ id: 22, reference_no: `${role}-001`, file_key: "existing/key" }];

        const { status, body } = await getDocuments(t, {
            authorization: `Bearer ${validTestToken}`
        });

        assert.equal(status, 200, `${role} should retain list access`);
        assert.doesNotMatch(observedQueries[0].sql, /d\.owner_id = \? OR d\.assignee_id = \?/);
        assert.equal(body.data[0].id, 22);
        assert.equal(body.data[0].file_key, "existing/key");
    }
});

test("invalid non-Guest authorization is rejected and does not query documents", async (t) => {
    queryRows = [{ reference_no: "SHOULD-NOT-RETURN" }];

    const { status, body } = await getDocuments(t, {
        authorization: "Bearer invalid-test-token"
    });

    assert.equal(status, 401);
    assert.deepEqual(body, { error: "Unauthorized" });
    assert.deepEqual(observedQueries, []);
});

test("download-file rejects unauthenticated requests before querying the database", async (t) => {
    queryRows = [];

    const { status, body } = await getDownload(t);

    assert.equal(status, 401);
    assert.deepEqual(JSON.parse(body.toString()), { error: "Unauthorized" });
    assert.deepEqual(observedQueries, []);
    assert.deepEqual(observedS3Keys, []);
});

test("download-file denies unrelated faculty_staff documents without reading S3", async (t) => {
    currentRole = "faculty_staff";
    queryRows = [{
        owner_id: 99,
        assignee_id: 88,
        file_key: "documents/44/private.pdf",
        file_metadata_id: 4,
        file_name: "private.pdf",
        file_size: 10,
        mime_type: "application/pdf"
    }];

    const { status, body } = await getDownload(t, {
        authorization: `Bearer ${validTestToken}`
    });

    assert.equal(status, 403);
    assert.deepEqual(JSON.parse(body.toString()), { error: "Forbidden" });
    assert.deepEqual(observedS3Keys, []);
});

test("download-file streams authorized S3 content with safe headers and minimal SQL projection", async (t) => {
    currentRole = "faculty_staff";
    queryRows = [{
        owner_id: 17,
        assignee_id: null,
        file_key: "documents/44/report.pdf",
        file_metadata_id: 4,
        file_name: "report\".pdf",
        file_size: 13,
        mime_type: "application/pdf",
        subject: "must not be selected"
    }];
    s3ObjectFactory = async () => ({
        Body: Readable.from([Buffer.from("test file data")]),
        ContentLength: 14
    });

    const { status, headers, body } = await getDownload(t, {
        authorization: `Bearer ${validTestToken}`
    });

    assert.equal(status, 200);
    assert.equal(body.toString(), "test file data");
    assert.equal(headers.get("content-type"), "application/pdf");
    assert.equal(headers.get("content-length"), "14");
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.match(headers.get("content-disposition"), /filename="report_.pdf"/);
    assert.deepEqual(observedS3Keys, ["documents/44/report.pdf"]);
    assert.match(observedQueries[0].sql, /d\.owner_id,\s*d\.assignee_id,\s*d\.file_key/);
    assert.match(observedQueries[0].sql, /f\.id AS file_metadata_id,\s*f\.file_name,\s*f\.file_size,\s*f\.mime_type/);
    assert.doesNotMatch(observedQueries[0].sql, /d\.\*/i);
    assert.doesNotMatch(observedQueries[0].sql, /subject/i);
});

test("download-file returns 404 when file metadata is absent", async (t) => {
    currentRole = "admin";
    queryRows = [{
        owner_id: 99,
        assignee_id: 88,
        file_key: "documents/44/report.pdf",
        file_metadata_id: null
    }];

    const { status, body } = await getDownload(t, {
        authorization: `Bearer ${validTestToken}`
    });

    assert.equal(status, 404);
    assert.deepEqual(JSON.parse(body.toString()), { error: "Document or file not found" });
    assert.deepEqual(observedS3Keys, []);
});

test("download-file maps missing S3 objects to a safe 404 response", async (t) => {
    currentRole = "admin";
    queryRows = [{
        owner_id: 99,
        assignee_id: 88,
        file_key: "documents/44/missing.pdf",
        file_metadata_id: 4,
        file_name: "missing.pdf",
        file_size: 10,
        mime_type: "application/pdf"
    }];
    s3ObjectFactory = async () => {
        const error = new Error("internal S3 details");
        error.name = "NoSuchKey";
        throw error;
    };

    const { status, body } = await getDownload(t, {
        authorization: `Bearer ${validTestToken}`
    });

    assert.equal(status, 404);
    assert.deepEqual(JSON.parse(body.toString()), { error: "Document or file not found" });
    assert.doesNotMatch(body.toString(), /internal S3 details/);
});

test("download-file handles S3 stream errors without exposing internal details", async (t) => {
    currentRole = "admin";
    queryRows = [{
        owner_id: 99,
        assignee_id: 88,
        file_key: "documents/44/error.pdf",
        file_metadata_id: 4,
        file_name: "error.pdf",
        file_size: 10,
        mime_type: "application/pdf"
    }];
    s3ObjectFactory = async () => {
        const body = new PassThrough();
        process.nextTick(() => {
            const error = new Error("internal stream details");
            error.name = "StreamError";
            body.destroy(error);
        });
        return { Body: body, ContentLength: 10 };
    };

    const { status, headers, body } = await getDownload(t, {
        authorization: `Bearer ${validTestToken}`
    });

    assert.equal(status, 500);
    assert.deepEqual(JSON.parse(body.toString()), { error: "Failed to download document" });
    assert.equal(headers.get("content-disposition"), null);
    assert.doesNotMatch(body.toString(), /internal stream details/);
});
