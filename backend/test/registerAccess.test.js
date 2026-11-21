// ทดสอบ: ลงทะเบียนเอกสารได้เฉพาะ Document Officer และทุก API เอกสารต้องเข้าสู่ระบบ (ไม่มีโหมด Guest)
// ไม่ต้องใช้ฐานข้อมูลจริง — mock pool.query / pool.getConnection เพื่อจำลองผู้ใช้แต่ละ Role
process.env.SESSION_SECRET ||= "test-only-session-secret";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const pool = require("../db");
const { signHs256Jwt } = require("../cognito-auth");
const { requireAction } = require("../documentAuthorization");

const ROLES = ["document_officer", "admin", "faculty_staff", "responsible_person", "executive"];

// จำลอง DB: ผู้ใช้หนึ่งคนต่อ Role (id = index + 1) และบันทึก SQL ที่ถูกเรียก
const executedSql = [];
function roleForSub(sub) {
    return ROLES.find(role => sub === `sub-${role}`);
}
function fakeConnection() {
    let currentRole = null;
    return {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        execute: async (sql, params = []) => {
            if (/FROM users\s+WHERE cognito_sub = \?/.test(sql)) {
                currentRole = roleForSub(params[0]);
                if (!currentRole) return [[]];
                return [[{ id: ROLES.indexOf(currentRole) + 1, username: `${currentRole}@test`, full_name: currentRole, cognito_sub: params[0], role: currentRole }]];
            }
            if (/FROM users_roles ur\s+JOIN roles r/.test(sql)) return [[{ id: 1, name: currentRole }]];
            return [[]];
        }
    };
}

const originalQuery = pool.query;
const originalGetConnection = pool.getConnection;
pool.getConnection = async () => fakeConnection();
pool.query = async (sql) => {
    executedSql.push(sql);
    throw new Error(`Unexpected query in register/auth test: ${sql}`);
};

const app = require("../server");

function tokenFor(role) {
    return signHs256Jwt({
        sub: `sub-${role}`,
        username: `${role}@test`,
        "cognito:groups": [role],
        exp: Math.floor(Date.now() / 1000) + 600
    });
}

function request(server, { method = "GET", path, token, body }) {
    return new Promise((resolve, reject) => {
        const payload = body && !["GET", "DELETE"].includes(method) ? JSON.stringify(body) : null;
        const headers = {};
        if (payload) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method, headers }, res => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch { /* non-JSON */ }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

describe("Register restriction & authentication required", () => {
    let server;
    before(() => { server = app.listen(0); });
    after(() => {
        server.close();
        pool.query = originalQuery;
        pool.getConnection = originalGetConnection;
    });

    test("requireAction('register') อนุญาตเฉพาะ document_officer", () => {
        for (const role of [...ROLES, "unknown_role"]) {
            let status = null;
            let passed = false;
            requireAction("register")(
                { userRoles: [role] },
                { status(code) { status = code; return this; }, json() { return this; } },
                () => { passed = true; }
            );
            assert.equal(passed, role === "document_officer", role);
            if (role !== "document_officer") assert.equal(status, 403, role);
        }
    });

    // body ตั้งใจให้ receiving_channel ไม่ถูกต้อง: ผ่านสิทธิ์แล้วจะได้ 400 โดยไม่เขียนฐานข้อมูล
    const invalidBody = { subject: "x", document_type: "x", sender_name: "x", receiving_channel: "INVALID" };

    for (const role of ROLES) {
        const expected = role === "document_officer" ? 400 : 403;
        test(`POST /api/documents ด้วย Role ${role} -> ${expected}`, async () => {
            const res = await request(server, { method: "POST", path: "/api/documents", token: tokenFor(role), body: invalidBody });
            assert.equal(res.status, expected, JSON.stringify(res.body));
            if (expected === 403) assert.equal(res.body.code, "FORBIDDEN");
        });
    }

    test("POST /api/documents ไม่มี Token -> 401", async () => {
        const res = await request(server, { method: "POST", path: "/api/documents", body: invalidBody });
        assert.equal(res.status, 401);
    });

    // ไม่มีโหมด Guest แล้ว: ทุก API เอกสารต้องมี token จริง
    const protectedPaths = [
        ["GET", "/api/documents"],
        ["GET", "/api/documents/1"],
        ["GET", "/api/documents/1/status-history"],
        ["GET", "/api/documents/1/assignments"],
        ["GET", "/api/documents/1/audit-trail"],
        ["GET", "/api/audit-trails"],
        ["GET", "/api/documents/1/preview-url"],
        ["GET", "/api/documents/1/download-url"],
        ["GET", "/api/documents/1/preview-file"],
        ["GET", "/api/documents/1/download-file"],
        ["GET", "/api/documents/1/view-file"],
        ["GET", "/api/documents/1/upload-url"],
        ["GET", "/api/assignees"],
        ["POST", "/api/documents/1/assign"],
        ["POST", "/api/documents/1/forward"],
        ["PUT", "/api/documents/1/status"],
        ["PATCH", "/api/documents/1/deadline"],
        ["DELETE", "/api/documents/1"]
    ];

    for (const [method, path] of protectedPaths) {
        test(`ไม่ได้เข้าสู่ระบบ / token "guest" ถูกปฏิเสธ: ${method} ${path}`, async () => {
            executedSql.length = 0;
            const anonymous = await request(server, { method, path, body: {} });
            assert.equal(anonymous.status, 401, JSON.stringify(anonymous.body));

            const legacyGuest = await request(server, { method, path, token: "guest", body: {} });
            assert.equal(legacyGuest.status, 401, JSON.stringify(legacyGuest.body));
            assert.equal(executedSql.length, 0, "no document data may be queried without authentication");
        });
    }

    test("POST /api/auth/guest ถูกลบแล้ว (404)", async () => {
        const res = await request(server, { method: "POST", path: "/api/auth/guest", body: {} });
        assert.equal(res.status, 404);
    });
});
