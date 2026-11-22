// ทดสอบ Share Link (ADR #72 / แทน Guest ของ #57)
// ไม่ใช้ DB จริง: จำลอง pool.query / pool.getConnection ด้วยตารางในหน่วยความจำ
process.env.SESSION_SECRET ||= "test-only-session-secret";
process.env.SHARE_LINK_RATE_LIMIT_MAX = "10";
process.env.SHARE_LINK_RATE_LIMIT_WINDOW_MS = "60000";

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");

const pool = require("../db");
const s3 = require("../s3");
const { installCognitoTestVerifier } = require("./cognitoTestFixtures");
const { tokenFor: cognitoTokenFor } = installCognitoTestVerifier();
const {
    createRateLimiter, hashToken, isWellFormedToken, parseExpiresInHours, clientIp
} = require("../shareLinks");
const { canAccessDocument } = require("../documentAuthorization");

// ---------- ข้อมูลจำลอง ----------
const USERS = {
    officer: { id: 1, role: "document_officer" },
    admin: { id: 2, role: "admin" },
    staff: { id: 3, role: "faculty_staff" },       // current assignee ของเอกสาร 10
    otherStaff: { id: 4, role: "faculty_staff" },  // ไม่เกี่ยวข้อง
    executive: { id: 5, role: "executive" },
    previous: { id: 6, role: "responsible_person" } // previous assignee ของเอกสาร 10
};

let db;
function resetDb() {
    db = {
        documents: [
            { id: 10, reference_no: "REF-10", document_number: "N-10", subject: "เอกสารสิบ", document_type: "ขออนุมัติ",
              receive_date: "2026-11-01", status: "Assigned", assignee_id: 3, owner_id: 1, file_key: "docs/10/abc-ten.pdf",
              sender_contact: "secret contact" },
            { id: 20, reference_no: "REF-20", document_number: "N-20", subject: "เอกสารยี่สิบ", document_type: "แจ้งเพื่อทราบ",
              receive_date: "2026-11-02", status: "Received", assignee_id: null, owner_id: 1, file_key: null }
        ],
        files: [{ id: 1, document_id: 10, file_name: "ten.pdf", file_size: 1234, mime_type: "application/pdf" }],
        previousAssignees: [{ document_id: 10, user_id: 6 }],
        links: [],
        audits: [],
        statements: []
    };
}
resetDb();

const now = () => new Date();
const userBySub = sub => Object.entries(USERS).find(([name]) => sub === `sub-${name}`)?.[1];

