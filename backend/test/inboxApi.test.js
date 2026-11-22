// ทดสอบ #77 Inbox: seen_at / is_new, Priority, ปักดาว (docs/api-v7.md)
// ไม่ใช้ DB จริง: จำลอง pool.query / pool.getConnection ด้วยตารางในหน่วยความจำ
// ลำดับฝั่ง SQL (buildInboxOrderBy) เทียบกับ compareInboxPriority บน MySQL จริงใน migrationV7.test.js
process.env.SESSION_SECRET ||= "test-only-session-secret";

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const pool = require("../db");
const s3 = require("../s3");
const { installCognitoTestVerifier } = require("./cognitoTestFixtures");
const { tokenFor } = installCognitoTestVerifier();
const {
    compareInboxPriority, buildInboxOrderBy, parseInboxQuery, inboxFields, FOR_INFO_TYPES
} = require("../inboxPriority");

const USERS = {
    officer: { id: 1, role: "document_officer" },
    profA: { id: 3, role: "faculty_staff" },       // ผู้รับปัจจุบันของ 10, 11, 12
    profB: { id: 4, role: "faculty_staff" },       // ผู้รับปัจจุบันของ 13 และผู้รับเดิมของ 10
    outsider: { id: 5, role: "faculty_staff" },    // ไม่เกี่ยวกับเอกสารใด
    executive: { id: 6, role: "executive" }
};

let db;
function resetDb() {
    db = {
        documents: [
            { id: 10, document_type: "ขออนุมัติ", deadline: "2026-12-10", status: "Assigned", assignee_id: 3, created_at: "2026-11-01T00:00:00Z" },
            { id: 11, document_type: "แจ้งเพื่อทราบ", deadline: "2026-11-25", status: "Assigned", assignee_id: 3, created_at: "2026-11-02T00:00:00Z" },
            { id: 12, document_type: "มอบหมายงาน", deadline: "2026-11-30", status: "Assigned", assignee_id: 3, created_at: "2026-11-03T00:00:00Z" },
            { id: 13, document_type: "ประชาสัมพันธ์", deadline: null, status: "Assigned", assignee_id: 4, created_at: "2026-11-04T00:00:00Z" }
        ],
        // แถวมอบหมาย: new_assignee_id เป็น VARCHAR ใน DB จริง
        assignments: [
            { id: 1, document_id: 10, previous_assignee_id: null, new_assignee_id: "4", seen_at: null },
            { id: 2, document_id: 10, previous_assignee_id: "4", new_assignee_id: "3", seen_at: null },
            { id: 3, document_id: 11, previous_assignee_id: null, new_assignee_id: "3", seen_at: null },
            { id: 4, document_id: 12, previous_assignee_id: null, new_assignee_id: "3", seen_at: "2026-11-05T01:02:03.000Z" },
            { id: 5, document_id: 13, previous_assignee_id: null, new_assignee_id: "4", seen_at: null }
        ],
        pins: [], // { user_id, document_id }
        statements: []
    };
}
resetDb();

const userBySub = sub => Object.entries(USERS).find(([name]) => sub === `sub-${name}`)?.[1];
const latestAssignment = (docId, userId) => db.assignments
    .filter(a => a.document_id === Number(docId) && a.new_assignee_id === String(userId))
    .sort((x, y) => y.id - x.id)[0];
const isPinnedBy = (userId, docId) => db.pins.some(p => String(p.user_id) === String(userId) && p.document_id === Number(docId));

