const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");

const documents = [
    { id: 101, reference_no: "DOC-101", subject: "Owned", status: "Received", owner_id: 7, assignee_id: null, file_key: "documents/101/file.pdf", file_name: "file.pdf", file_size: 4, mime_type: "application/pdf" },
    { id: 102, reference_no: "DOC-102", subject: "Admin owned", status: "Received", owner_id: 8, assignee_id: null, file_key: "documents/102/file.pdf", file_name: "file.pdf", file_size: 4, mime_type: "application/pdf" },
    { id: 103, reference_no: "DOC-103", subject: "Officer owned", status: "Received", owner_id: 6, assignee_id: null, file_key: "documents/103/file.pdf", file_name: "file.pdf", file_size: 4, mime_type: "application/pdf" },
    { id: 104, reference_no: "DOC-104", subject: "Executive owned", status: "Received", owner_id: 10, assignee_id: null, file_key: "documents/104/file.pdf", file_name: "file.pdf", file_size: 4, mime_type: "application/pdf" },
    { id: 105, reference_no: "DOC-105", subject: "Case owner owned", status: "Received", owner_id: 9, assignee_id: null, file_key: "documents/105/file.pdf", file_name: "file.pdf", file_size: 4, mime_type: "application/pdf" }
];
const effects = { updates: 0, s3: 0, historyReads: 0 };
const identities = {
    "admin@example.test": { role: "admin", userId: 8 },
    "officer@example.test": { role: "document_officer", userId: 6 },
    "faculty@example.test": { role: "faculty_staff", userId: 7 },
    "case-owner@example.test": { role: "case_owner", userId: 9 },
    "executive@example.test": { role: "executive", userId: 10 }
};
const pool = {
    async execute(_sql, [username]) {
        const { role, userId } = identities[username] || identities["faculty@example.test"];
        return [[{ userId, username, role }]];
    },
    async query(sql, params = []) {
        if (/FROM documents d/i.test(sql) && /WHERE 1 = 1/i.test(sql)) {
            const [ownerId, assigneeId] = params;
            const scoped = /d\.owner_id\s*=\s*\?/i.test(sql) && /d\.assignee_id\s*=\s*\?/i.test(sql);
            return [[...documents.filter((doc) => scoped && (String(doc.owner_id) === String(ownerId) || String(doc.assignee_id) === String(assigneeId)))]];
        }
        if (/FROM documents d/i.test(sql) && /WHERE d\.id = \?/i.test(sql)) return [documents.filter((doc) => String(doc.id) === String(params[0]))];
        if (/SELECT \* FROM documents WHERE id/i.test(sql)) return [documents.filter((doc) => String(doc.id) === String(params[0]))];
        if (/document_status_logs/i.test(sql)) { effects.historyReads++; return [[]]; }
        if (/UPDATE documents|INSERT INTO document_files|UPDATE document_files/i.test(sql)) { effects.updates++; return [{ affectedRows: 1 }]; }
        return [[]];
    }
};
const audit = {
    AUDIT_EVENTS: { STATUS_CHANGE: "STATUS_CHANGE", DOCUMENT_CREATE: "DOCUMENT_CREATE", ASSIGN: "ASSIGN", FORWARD: "FORWARD" },
    AUDIT_EVENT_METADATA: {}, sanitizeAuditData: (value) => value,
    extractServerActor: (req) => ({ actorUserId: String(req.userId || "7"), actorUsername: req.dbUsername || "test", actorRole: req.userRole || "faculty_staff", ipAddress: "127.0.0.1" }),
    recordAuditEvent: async () => ({}), getAuditTrailByDocumentId: async () => [], queryAuditTrails: async () => ({}),
    verifyAuditTrailAccess: () => ({ allowed: true })
};
const cognito = (req, res, next) => {
    const token = req.headers.authorization;
    if (token === "Bearer invalid") return res.status(401).json({ error: "Unauthorized" });
    if (!token || !token.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const name = token.slice(7);
    const username = ({ admin: "admin@example.test", officer: "officer@example.test", faculty: "faculty@example.test", "case-owner": "case-owner@example.test", executive: "executive@example.test", "group-admin-faculty": "faculty@example.test" })[name] || "faculty@example.test";
    req.auth = { sub: `sub-${name}`, username, groups: name === "group-admin-faculty" ? ["admin"] : [] };
    next();
};
const s3 = {
    createUploadUrl: async () => { effects.s3++; return "https://example.test/upload"; },
    createDownloadUrl: async () => { effects.s3++; return "https://example.test/download"; },
    getS3Object: async () => { effects.s3++; return { Body: { transformToByteArray: async () => new Uint8Array([1]) } }; },
    getObjectMetadata: async () => { effects.s3++; return { ContentLength: 4, ContentType: "application/pdf" }; },
    getMimeTypeByExtension: (filename) => filename && filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
    getObjectBuffer: async () => { effects.s3++; return { buffer: Buffer.from("file"), contentType: "application/pdf" }; },
    uploadObjectBuffer: async () => { effects.s3++; }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename?.endsWith("backend\\server.js") || parent?.filename?.endsWith("backend/server.js")) {
        if (request === "./db") return pool;
        if (request === "./cognito-auth") return { requireCognitoAuth: cognito };
        if (request === "./session") return (_req, _res, next) => next();
        if (request === "./auth") return express.Router();
        if (request === "./s3") return s3;
        if (request === "./auditTrail") return audit;
    }
    return originalLoad.call(this, request, parent, isMain);
};
const app = require("../server");
Module._load = originalLoad;