function handle(sql, params = [], state) {
    db.statements.push({ sql, params });
    const s = sql.replace(/\s+/g, " ");

    if (/FROM users WHERE cognito_sub = \?/.test(s)) {
        const user = userBySub(params[0]);
        state.user = user;
        return [user ? [{ id: user.id, username: params[0], full_name: params[0], cognito_sub: params[0], role: user.role }] : []];
    }
    if (/FROM users_roles ur JOIN roles r/.test(s)) return [state.user ? [{ id: 1, name: state.user.role }] : []];
    if (/AS previous_assignee FROM documents d/.test(s)) {
        const [userId, docId] = params;
        return [[{ previous_assignee: db.previousAssignees.some(p => String(p.user_id) === String(userId) && p.document_id === Number(docId)) ? 1 : 0 }]];
    }
    if (/FROM document_assignments WHERE document_id = \? AND assigned_by_user_id = \?/.test(s)) return [[]];
    if (/^ ?SELECT id, assignee_id, owner_id, status FROM documents WHERE id = \?/.test(s)) {
        return [db.documents.filter(d => d.id === Number(params[0])).map(({ id, assignee_id, owner_id, status }) => ({ id, assignee_id, owner_id, status }))];
    }
    if (/^ ?INSERT INTO document_share_links/.test(s)) {
        const [document_id, token_hash, created_by, hours] = params;
        const createdAt = now();
        const row = { id: db.links.length + 1, document_id, token_hash, created_by, created_at: createdAt,
            expires_at: new Date(createdAt.getTime() + hours * 3600_000), revoked_at: null, last_used_at: null };
        db.links.push(row);
        return [{ insertId: row.id, affectedRows: 1 }];
    }
    if (/FROM document_share_links WHERE id = \?/.test(s)) {
        const row = db.links.find(l => l.id === Number(params[0]));
        return [row ? [{ ...row, token_hash: undefined }] : []];
    }
    if (/FROM document_share_links s LEFT JOIN users u/.test(s)) {
        return [db.links.filter(l => l.document_id === Number(params[0])).map(l => ({ ...l, token_hash: undefined, created_by_name: `user-${l.created_by}` }))];
    }
    if (/^ ?UPDATE document_share_links SET revoked_at/.test(s)) {
        const row = db.links.find(l => l.id === Number(params[0]) && !l.revoked_at);
        if (row) row.revoked_at = now();
        return [{ affectedRows: row ? 1 : 0 }];
    }
    if (/^ ?UPDATE document_share_links SET last_used_at/.test(s)) {
        db.links.find(l => l.id === Number(params[0])).last_used_at = now();
        return [{ affectedRows: 1 }];
    }
    if (/FROM document_share_links s JOIN documents d/.test(s)) {
        const link = db.links.find(l => l.token_hash === params[0] && !l.revoked_at && l.expires_at > now());
        if (!link) return [[]];
        const d = db.documents.find(doc => doc.id === link.document_id);
        const f = db.files.find(file => file.document_id === d.id) || {};
        return [[{ share_link_id: link.id, expires_at: link.expires_at, document_id: d.id, reference_no: d.reference_no,
            document_number: d.document_number, subject: d.subject, document_type: d.document_type,
            receive_date: d.receive_date, file_key: d.file_key, file_name: f.file_name ?? null,
            file_size: f.file_size ?? null, mime_type: f.mime_type ?? null }]];
    }
    if (/^ ?INSERT INTO document_audit_trails/.test(s)) {
        const [document_id, actor_user_id, actor_username, actor_role, event_type, before_state, after_state, details, ip_address] = params;
        db.audits.push({ document_id, actor_user_id, actor_username, actor_role, event_type, before_state, after_state, details, ip_address });
        return [{ insertId: db.audits.length }];
    }
    // #77 สถานะ Inbox ของผู้ดูใน GET /api/documents/:id (ไม่เกี่ยวกับ share link: ไม่มีดาว/ไม่มีแถวมอบหมาย)
    if (/^ ?SELECT 1 AS pinned FROM document_pins WHERE user_id = \?/.test(s)) return [[]];
    if (/SELECT id, seen_at FROM document_assignments/.test(s)) return [[]];
    throw new Error(`Unexpected SQL in share link test: ${s}`);
}

function fakeConnection() {
    const state = {};
    const run = async (sql, params) => handle(sql, params, state);
    return { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: run, execute: run };
}

pool.getConnection = async () => fakeConnection();
pool.query = async (sql, params) => handle(sql, params, {});

const presignCalls = [];
s3.createDownloadUrl = async (key, options) => {
    presignCalls.push({ key, options });
    return `https://bucket.s3.test/${key}?X-Amz-Expires=${options.expiresIn}&disposition=${options.disposition}`;
};

const app = require("../server");

let server;
let baseUrl;
let ipCounter = 0;

before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => { resetDb(); presignCalls.length = 0; });

const bearer = name => `Bearer ${cognitoTokenFor({ sub: `sub-${name}`, username: `sub-${name}`, "cognito:groups": [USERS[name].role] })}`;

// แต่ละ test ใช้ IP ของตัวเอง เพื่อไม่ให้ rate limit ของ test อื่นมารบกวน
async function call(method, path, { as, body, ip, headers = {} } = {}) {
    const finalHeaders = { "X-Forwarded-For": ip || `198.51.100.${++ipCounter % 250}`, ...headers };
    if (as) finalHeaders.Authorization = bearer(as);
    if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, { method, headers: finalHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, body: json, headers: response.headers };
}

