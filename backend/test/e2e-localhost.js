// End-to-end ตรวจ #57 / #58 / #63 กับ server ที่รันจริงบน localhost และฐานข้อมูลจริง
//
// วิธีใช้:  1) เปิด backend (npm start)   2) node test/e2e-localhost.js [baseUrl]
//
// - สร้างผู้ใช้ทดสอบชั่วคราว (e2e.v5.*@example.com) และเอกสารทดสอบ แล้วลบทิ้งทั้งหมดตอนจบ
// - token ทดสอบเซ็นด้วย secret จาก backend/.env (ไม่แสดง token/secret ในผลลัพธ์)
// - เขียนรายงาน (ตัดข้อมูลลับแล้ว) ไปที่ path ใน E2E_REPORT หรือ test/e2e-report.md
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env"), quiet: true });

const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db");
const { signHs256Jwt } = require("../cognito-auth");
const { cognitoGroupForRole } = require("../documentAuthorization");

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const PREFIX = "e2e.v5.";
const ROLES = ["document_officer", "admin", "executive", "faculty_staff", "responsible_person"];
const USERS = {
    officer: "document_officer",
    admin: "admin",
    executive: "executive",
    faculty: "faculty_staff",
    faculty2: "faculty_staff",
    responsible: "responsible_person"
};

const results = [];
const createdDocIds = new Set();
const users = {}; // key -> { id, username, role, token }

function redact(value) {
    return JSON.stringify(value ?? null)
        .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "<jwt>")
        .replace(/https:\/\/[^"]*X-Amz-[^"]*/g, "<presigned-url>")
        .replace(/[\w.+-]+@(?!example\.com)[\w-]+\.[\w.]+/g, "<email>")
        .slice(0, 220);
}