async function request(path, token, init = {}) {
    const parsed = new URL(path, "http://local.test");
    const routeLayer = app.router.stack.find((layer) => {
        const paths = Array.isArray(layer.route?.path) ? layer.route.path : [layer.route?.path];
        return paths.some((routePath) => typeof routePath === "string" && new RegExp(`^${routePath.replace(/:[^/]+/g, "[^/]+")}$`).test(parsed.pathname)) && layer.route.methods[(init.method || "GET").toLowerCase()];
    });
    assert.ok(routeLayer, `route not found: ${init.method || "GET"} ${parsed.pathname}`);
    const route = routeLayer.route;
    const req = {
        method: (init.method || "GET").toUpperCase(), path: parsed.pathname, originalUrl: path, url: path,
        params: {}, query: Object.fromEntries(parsed.searchParams), body: init.body ? (init.headers?.["Content-Type"] === "application/json" ? JSON.parse(init.body) : Buffer.from(init.body)) : {},
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
        socket: { remoteAddress: "127.0.0.1" }, get(name) { return this.headers[name.toLowerCase()]; }
    };
    const segments = parsed.pathname.split("/");
    if (route.path.includes(":id")) req.params.id = segments[3];
    const res = {
        statusCode: 200, headers: {}, body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; this.finished = true; return this; },
        send(body) { this.body = body; this.finished = true; return this; },
        setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; this.finished = true; }
    };
    const stack = route.stack.map((item) => item.handle).filter((fn) => fn.name !== "rawParser");
    async function run(index) {
        if (index >= stack.length || res.finished) return;
        let nextPromise;
        await stack[index](req, res, (error) => { if (error) throw error; nextPromise = run(index + 1); });
        if (nextPromise) await nextPromise;
    }
    await run(0);
    return { status: res.statusCode, json: async () => res.body, body: res.body };
}

test("missing and invalid bearer tokens are rejected", async () => {
    assert.equal((await request("/api/documents/101")).status, 401);
    assert.equal((await request("/api/documents/101", "invalid")).status, 401);
});

test("document lists are scoped to each authenticated role's own related documents", async () => {
    const expected = { officer: [103], faculty: [101], "case-owner": [105], admin: [102], executive: [104] };
    const visible = {};
    for (const [token, ids] of Object.entries(expected)) {
        const response = await request("/api/documents", token);
        assert.equal(response.status, 200, `${token}: ${JSON.stringify(response.body)}`);
        visible[token] = (await response.json()).data.map((doc) => doc.id);
        assert.deepEqual(visible[token], ids);
    }
    assert.equal(new Set(Object.values(visible).map((ids) => ids.join(","))).size, Object.keys(expected).length);
});

test("authorized related reads succeed while unrelated and conflicting group reads fail", async () => {
    const own = await request("/api/documents/103", "officer");
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal((await request("/api/documents/102", "faculty")).status, 403);
    assert.equal((await request("/api/documents/102", "group-admin-faculty")).status, 403);
    assert.equal((await request("/api/documents/102", "admin")).status, 200);
});

test("unauthorized history and status changes do not read history or mutate data", async () => {
    const historyBefore = effects.historyReads;
    const writesBefore = effects.updates;
    assert.equal((await request("/api/documents/102/status-history", "faculty")).status, 403);
    assert.equal(effects.historyReads, historyBefore);
    assert.equal((await request("/api/documents/102/status", "faculty", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Assigned" }) })).status, 403);
    assert.equal(effects.updates, writesBefore);
});

test("unauthorized upload, metadata, preview, and download stop before storage", async () => {
    const storageBefore = effects.s3;
    assert.equal((await request("/api/documents/102/upload-url?fileName=a.pdf&fileSize=4", "faculty")).status, 403);
    assert.equal((await request("/api/documents/102/upload-direct?fileName=a.pdf", "faculty", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: "data" })).status, 403);
    assert.equal((await request("/api/documents/102/file-metadata", "faculty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: "a.pdf", fileSize: 4, fileKey: "documents/102/a.pdf" }) })).status, 403);
    const preview = await request("/api/documents/102/preview-url", "faculty");
    assert.ok([403, 404].includes(preview.status), JSON.stringify(preview.body));
    const download = await request("/api/documents/102/download-url", "faculty");
    assert.ok([403, 404].includes(download.status));
    assert.equal(effects.s3, storageBefore);
});

test("authorized upload URL uses the frontend contract and a backend generated document key", async () => {
    const response = await request("/api/documents/103/upload-url?fileName=a.pdf&contentType=application%2Fpdf&fileSize=4", "officer");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.upload_url, "https://example.test/upload");
    assert.match(payload.file_key, /^documents\/103\//);
});

test("tampered metadata keys are rejected before S3 or database writes", async () => {
    const storageBefore = effects.s3;
    const writesBefore = effects.updates;
    const result = await request("/api/documents/103/file-metadata", "officer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "file.pdf", fileSize: 4, mimeType: "application/pdf", fileKey: "documents/102/stolen.pdf" })
    });
    assert.equal(result.status, 400);
    assert.equal(effects.s3, storageBefore);
    assert.equal(effects.updates, writesBefore);
});