async function createLink(docId = 10, as = "officer", body) {
    const res = await call("POST", `/api/documents/${docId}/share-links`, { as, body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
}

// =====================================================================
describe("Acceptance: ไม่ Login แล้วเรียก /api/documents ได้ 401", () => {
    for (const [method, path] of [
        ["GET", "/api/documents"], ["GET", "/api/documents/10"],
        ["POST", "/api/documents/10/share-links"], ["GET", "/api/documents/10/share-links"], ["DELETE", "/api/share-links/1"]
    ]) {
        test(`${method} ${path} ไม่มี token → 401`, async () => {
            const res = await call(method, path);
            assert.equal(res.status, 401);
        });
    }

    test("POST /api/auth/guest ไม่มีแล้ว (404)", async () => {
        const res = await call("POST", "/api/auth/guest", { body: {} });
        assert.equal(res.status, 404);
    });
});

// =====================================================================
describe("POST /api/documents/:id/share-links", () => {
    test("สร้างลิงก์: คืน token ครั้งเดียว, DB เก็บแค่ hash, บันทึก SHARE_LINK_CREATE", async () => {
        const link = await createLink(10, "officer");
        assert.ok(isWellFormedToken(link.token));
        assert.equal(link.status, "active");
        assert.equal(link.document_id, 10);
        assert.equal(link.token_hash, undefined);

        const stored = db.links[0];
        assert.equal(stored.token_hash, crypto.createHash("sha256").update(link.token).digest("hex"));
        assert.equal(stored.token_hash.length, 64);
        assert.equal(stored.created_by, USERS.officer.id);

        // token ดิบไม่ถูกส่งเข้า DB ในคำสั่งใดเลย (รวม audit)
        assert.ok(!JSON.stringify(db.statements).includes(link.token), "raw token must never reach the database");
        assert.ok(!JSON.stringify(db.audits).includes(stored.token_hash), "token hash must not be written to audit");

        assert.equal(db.audits.length, 1);
        assert.equal(db.audits[0].event_type, "SHARE_LINK_CREATE");
        assert.equal(db.audits[0].actor_user_id, String(USERS.officer.id));
    });

    test("ค่าเริ่มต้นหมดอายุ 72 ชม. และกำหนด expires_in_hours ได้", async () => {
        await createLink(10, "officer");
        await createLink(10, "officer", { expires_in_hours: 1 });
        assert.equal(db.statements.filter(x => /INSERT INTO document_share_links/.test(x.sql)).map(x => x.params[3]).join(","), "72,1");
    });

    for (const value of [0, -1, 1.5, 721, "abc", true]) {
        test(`expires_in_hours=${JSON.stringify(value)} → 400`, async () => {
            const res = await call("POST", "/api/documents/10/share-links", { as: "officer", body: { expires_in_hours: value } });
            assert.equal(res.status, 400);
            assert.equal(db.links.length, 0);
        });
    }

    test("admin และ current assignee สร้างได้", async () => {
        await createLink(10, "admin");
        await createLink(10, "staff");
        assert.equal(db.links.length, 2);
    });

    for (const who of ["otherStaff", "executive", "previous"]) {
        test(`${who} สร้างลิงก์ไม่ได้ (403) และไม่มีแถวใน DB`, async () => {
            const res = await call("POST", "/api/documents/10/share-links", { as: who });
            assert.equal(res.status, 403);
            assert.equal(db.links.length, 0);
            assert.equal(db.audits.length, 0);
        });
    }

    test("เอกสารไม่มีจริง → 404, id ไม่ถูกต้อง → 400", async () => {
        assert.equal((await call("POST", "/api/documents/999/share-links", { as: "officer" })).status, 404);
        assert.equal((await call("POST", "/api/documents/abc/share-links", { as: "officer" })).status, 400);
    });
});

// =====================================================================
describe("GET /api/documents/:id/share-links", () => {
    test("แสดงรายการโดยไม่มี token / token_hash", async () => {
        const link = await createLink(10, "officer");
        const res = await call("GET", "/api/documents/10/share-links", { as: "staff" });
        assert.equal(res.status, 200);
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].id, link.id);
        assert.equal(res.body[0].token, undefined);
        assert.equal(res.body[0].token_hash, undefined);
        assert.equal(res.headers.get("cache-control"), "no-store");
    });

    test("ผู้ไม่มีสิทธิ์แชร์ดูรายการไม่ได้ (403)", async () => {
        await createLink(10, "officer");
        assert.equal((await call("GET", "/api/documents/10/share-links", { as: "otherStaff" })).status, 403);
        assert.equal((await call("GET", "/api/documents/10/share-links", { as: "executive" })).status, 403);
    });
});