async function call(method, urlPath, { token, body, headers = {} } = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (body) h["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${urlPath}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, headers: res.headers, body: data };
}

function check(issue, name, expected, res, extra = true) {
    const statusOk = Array.isArray(expected) ? expected.includes(res.status) : res.status === expected;
    const pass = statusOk && extra === true;
    results.push({
        issue, name,
        expected: Array.isArray(expected) ? expected.join("/") : String(expected),
        actual: res.status,
        pass,
        note: extra === true ? "" : String(extra),
        response: redact(res.body)
    });
    console.log(`${pass ? "PASS" : "FAIL"}  [${issue}] ${name} -> ${res.status}${extra === true ? "" : " (" + extra + ")"}`);
    return res;
}

async function setupUsers() {
    for (const [key, role] of Object.entries(USERS)) {
        const username = `${PREFIX}${key}@example.com`;
        const sub = `${PREFIX}sub-${key}`;
        await pool.query("DELETE ur FROM users_roles ur JOIN users u ON u.id = ur.user_id WHERE u.username = ?", [username]);
        await pool.query("DELETE FROM users WHERE username = ?", [username]);
        const [ins] = await pool.query(
            "INSERT INTO users (username, password, role, cognito_sub, is_active, full_name) VALUES (?, 'COGNITO_AUTH', ?, ?, 1, ?)",
            [username, role, sub, `E2E ${key}`]
        );
        const [[roleRow]] = await pool.query("SELECT id FROM roles WHERE name = ?", [role]);
        await pool.query("INSERT INTO users_roles (user_id, role_id) VALUES (?, ?)", [ins.insertId, roleRow.id]);
        users[key] = {
            id: ins.insertId,
            username,
            role,
            token: signHs256Jwt({ sub, username, "cognito:groups": [cognitoGroupForRole(role)] })
        };
    }
}

async function cleanup() {
    for (const id of createdDocIds) {
        // document_audit_trails ลบตรงไม่ได้ (trigger) — ถูกลบตาม FK CASCADE เมื่อลบ documents
        for (const table of ["document_files", "document_assignments", "document_status_logs"]) {
            await pool.query(`DELETE FROM ${table} WHERE document_id = ?`, [id]).catch(() => {});
        }
        await pool.query("DELETE FROM documents WHERE id = ?", [id]).catch(() => {});
    }
    const ids = Object.values(users).map(u => u.id);
    if (ids.length) {
        await pool.query("DELETE FROM users_roles WHERE user_id IN (?)", [ids]).catch(() => {});
        await pool.query("DELETE FROM users WHERE id IN (?)", [ids]).catch(e => console.warn("cleanup users:", e.message));
    }
}

function docBody(tag) {
    return {
        subject: `E2E V5 ${tag} ${Date.now()}`,
        document_type: "บันทึกข้อความ",
        sender_name: "E2E Tester",
        receiving_channel: "PAPER",
        receive_date: new Date().toISOString().slice(0, 10)
    };
}

async function run() {
    const health = await call("GET", "/api/health");
    if (health.status !== 200) throw new Error(`Server/DB not ready: ${health.status} ${redact(health.body)}`);
    console.log(`Server ${BASE} OK, database connected\n`);

    await setupUsers();
    const t = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.token]));

    // ===================== #57 Register restriction + Guest =====================
    const created = check("#57", "POST /api/documents as document_officer", 201,
        await call("POST", "/api/documents", { token: t.officer, body: docBody("officer") }));
    const docId = created.body?.id;
    if (!docId) throw new Error("Officer could not register a document; cannot continue");
    createdDocIds.add(docId);
    const refNo = created.body.reference_no;

    for (const key of ["admin", "executive", "faculty", "responsible"]) {
        const res = await call("POST", "/api/documents", { token: t[key], body: docBody(key) });
        if (res.body?.id) createdDocIds.add(res.body.id);
        check("#57", `POST /api/documents as ${users[key].role}`, 403, res, res.body?.code === "FORBIDDEN" || `code=${res.body?.code}`);
    }
    check("#57", "POST /api/documents without token", 401, await call("POST", "/api/documents", { body: docBody("anon") }));

    // ไม่มีโหมด Guest แล้ว: ทุก API เอกสารต้องเข้าสู่ระบบ
    check("#57", "Unauthenticated GET /api/documents", 401,
        await call("GET", `/api/documents?reference_no=${encodeURIComponent(refNo)}`));
    check("#57", "POST /api/auth/guest removed", 404, await call("POST", "/api/auth/guest", { body: {} }));

    for (const p of [`/api/documents/${docId}`, `/api/documents/${docId}/assignments`, `/api/documents/${docId}/status-history`,
        `/api/documents/${docId}/audit-trail`, `/api/documents/${docId}/preview-url`, `/api/documents/${docId}/download-url`,
        `/api/documents/${docId}/download-file`, "/api/audit-trails"]) {
        check("#57", `Unauthenticated GET ${p.replace(String(docId), ":id")}`, 401, await call("GET", p));
    }

    // ===================== #63 Owner-based authorization removed =====================
    // ผู้ลงทะเบียน (owner_id) = officer; จำลองเอกสารเดิมที่ owner เป็น faculty2 (ไม่ใช่ assignee)
    await pool.query("UPDATE documents SET owner_id = ? WHERE id = ?", [users.faculty2.id, docId]);
    check("#63", "Registrant (owner_id) who is not assignee cannot read detail", 403,
        await call("GET", `/api/documents/${docId}`, { token: t.faculty2 }));
    const ownerList = await call("GET", `/api/documents?reference_no=${encodeURIComponent(refNo)}`, { token: t.faculty2 });
    check("#63", "Registrant (owner_id) not in assignee list results", 200, ownerList,
        (ownerList.body?.data || []).length === 0 || "document visible to owner");
    check("#63", "Registrant (owner_id) cannot read audit trail", 403,
        await call("GET", `/api/documents/${docId}/audit-trail`, { token: t.faculty2 }));
    check("#63", "Faculty (not assignee) cannot read", 403, await call("GET", `/api/documents/${docId}`, { token: t.faculty }));

    check("#63", "Officer assigns document to Faculty", 200,
        await call("POST", `/api/documents/${docId}/assign`, { token: t.officer, body: { assignee_id: users.faculty.id, remarks: "e2e" } }));
    const facultyDetail = await call("GET", `/api/documents/${docId}`, { token: t.faculty });
    check("#63", "Current Assignee (Faculty) can read detail", 200, facultyDetail);
    check("#63", "Registrant info still shown as reference (owner_full_name)", 200, facultyDetail,
        facultyDetail.body?.owner_full_name === "E2E faculty2" || `owner_full_name=${facultyDetail.body?.owner_full_name}`);
    check("#63", "Current Assignee can change status", 200,
        await call("PUT", `/api/documents/${docId}/status`, { token: t.faculty, body: { status: "Processing", remarks: "e2e" } }));

    check("#63", "Faculty reassigns to Responsible Person", 200,
        await call("POST", `/api/documents/${docId}/assign`, { token: t.faculty, body: { assignee_id: users.responsible.id, remarks: "e2e" } }));
    check("#63", "Previous Assignee (Faculty) can still read", 200, await call("GET", `/api/documents/${docId}`, { token: t.faculty }));
    check("#63", "Previous Assignee can read audit trail", 200, await call("GET", `/api/documents/${docId}/audit-trail`, { token: t.faculty }));
    check("#63", "Previous Assignee cannot change status (read-only)", 403,
        await call("PUT", `/api/documents/${docId}/status`, { token: t.faculty, body: { status: "Completed", remarks: "e2e" } }));
    check("#63", "New Current Assignee (Responsible) can read", 200, await call("GET", `/api/documents/${docId}`, { token: t.responsible }));
    check("#63", "Unrelated Faculty still cannot read", 403, await call("GET", `/api/documents/${docId}`, { token: t.faculty2 }));
    check("#63", "Executive can read all (read-only role)", 200, await call("GET", `/api/documents/${docId}`, { token: t.executive }));
    const [[ownerRow]] = await pool.query("SELECT owner_id FROM documents WHERE id = ?", [docId]);
    check("#63", "owner_id data preserved after workflow", 200, { status: 200, body: { owner_id_preserved: ownerRow.owner_id === users.faculty2.id } },
        ownerRow.owner_id === users.faculty2.id || "owner_id changed");

    // ===================== #58 Auth / token / CORS =====================
    check("#58", "Valid fallback token accepted", 200, await call("GET", `/api/documents/${docId}`, { token: t.officer }));
    const expired = signHs256Jwt({ sub: `${PREFIX}sub-officer`, username: users.officer.username, exp: Math.floor(Date.now() / 1000) - 60 });
    check("#58", "Expired token rejected", 401, await call("GET", `/api/documents/${docId}`, { token: expired }));
    const [h, p, s] = t.faculty2.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({
        ...JSON.parse(Buffer.from(p, "base64url").toString()), "cognito:groups": ["Admin"]
    })).toString("base64url");
    check("#58", "Tampered token (escalate to Admin) rejected", 401, await call("GET", `/api/documents/${docId}`, { token: `${h}.${forgedPayload}.${s}` }));
    check("#58", "Garbage token rejected", 401, await call("GET", `/api/documents/${docId}`, { token: "not-a-jwt" }));

    const badLogin = await call("POST", "/api/auth/tu-login", { body: { username: `${PREFIX}nobody@dome.tu.ac.th`, password: "Wrong-Password-1!" } });
    check("#58", "TU SSO login with wrong credentials rejected (no token)", [401, 503], badLogin, !badLogin.body?.access_token || "token issued!");
    const badCognito = await call("POST", "/api/auth/tu-login", { body: { username: `${PREFIX}nobody@example.com`, password: "Wrong-Password-1!" } });
    check("#58", "Direct Cognito login with wrong credentials rejected (no token)", [401, 503], badCognito, !badCognito.body?.access_token || "token issued!");

    const allowed = "https://main.d29fui7wfvh5a0.amplifyapp.com";
    const pre = await call("OPTIONS", "/api/documents", { headers: { Origin: allowed, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
    check("#58", "CORS preflight OPTIONS from allowed origin", 204, pre,
        pre.headers.get("access-control-allow-origin") === allowed || "missing ACAO");
    const allowGet = await call("GET", "/api/workflow/config", { headers: { Origin: allowed } });
    check("#58", "CORS GET from allowed origin has ACAO", 200, allowGet, allowGet.headers.get("access-control-allow-origin") === allowed || "missing ACAO");
    for (const method of ["OPTIONS", "GET"]) {
        const denied = await call(method, "/api/workflow/config", { headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "GET" } });
        check("#58", `CORS ${method} from disallowed origin denied`, 403, denied,
            !denied.headers.get("access-control-allow-origin") || "ACAO present");
    }

    // ===================== cleanup via API (admin delete) =====================
    check("#57", "Admin deletes test document", 200, await call("DELETE", `/api/documents/${docId}`, { token: t.admin }));
}

function writeReport() {
    const passed = results.filter(r => r.pass).length;
    const lines = [
        `# E2E localhost verification (${new Date().toISOString()})`,
        "",
        `Target: ${BASE} | Result: **${passed}/${results.length} passed**`,
        "",
        "Tokens, secrets and personal e-mail addresses are redacted. Test users are synthetic (e2e.v5.*@example.com).",
        "",
        "| Issue | Case | Expected | Actual | Result | Response (redacted) |",
        "|---|---|---|---|---|---|",
        ...results.map(r => `| ${r.issue} | ${r.name}${r.note ? ` (${r.note})` : ""} | ${r.expected} | ${r.actual} | ${r.pass ? "PASS" : "FAIL"} | \`${r.response.replace(/\|/g, "\\|")}\` |`)
    ];
    const out = process.env.E2E_REPORT || path.join(__dirname, "e2e-report.md");
    fs.writeFileSync(out, lines.join("\n") + "\n", "utf8");
    console.log(`\n${passed}/${results.length} passed. Report: ${out}`);
    return passed === results.length;
}

(async () => {
    let ok = false;
    try {
        await run();
    } catch (error) {
        console.error("E2E aborted:", error.message);
    } finally {
        await cleanup();
        ok = results.length > 0 && writeReport();
        await pool.end().catch(() => {});
    }
    process.exit(ok ? 0 : 1);
})();