// จำลอง query list: ใช้ params ตามลำดับที่ route ผูกไว้ (ดาว → ผู้รับปัจจุบัน → new_assignee_id → สิทธิ์ ...)
function listDocuments(s, params) {
    const [pinUser, currentUser, assigneeKey] = params;
    let rows = db.documents.map(d => {
        const a = String(d.assignee_id) === String(currentUser) ? latestAssignment(d.id, assigneeKey) : undefined;
        return {
            ...d,
            file_name: null,
            inbox_is_pinned: isPinnedBy(pinUser, d.id) ? 1 : 0,
            inbox_is_new: a && a.seen_at == null ? 1 : 0,
            seen_at: a ? a.seen_at : null
        };
    });
    if (/d\.assignee_id = \? OR EXISTS/.test(s)) {
        const viewer = params[3];
        rows = rows.filter(d => String(d.assignee_id) === String(viewer) ||
            db.assignments.some(a => a.document_id === d.id && a.previous_assignee_id === String(viewer)));
    }
    if (/AND d\.document_type IN \(/.test(s)) rows = rows.filter(d => FOR_INFO_TYPES.includes(d.document_type));
    if (/d\.document_type NOT IN \(/.test(s)) rows = rows.filter(d => !FOR_INFO_TYPES.includes(d.document_type));
    if (/AND p\.user_id IS NOT NULL/.test(s)) rows = rows.filter(d => d.inbox_is_pinned === 1);
    // ORDER BY ของ buildInboxOrderBy ให้ผลเดียวกับ compareInboxPriority (ยืนยันบน MySQL ใน migrationV7.test.js)
    if (/ORDER BY \(p\.user_id IS NOT NULL\) DESC/.test(s)) {
        rows.sort((x, y) => compareInboxPriority(
            { ...x, is_pinned: x.inbox_is_pinned, seen_at: x.inbox_is_new ? null : "seen" },
            { ...y, is_pinned: y.inbox_is_pinned, seen_at: y.inbox_is_new ? null : "seen" }));
    }
    return rows.map(({ seen_at, ...r }) => r);
}

function handle(sql, params = [], state) {
    const s = sql.replace(/\s+/g, " ");
    db.statements.push({ sql: s, params });

    if (/FROM users WHERE cognito_sub = \?/.test(s)) {
        const user = userBySub(params[0]);
        state.user = user;
        return [user ? [{ id: user.id, username: params[0], full_name: params[0], cognito_sub: params[0], role: user.role }] : []];
    }
    if (/FROM users_roles ur JOIN roles r/.test(s)) return [state.user ? [{ id: 1, name: state.user.role }] : []];
    if (/AS previous_assignee FROM documents d/.test(s)) {
        const [userId, docId] = params;
        return [[{ previous_assignee: db.assignments.some(a => a.document_id === Number(docId) && a.previous_assignee_id === String(userId)) ? 1 : 0 }]];
    }
    if (/FROM document_assignments WHERE document_id = \? AND assigned_by_user_id = \?/.test(s)) return [[]];
    if (/creator_username/.test(s) && /WHERE d\.id = \?/.test(s)) {
        return [db.documents.filter(d => d.id === Number(params[0])).map(d => ({ ...d }))];
    }
    if (/^ ?SELECT id, assignee_id, status FROM documents WHERE id = \?/.test(s)) {
        return [db.documents.filter(d => d.id === Number(params[0])).map(({ id, assignee_id, status }) => ({ id, assignee_id, status }))];
    }
    if (/^ ?SELECT 1 AS pinned FROM document_pins WHERE user_id = \? AND document_id = \?/.test(s)) {
        return [isPinnedBy(params[0], params[1]) ? [{ pinned: 1 }] : []];
    }
    if (/^ ?SELECT id, seen_at FROM document_assignments WHERE document_id = \? AND new_assignee_id = \?/.test(s)) {
        const a = latestAssignment(params[0], params[1]);
        return [a ? [{ id: a.id, seen_at: a.seen_at }] : []];
    }
    if (/^ ?UPDATE document_assignments SET seen_at = CURRENT_TIMESTAMP WHERE id = \? AND seen_at IS NULL/.test(s)) {
        const a = db.assignments.find(x => x.id === Number(params[0]) && x.seen_at == null);
        if (a) a.seen_at = new Date().toISOString();
        return [{ affectedRows: a ? 1 : 0 }];
    }
    if (/^ ?INSERT IGNORE INTO document_pins \(user_id, document_id\)/.test(s)) {
        const [user_id, document_id] = params;
        if (isPinnedBy(user_id, document_id)) return [{ affectedRows: 0 }];
        db.pins.push({ user_id, document_id });
        return [{ affectedRows: 1 }];
    }
    if (/^ ?DELETE FROM document_pins WHERE user_id = \? AND document_id = \?/.test(s)) {
        const before = db.pins.length;
        db.pins = db.pins.filter(p => !(String(p.user_id) === String(params[0]) && p.document_id === Number(params[1])));
        return [{ affectedRows: before - db.pins.length }];
    }
    if (/FROM documents d LEFT JOIN document_files f ON f\.id = \(/.test(s)) return [listDocuments(s, params)];
    throw new Error(`Unexpected SQL in inbox test: ${s}`);
}

function fakeConnection() {
    const state = {};
    const run = async (sql, params) => handle(sql, params, state);
    return { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: run, execute: run };
}
pool.getConnection = async () => fakeConnection();
pool.query = async (sql, params) => handle(sql, params, {});
s3.createDownloadUrl = async key => `https://bucket.s3.test/${key}`;

const app = require("../server");
let server;
let baseUrl;
before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
beforeEach(resetDb);

const bearer = name => `Bearer ${tokenFor({ sub: `sub-${name}`, username: `sub-${name}`, "cognito:groups": [USERS[name].role] })}`;
async function call(method, path, as) {
    const headers = as ? { Authorization: bearer(as) } : {};
    const response = await fetch(`${baseUrl}${path}`, { method, headers });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, body };
}
const ids = res => res.body.data.map(d => d.id);
const seenUpdates = () => db.statements.filter(x => /^ ?UPDATE document_assignments SET seen_at/.test(x.sql));

// =====================================================================
describe("AC1: เปิดเอกสารแล้ว is_new เป็น false และไม่ทับค่าเดิมเมื่อเปิดซ้ำ", () => {
    test("เปิดครั้งแรก: response ส่ง is_new=true (ค่าก่อนเปิด) แล้วตั้ง seen_at ในแถวล่าสุดของผู้รับ", async () => {
        const before = await call("GET", "/api/documents", "profA");
        assert.equal(before.body.data.find(d => d.id === 10).is_new, true);

        const first = await call("GET", "/api/documents/10", "profA");
        assert.equal(first.status, 200);
        assert.equal(first.body.is_new, true);
        assert.equal(first.body.permissions.pin, true);

        const row = db.assignments.find(a => a.id === 2);
        assert.ok(row.seen_at, "ตั้ง seen_at ในแถวมอบหมายล่าสุดที่ส่งถึงผู้ดู");
        assert.equal(db.assignments.find(a => a.id === 1).seen_at, null, "แถวเก่าที่ส่งถึงคนอื่นไม่ถูกแตะ");

        const after = await call("GET", "/api/documents", "profA");
        assert.equal(after.body.data.find(d => d.id === 10).is_new, false);
    });

    test("เปิดซ้ำ: is_new=false, seen_at เท่าเดิม และไม่มี UPDATE เพิ่ม", async () => {
        await call("GET", "/api/documents/10", "profA");
        const firstSeen = db.assignments.find(a => a.id === 2).seen_at;
        const updatesAfterFirst = seenUpdates().length;

        await new Promise(r => setTimeout(r, 15));
        const second = await call("GET", "/api/documents/10", "profA");
        assert.equal(second.body.is_new, false);
        assert.equal(db.assignments.find(a => a.id === 2).seen_at, firstSeen);
        assert.equal(seenUpdates().length, updatesAfterFirst);
        assert.ok(seenUpdates().every(u => / AND seen_at IS NULL/.test(u.sql)), "UPDATE มีเงื่อนไขกันเขียนทับเสมอ");
    });

    test("เอกสารที่เคยเปิดแล้ว (seen_at มีค่า) ไม่ถูกเขียนทับ", async () => {
        const res = await call("GET", "/api/documents/12", "profA");
        assert.equal(res.body.is_new, false);
        assert.equal(db.assignments.find(a => a.id === 4).seen_at, "2026-11-05T01:02:03.000Z");
        assert.equal(seenUpdates().length, 0);
    });

    test("ผู้ที่ไม่ใช่ผู้รับปัจจุบัน (officer, executive, ผู้รับเดิม) เปิดแล้วไม่ตั้ง seen_at และ is_new=false", async () => {
        for (const who of ["officer", "executive", "profB"]) {
            const res = await call("GET", "/api/documents/10", who);
            assert.equal(res.status, 200, who);
            assert.equal(res.body.is_new, false, who);
        }
        assert.equal(seenUpdates().length, 0);
        assert.equal(db.assignments.find(a => a.id === 2).seen_at, null, "ผู้รับปัจจุบันยังเห็นเป็นเอกสารใหม่");
    });
});

// =====================================================================
describe("AC2: เรียง Priority ตรงสูตร และดาวของอาจารย์คนหนึ่งไม่กระทบคนอื่น", () => {
    test("ค่าเริ่มต้น sort=priority: ต้องดำเนินการก่อนเพื่อทราบ แม้ deadline ของเพื่อทราบใกล้กว่า", async () => {
        const res = await call("GET", "/api/documents", "profA");
        assert.equal(res.status, 200);
        // 12 (action, 30 พ.ย.) ก่อน 10 (action, 10 ธ.ค.) ก่อน 11 (info, 25 พ.ย.)
        assert.deepEqual(ids(res), [12, 10, 11]);
        const byId = Object.fromEntries(res.body.data.map(d => [d.id, d]));
        assert.equal(byId[12].action_group, "action");
        assert.equal(byId[12].priority_level, 1);
        assert.equal(byId[11].action_group, "info");
        assert.equal(byId[11].priority_level, 2);
        assert.equal(byId[11].is_pinned, false);
        for (const d of res.body.data) {
            assert.equal("inbox_is_pinned" in d || "inbox_is_new" in d, false, "ไม่ส่งคอลัมน์ภายใน");
        }
        const last = db.statements.filter(x => /FROM documents d LEFT JOIN document_files/.test(x.sql)).pop();
        assert.ok(last.sql.includes(buildInboxOrderBy({ pinnedExpr: "p.user_id IS NOT NULL", seenExpr: "x" }).sql.split(",")[0]));
    });

    test("ปักดาว 'เพื่อทราบ' แล้วขึ้นบนสุดของผู้ปักเท่านั้น ลำดับของคนอื่นเท่าเดิม", async () => {
        const officerBefore = ids(await call("GET", "/api/documents", "officer"));

        const pin = await call("PUT", "/api/documents/11/pin", "profA");
        assert.deepEqual(pin.body, { document_id: 11, is_pinned: true });

        const mine = await call("GET", "/api/documents", "profA");
        assert.deepEqual(ids(mine), [11, 12, 10]);
        assert.equal(mine.body.data[0].priority_level, 0);
        assert.equal(mine.body.data[0].action_group, "info", "หมวดไม่เปลี่ยนเพราะดาว");

        const officerAfter = await call("GET", "/api/documents", "officer");
        assert.deepEqual(ids(officerAfter), officerBefore);
        assert.ok(officerAfter.body.data.every(d => d.is_pinned === false));

        const profB = await call("GET", "/api/documents", "profB");
        assert.ok(profB.body.data.every(d => d.is_pinned === false));
        const detailB = await call("GET", "/api/documents/10", "profB");
        assert.equal(detailB.body.is_pinned, false);
    });

    test("เสมอกันทั้งหมวดและ deadline → ยังไม่เปิดก่อน", () => {
        const base = { document_type: "ขออนุมัติ", deadline: "2026-12-01", created_at: "2026-11-01" };
        const seen = { ...base, id: 1, seen_at: "2026-11-02", created_at: "2026-11-09" };
        const unseen = { ...base, id: 2, seen_at: null };
        assert.deepEqual([seen, unseen].sort(compareInboxPriority).map(d => d.id), [2, 1]);
    });

    test("เกินกำหนดเป็นแค่ป้าย ไม่ดันลำดับ", () => {
        const now = new Date("2026-11-23T12:00:00");
        const overdueInfo = inboxFields({ document_type: "แจ้งเพื่อทราบ", deadline: "2026-11-01" }, {}, now);
        assert.equal(overdueInfo.is_overdue, true);
        assert.equal(overdueInfo.priority_level, 2);
        assert.equal(inboxFields({ document_type: "ขออนุมัติ", deadline: "2026-11-23" }, {}, now).is_overdue, false);
    });

    test("sort=due ใช้ deadline ใกล้ก่อน ไม่มี deadline อยู่ท้าย", async () => {
        const res = await call("GET", "/api/documents?sort=due", "officer");
        assert.equal(res.status, 200);
        const sql = db.statements.filter(x => /FROM documents d LEFT JOIN document_files/.test(x.sql)).pop().sql;
        assert.match(sql, /ORDER BY d\.deadline IS NULL ASC, d\.deadline ASC/);
    });

    test("group=action / group=info / pinned=1 กรองถูก", async () => {
        await call("PUT", "/api/documents/12/pin", "profA");
        assert.deepEqual(ids(await call("GET", "/api/documents?group=action", "profA")), [12, 10]);
        assert.deepEqual(ids(await call("GET", "/api/documents?group=info", "profA")), [11]);
        assert.deepEqual(ids(await call("GET", "/api/documents?group=FYI", "profA")), [11], "รับชื่อ FYI จาก Issue");
        assert.deepEqual(ids(await call("GET", "/api/documents?pinned=1", "profA")), [12]);
        assert.deepEqual(ids(await call("GET", "/api/documents?pinned=1", "profB")), []);
    });

    test("ค่า query ที่ไม่รู้จัก → 400 INVALID_QUERY และไม่ query เอกสาร", async () => {
        for (const q of ["?sort=deadline", "?group=urgent", "?pinned=yes", "?sort=priority&sort=due"]) {
            const before = db.statements.length;
            const res = await call("GET", `/api/documents${q}`, "profA");
            assert.equal(res.status, 400, q);
            assert.equal(res.body.code, "INVALID_QUERY", q);
            assert.ok(db.statements.slice(before).every(x => !/FROM documents d/.test(x.sql)), q);
        }
    });
});

// =====================================================================
describe("AC3: ปักดาวเอกสารที่ไม่มีสิทธิ์ไม่ได้", () => {
    test("อาจารย์ที่ไม่เกี่ยวข้อง PUT/DELETE pin → 403 FORBIDDEN และไม่เขียน document_pins", async () => {
        for (const method of ["PUT", "DELETE"]) {
            const res = await call(method, "/api/documents/10/pin", "outsider");
            assert.equal(res.status, 403, method);
            assert.equal(res.body.code, "FORBIDDEN");
        }
        assert.equal(db.pins.length, 0);
        assert.equal(db.statements.some(x => /INSERT IGNORE INTO document_pins|DELETE FROM document_pins/.test(x.sql)), false);
    });

    test("อาจารย์ปักดาวเอกสารของคนอื่น (ไม่เคยเป็นผู้รับ) ไม่ได้", async () => {
        const res = await call("PUT", "/api/documents/13/pin", "profA");
        assert.equal(res.status, 403);
        assert.equal(db.pins.length, 0);
    });

    test("ไม่มีเอกสาร → 404, id ผิดรูปแบบ → 400, ไม่ login → 401", async () => {
        const missing = await call("PUT", "/api/documents/999/pin", "officer");
        assert.equal(missing.status, 404);
        assert.equal(missing.body.code, "DOCUMENT_NOT_FOUND");
        const bad = await call("PUT", "/api/documents/abc/pin", "officer");
        assert.equal(bad.status, 400);
        assert.equal(bad.body.code, "INVALID_DOCUMENT_ID");
        assert.equal((await call("PUT", "/api/documents/10/pin")).status, 401);
        assert.equal(db.pins.length, 0);
    });

    test("ผู้มีสิทธิ์อ่าน (ผู้รับเดิม, executive) ปักได้ ปักซ้ำ/เลิกปักซ้ำไม่ error", async () => {
        assert.equal((await call("PUT", "/api/documents/10/pin", "profB")).status, 200, "ผู้รับเดิมอ่านได้ จึงปักได้");
        assert.equal((await call("PUT", "/api/documents/10/pin", "profB")).status, 200);
        assert.equal((await call("PUT", "/api/documents/10/pin", "executive")).status, 200);
        assert.equal(db.pins.length, 2);

        const del = await call("DELETE", "/api/documents/10/pin", "profB");
        assert.deepEqual(del.body, { document_id: 10, is_pinned: false });
        assert.equal((await call("DELETE", "/api/documents/10/pin", "profB")).status, 200);
        assert.deepEqual(db.pins, [{ user_id: 6, document_id: 10 }], "ดาวของ executive ยังอยู่");
    });
});

// =====================================================================
describe("unit: parseInboxQuery", () => {
    test("ค่าเริ่มต้นและค่าที่รับได้", () => {
        assert.deepEqual(parseInboxQuery({}), { sort: "priority", group: null, pinned: false });
        assert.deepEqual(parseInboxQuery({ sort: "DUE", group: "Info", pinned: "1" }), { sort: "due", group: "info", pinned: true });
        assert.deepEqual(parseInboxQuery({ group: "ACTION", pinned: "0" }), { sort: "priority", group: "action", pinned: false });
    });
    test("ค่าผิด / ส่งซ้ำเป็น array → error", () => {
        assert.ok(parseInboxQuery({ sort: "newest" }).error);
        assert.ok(parseInboxQuery({ group: "x" }).error);
        assert.ok(parseInboxQuery({ pinned: "true" }).error);
        assert.ok(parseInboxQuery({ group: ["action", "info"] }).error);
    });
});