// =====================================================================
describe("DELETE /api/share-links/:id", () => {
    test("ยกเลิกแล้วเปิดไม่ได้, บันทึก SHARE_LINK_REVOKE ครั้งเดียวแม้เรียกซ้ำ", async () => {
        const link = await createLink(10, "officer");
        const first = await call("DELETE", `/api/share-links/${link.id}`, { as: "staff" });
        assert.equal(first.status, 200);
        assert.equal(first.body.status, "revoked");
        const second = await call("DELETE", `/api/share-links/${link.id}`, { as: "staff" });
        assert.equal(second.status, 200);
        assert.deepEqual(db.audits.map(a => a.event_type), ["SHARE_LINK_CREATE", "SHARE_LINK_REVOKE"]);

        const open = await call("GET", `/api/shared/${link.token}`);
        assert.equal(open.status, 404);
    });

    test("ผู้ไม่มีสิทธิ์ยกเลิกไม่ได้ (403), ลิงก์ไม่มีจริง (404)", async () => {
        const link = await createLink(10, "officer");
        assert.equal((await call("DELETE", `/api/share-links/${link.id}`, { as: "otherStaff" })).status, 403);
        assert.equal(db.links[0].revoked_at, null);
        assert.equal((await call("DELETE", "/api/share-links/999", { as: "officer" })).status, 404);
    });
});

// =====================================================================
describe("GET /api/shared/:token", () => {
    test("เปิดได้โดยไม่ login: ข้อมูลอ่านอย่างเดียว + Pre-signed URL อายุสั้น + SHARE_LINK_OPEN", async () => {
        const link = await createLink(10, "officer");
        const res = await call("GET", `/api/shared/${link.token}`, { ip: "203.0.113.9" });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("cache-control"), "no-store");
        assert.equal(res.headers.get("referrer-policy"), "no-referrer");

        assert.deepEqual(Object.keys(res.body.document).sort(), [
            "can_preview", "document_number", "document_type", "file_name", "file_size", "mime_type", "receive_date", "reference_no", "subject"
        ]);
        assert.equal(res.body.document.reference_no, "REF-10");
        assert.equal(res.body.document.file_name, "ten.pdf");
        const serialized = JSON.stringify(res.body);
        for (const secret of ["file_key", "docs/10/abc-ten.pdf\"", "assignee", "secret contact", "token_hash", "status\""]) {
            assert.ok(!serialized.includes(secret), `response must not expose ${secret}`);
        }

        assert.match(res.body.preview_url, /^https:\/\/.*disposition=inline/);
        assert.match(res.body.download_url, /^https:\/\/.*disposition=attachment/);
        assert.equal(res.body.url_expires_in, 120);
        assert.ok(presignCalls.every(c => c.options.expiresIn === 120));

        const openAudit = db.audits.find(a => a.event_type === "SHARE_LINK_OPEN");
        assert.ok(openAudit);
        assert.equal(openAudit.document_id, 10);
        assert.equal(openAudit.actor_user_id, `share_link:${link.id}`);
        assert.equal(openAudit.ip_address, "203.0.113.9");
        assert.ok(db.links[0].last_used_at);
    });

    test("เอกสารที่ไม่มีไฟล์: ไม่มี URL", async () => {
        const link = await createLink(20, "officer");
        const res = await call("GET", `/api/shared/${link.token}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.preview_url, null);
        assert.equal(res.body.download_url, null);
    });

    test("token ใช้ได้กับเอกสารของตัวเองเท่านั้น", async () => {
        const a = await createLink(10, "officer");
        const b = await createLink(20, "officer");
        assert.equal((await call("GET", `/api/shared/${a.token}`)).body.document.reference_no, "REF-10");
        assert.equal((await call("GET", `/api/shared/${b.token}`)).body.document.reference_no, "REF-20");
        // ไม่มีพารามิเตอร์ให้เลือกเอกสารอื่น
        assert.equal((await call("GET", `/api/shared/${a.token}?id=20&document_id=20`)).body.document.reference_no, "REF-10");
        assert.equal((await call("GET", `/api/shared/${a.token}/20`)).status, 404);
    });

    test("ปฏิเสธ ไม่ถูกต้อง / หมดอายุ / ถูกยกเลิก ด้วยคำตอบเดียวกันทุกกรณี", async () => {
        const expired = await createLink(10, "officer");
        db.links[0].expires_at = new Date(Date.now() - 1000);
        const revoked = await createLink(10, "officer");
        db.links[1].revoked_at = new Date();
        const auditsBefore = db.audits.length;

        const cases = {
            unknown: crypto.randomBytes(32).toString("base64url"),
            malformed: "not-a-token",
            tooLong: "A".repeat(200),
            expired: expired.token,
            revoked: revoked.token
        };
        const responses = {};
        for (const [name, token] of Object.entries(cases)) {
            responses[name] = await call("GET", `/api/shared/${encodeURIComponent(token)}`);
        }
        for (const [name, res] of Object.entries(responses)) {
            assert.equal(res.status, 404, name);
            assert.deepEqual(res.body, { error: "Share link is not available", code: "SHARE_LINK_UNAVAILABLE" }, name);
        }
        assert.equal(db.audits.length, auditsBefore, "rejected tokens are not logged as SHARE_LINK_OPEN");
        assert.equal(presignCalls.length, 0);
    });

    test("token ทำ Workflow action ไม่ได้ (ใช้เป็น Bearer ก็ไม่ได้)", async () => {
        const link = await createLink(10, "officer");
        const headers = { Authorization: `Bearer ${link.token}` };
        const attempts = [
            ["PUT", "/api/documents/10/status", { status: "Completed" }],
            ["POST", "/api/documents/10/assign", { assignee_id: 4 }],
            ["POST", "/api/documents/10/forward", { assignee_id: 4 }],
            ["PATCH", "/api/documents/10/deadline", { deadline: "2026-12-31" }],
            ["DELETE", "/api/documents/10", undefined],
            ["GET", "/api/documents/10", undefined],
            ["GET", "/api/documents", undefined],
            ["POST", "/api/documents/10/share-links", undefined]
        ];
        for (const [method, path, body] of attempts) {
            const res = await call(method, path, { headers, body });
            assert.equal(res.status, 401, `${method} ${path}`);
        }
        // เขียนผ่าน path ของ shared ก็ไม่ได้
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
            assert.equal((await call(method, `/api/shared/${link.token}`, { body: { status: "Completed" } })).status, 404, method);
        }
        assert.equal(db.documents[0].status, "Assigned");
        assert.equal(db.links[0].revoked_at, null);
    });

    test("Rate limit /api/shared/* → 429 หลังเกินโควตาต่อ IP", async () => {
        const link = await createLink(10, "officer");
        const ip = "192.0.2.77";
        for (let i = 0; i < 10; i++) {
            assert.equal((await call("GET", `/api/shared/${link.token}`, { ip })).status, 200, `request ${i + 1}`);
        }
        const limited = await call("GET", `/api/shared/${link.token}`, { ip });
        assert.equal(limited.status, 429);
        assert.ok(Number(limited.headers.get("retry-after")) > 0);
        // token ผิดก็นับโควตา (กันการเดา token)
        assert.equal((await call("GET", "/api/shared/guess", { ip })).status, 429);
        // IP อื่นยังใช้ได้
        assert.equal((await call("GET", `/api/shared/${link.token}`, { ip: "192.0.2.78" })).status, 200);
    });
});

// =====================================================================
describe("document detail exposes permissions.share", () => {
    test("officer ได้ share=true, executive ได้ share=false", async () => {
        const originalQuery = pool.query;
        pool.query = async (sql, params) => /FROM documents d\s+LEFT JOIN document_files f/.test(sql) && /creator_username/.test(sql)
            ? [[{ ...db.documents[0], file_name: "ten.pdf" }]]
            : handle(sql, params, {});
        try {
            assert.equal((await call("GET", "/api/documents/10", { as: "officer" })).body.permissions.share, true);
            assert.equal((await call("GET", "/api/documents/10", { as: "executive" })).body.permissions.share, false);
            assert.equal((await call("GET", "/api/documents/10", { as: "previous" })).body.permissions.share, false);
        } finally {
            pool.query = originalQuery;
        }
    });
});

// =====================================================================
describe("unit helpers", () => {
    test("canAccessDocument share matrix", () => {
        const document = { id: 1, assignee_id: 3, status: "Assigned" };
        const can = (roles, userId, previousAssignee = false) => canAccessDocument({ roles, userId, document, action: "share", previousAssignee });
        assert.equal(can(["admin"], 99), true);
        assert.equal(can(["document_officer"], 99), true);
        assert.equal(can(["faculty_staff"], 3), true);
        assert.equal(can(["responsible_person"], 3), true);
        assert.equal(can(["faculty_staff"], 4), false);
        assert.equal(can(["responsible_person"], 6, true), false);
        assert.equal(can(["executive"], 3), false);
    });

    test("hashToken / isWellFormedToken / parseExpiresInHours", () => {
        assert.match(hashToken("abc"), /^[0-9a-f]{64}$/);
        assert.equal(isWellFormedToken(crypto.randomBytes(32).toString("base64url")), true);
        assert.equal(isWellFormedToken("abc"), false);
        assert.equal(isWellFormedToken(null), false);
        assert.equal(parseExpiresInHours(undefined), 72);
        assert.equal(parseExpiresInHours(720), 720);
        assert.equal(parseExpiresInHours(721), null);
    });

    test("clientIp ใช้ค่าขวาสุดของ X-Forwarded-For (ค่าที่ proxy ต่อท้าย)", () => {
        assert.equal(clientIp({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } }), "2.2.2.2");
        assert.equal(clientIp({ headers: {}, socket: { remoteAddress: "::1" } }), "::1");
    });

    test("rate limiter รีเซ็ตเมื่อครบ window และจำกัดจำนวน key", () => {
        let t = 0;
        const limiter = createRateLimiter({ windowMs: 1000, max: 2, maxKeys: 2, now: () => t });
        const run = ip => {
            let status = 200;
            const res = { setHeader() {}, status(code) { status = code; return { json() {} }; } };
            limiter({ headers: { "x-forwarded-for": ip } }, res, () => {});
            return status;
        };
        assert.equal(run("a"), 200);
        assert.equal(run("a"), 200);
        assert.equal(run("a"), 429);
        assert.equal(run("b"), 200);
        assert.equal(run("c"), 429, "map full → reject rather than grow");
        t = 1000;
        assert.equal(run("a"), 200, "window reset");
        assert.equal(run("c"), 200, "expired keys swept");
    });
});
