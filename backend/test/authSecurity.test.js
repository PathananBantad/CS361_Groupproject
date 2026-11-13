// ทดสอบความปลอดภัย Authentication & Configuration
// - Secret scan ไฟล์ที่ track ใน Git
// - TU SSO (fail closed), Direct Cognito, HS256 fallback token, token ผิด/หมดอายุ
// - CORS allow/deny และ OPTIONS preflight
// ไม่เรียก TU API / AWS / ฐานข้อมูลจริง: stub fetch, Cognito client และ pool
process.env.SESSION_SECRET ||= "test-only-session-secret";

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// ---------- stubs (ต้องตั้งก่อน require server/auth) ----------
const cognitoSdk = require("@aws-sdk/client-cognito-identity-provider");
const cognitoCalls = [];
let cognitoHandler = async () => { throw Object.assign(new Error("not stubbed"), { name: "NotAuthorizedException" }); };
cognitoSdk.CognitoIdentityProviderClient.prototype.send = async function (command) {
    cognitoCalls.push(command.constructor.name);
    return cognitoHandler(command);
};

const pool = require("../db");
let dbRoleForUser = null;
pool.query = async (sql) => {
    if (/SELECT role FROM users WHERE username/.test(sql)) return [dbRoleForUser ? [{ role: dbRoleForUser }] : []];
    if (/SELECT id FROM users WHERE username/.test(sql)) return [[{ id: 1 }]];
    if (/SELECT id FROM roles WHERE name/.test(sql)) return [[{ id: 1 }]];
    return [[]];
};

const originalFetch = global.fetch;
let tuFetchHandler = async () => { throw new Error("TU API unreachable"); };
const tuFetchCalls = [];
global.fetch = async (url, options) => {
    tuFetchCalls.push(String(url));
    return tuFetchHandler(url, options);
};

const app = require("../server");
const { signHs256Jwt, verifyHs256Jwt } = require("../cognito-auth");
const { FALLBACK_TOKEN_ISSUER } = require("../config");

const ENV_KEYS = ["TU_API_KEY", "TU_APP_KEY", "TU_AUTH_DEV_BYPASS", "NODE_ENV", "CORS_ALLOWED_ORIGINS", "AUTH_JWT_SECRET"];
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function resetEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.TU_API_KEY = "test-tu-key";
}

function request(server, { method = "GET", path: urlPath, headers = {}, body }) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const allHeaders = { ...headers };
        if (payload) Object.assign(allHeaders, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
        const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: urlPath, method, headers: allHeaders }, res => {
            let data = "";
            res.on("data", c => { data += c; });
            res.on("end", () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch { /* not JSON */ }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function fakeIdToken(claims) {
    return `${b64url({ alg: "RS256", kid: "test" })}.${b64url(claims)}.sig`;
}
const now = () => Math.floor(Date.now() / 1000);

// ======================================================================
describe("Secret scan (Git-tracked files)", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
        .split("\0").filter(Boolean)
        .filter(f => !/package-lock\.json$|\.(png|jpe?g|docx|pdf|zip|pem)$/i.test(f));

    const PATTERNS = [
        ["TU Application-Key", /TU[0-9a-f]{64,}/],
        ["AWS access key", /\b(AKIA|ASIA)(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16}\b/],
        ["Private key", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
        ["Hardcoded secret fallback", /(SESSION_SECRET|AUTH_JWT_SECRET|TU_API_KEY|DB_PASSWORD|COGNITO_CLIENT_SECRET)\s*\|\|\s*["'`][^"'`]{6,}/],
        ["Assigned secret literal", /(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["'][A-Za-z0-9/+]{30,}["']/]
    ];

    test("ไม่มีไฟล์ .env ที่มีค่าจริงถูก track", () => {
        const envFiles = tracked.filter(f => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"));
        assert.deepEqual(envFiles, []);
    });

    test("ไม่มี secret จริง hardcode ใน source ที่ track ใน Git", () => {
        const findings = [];
        for (const file of tracked) {
            const full = path.join(repoRoot, file);
            if (!fs.existsSync(full)) continue;
            const text = fs.readFileSync(full, "utf8");
            text.split(/\r?\n/).forEach((line, i) => {
                // test ใช้ secret เฉพาะการทดสอบได้ (test-only-*)
                if (/test-only-/.test(line)) return;
                for (const [label, re] of PATTERNS) {
                    if (re.test(line)) findings.push(`${file}:${i + 1} ${label}`);
                }
            });
        }
        assert.deepEqual(findings, []);
    });

    test(".env.example ไม่มีค่า secret จริง", () => {
        const example = fs.readFileSync(path.join(repoRoot, "backend/.env.example"), "utf8");
        const secretKeys = ["SESSION_SECRET", "AUTH_JWT_SECRET", "TU_API_KEY", "COGNITO_CLIENT_SECRET", "DB_PASSWORD",
            "DB_USER", "DB_USERNAME", "DB_SECRET_ARN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "LAMBDA_DB_SECRET_ARN"];
        for (const key of secretKeys) {
            const match = example.match(new RegExp(`^${key}=(.*)$`, "m"));
            assert.ok(match, `${key} ต้องมีใน .env.example`);
            assert.equal(match[1].trim(), "", `${key} ต้องว่างใน .env.example`);
        }
    });
});

// ======================================================================
describe("Authentication & CORS API", () => {
    let server;
    before(() => { server = app.listen(0); });
    after(() => {
        server.close();
        global.fetch = originalFetch;
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    });
    beforeEach(() => {
        resetEnv();
        cognitoCalls.length = 0;
        tuFetchCalls.length = 0;
        dbRoleForUser = null;
        cognitoHandler = async () => { throw Object.assign(new Error("Incorrect username or password."), { name: "NotAuthorizedException" }); };
        tuFetchHandler = async () => { throw new Error("TU API unreachable"); };
    });

    const tuLogin = (body) => request(server, { method: "POST", path: "/api/auth/tu-login", body });

    // ---------- TU SSO ----------
    test("TU SSO: ไม่ได้ตั้ง TU_API_KEY -> 503 และไม่ยอมรับรหัสผ่านโดยไม่ตรวจ", async () => {
        delete process.env.TU_API_KEY;
        const res = await tuLogin({ username: "victim@dome.tu.ac.th", password: "anything" });
        assert.equal(res.status, 503);
        assert.equal(res.body.code, "TU_AUTH_UNAVAILABLE");
        assert.equal(res.body.access_token, undefined);
        assert.ok(!cognitoCalls.includes("AdminSetUserPasswordCommand"), "ต้องไม่เปลี่ยนรหัสผ่าน Cognito");
    });

    test("TU SSO: TU API ล่ม -> 503 (fail closed)", async () => {
        const res = await tuLogin({ username: "victim@dome.tu.ac.th", password: "anything" });
        assert.equal(res.status, 503);
        assert.equal(res.body.code, "TU_AUTH_UNAVAILABLE");
        assert.ok(tuFetchCalls.length > 0);
    });

    test("TU SSO: TU_AUTH_DEV_BYPASS ถูกปิดเสมอเมื่อ NODE_ENV=production", async () => {
        process.env.NODE_ENV = "production";
        process.env.TU_AUTH_DEV_BYPASS = "true";
        delete process.env.TU_API_KEY;
        const res = await tuLogin({ username: "victim@dome.tu.ac.th", password: "anything" });
        assert.equal(res.status, 503);
    });

    test("TU SSO: TU API ปฏิเสธรหัสผ่าน -> 401", async () => {
        tuFetchHandler = async () => ({ ok: false, json: async () => ({ status: false, message: "invalid" }) });
        const res = await tuLogin({ username: "6501234567@dome.tu.ac.th", password: "wrong" });
        assert.equal(res.status, 401);
        assert.equal(res.body.access_token, undefined);
    });

    test("TU SSO: TU API ยืนยันสำเร็จ -> ออก fallback token ที่ backend ยอมรับ พร้อม Role จาก DB", async () => {
        dbRoleForUser = "document_officer";
        tuFetchHandler = async (url, options) => {
            assert.equal(options.headers["Application-Key"], "test-tu-key");
            return { ok: true, json: async () => ({ status: true, email: "officer@dome.tu.ac.th", displayname_en: "Officer" }) };
        };
        // Cognito Admin ใช้งานไม่ได้ -> ใช้ HS256 fallback token
        cognitoHandler = async (command) => {
            if (command.constructor.name === "InitiateAuthCommand") throw Object.assign(new Error("x"), { name: "NotAuthorizedException" });
            throw Object.assign(new Error("lab down"), { name: "ResourceNotFoundException" });
        };
        const res = await tuLogin({ username: "officer@dome.tu.ac.th", password: "correct-password" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.role, "document_officer");
        assert.deepEqual(res.body.groups, ["DocumentReceiver"]);

        const payload = verifyHs256Jwt(res.body.access_token);
        assert.ok(payload, "token ต้องผ่านการตรวจ");
        assert.equal(payload.iss, FALLBACK_TOKEN_ISSUER);
        assert.ok(payload.exp - now() <= 8 * 3600 + 5, "อายุ token ค่าเริ่มต้นไม่เกิน 8 ชั่วโมง");
    });

    // ---------- Direct Cognito ----------
    test("Direct Cognito: InitiateAuth สำเร็จ -> 200 และ Role ตาม Cognito Group", async () => {
        cognitoHandler = async (command) => {
            assert.equal(command.constructor.name, "InitiateAuthCommand");
            return {
                AuthenticationResult: {
                    AccessToken: "cognito-access-token",
                    IdToken: fakeIdToken({ sub: "sub-1", email: "exec@tu.ac.th", "cognito:groups": ["Executive"] })
                }
            };
        };
        const res = await tuLogin({ username: "exec@tu.ac.th", password: "Passw0rd!" });
        assert.equal(res.status, 200);
        assert.equal(res.body.role, "executive");
        assert.equal(res.body.access_token, "cognito-access-token");
        assert.equal(tuFetchCalls.length, 0, "บัญชี Cognito ไม่ต้องเรียก TU API");
    });

    test("Login error ไม่เปิดเผยรายละเอียดภายใน", async () => {
        tuFetchHandler = async () => ({ ok: true, json: async () => ({ status: true, email: "x@dome.tu.ac.th" }) });
        cognitoHandler = async (command) => {
            if (command.constructor.name === "InitiateAuthCommand") throw Object.assign(new Error("x"), { name: "NotAuthorizedException" });
            throw Object.assign(new Error("lab down"), { name: "ResourceNotFoundException" });
        };
        const origQuery = pool.query;
        pool.query = async () => { throw new Error("internal db detail 10.0.0.5"); };
        try {
            const res = await tuLogin({ username: "x@dome.tu.ac.th", password: "p" });
            assert.ok(!JSON.stringify(res.body).includes("10.0.0.5"));
        } finally {
            pool.query = origQuery;
        }
    });

    // ---------- Token validation ----------
    const protectedPath = "/api/documents/1/audit-trail";
    const auth = token => ({ Authorization: `Bearer ${token}` });

    test("Token หมดอายุ -> 401", async () => {
        const token = signHs256Jwt({ sub: "s", username: "u@tu.ac.th", exp: now() - 10 });
        const res = await request(server, { path: protectedPath, headers: auth(token) });
        assert.equal(res.status, 401);
    });

    test("Token ลายเซ็นผิด / secret ผิด -> 401", async () => {
        const token = signHs256Jwt({ sub: "s", username: "u@tu.ac.th" }, "another-secret-value-123");
        const res = await request(server, { path: protectedPath, headers: auth(token) });
        assert.equal(res.status, 401);
    });

    test("Token ถูกแก้ payload (ยกระดับเป็น Admin) -> 401", async () => {
        const [h, , s] = signHs256Jwt({ sub: "s", username: "u@tu.ac.th", "cognito:groups": ["Staff/Instructor"] }).split(".");
        const forged = `${h}.${b64url({ sub: "s", username: "u@tu.ac.th", "cognito:groups": ["Admin"], iss: FALLBACK_TOKEN_ISSUER, token_use: "access", exp: now() + 3600 })}.${s}`;
        const res = await request(server, { path: protectedPath, headers: auth(forged) });
        assert.equal(res.status, 401);
    });

    test("Token alg=none -> 401", async () => {
        const token = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "s", username: "u", iss: FALLBACK_TOKEN_ISSUER, token_use: "access", exp: now() + 3600 })}.`;
        const res = await request(server, { path: protectedPath, headers: auth(token) });
        assert.equal(res.status, 401);
    });

    test("HS256 token แบบเก่าที่ไม่มี iss -> ถูกปฏิเสธ", () => {
        const secret = process.env.AUTH_JWT_SECRET || process.env.SESSION_SECRET;
        const h = b64url({ alg: "HS256", typ: "JWT" });
        const p = b64url({ sub: "s", username: "u", exp: now() + 3600 });
        const sig = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
        assert.equal(verifyHs256Jwt(`${h}.${p}.${sig}`), null);
    });

    test("RS256 token ที่เซ็นด้วย key ปลอม -> 401", async () => {
        const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        const h = b64url({ alg: "RS256", kid: "kKgOT+Ardsd5C+CGHIVHk6cQjo/nk9CHPc3qXrec/LQ=" });
        const p = b64url({
            sub: "s", username: "u", token_use: "access", client_id: "7onljgop56a811chbidtuppffq",
            iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ySsGHRKUQ", exp: now() + 3600
        });
        const sig = crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url");
        const res = await request(server, { path: protectedPath, headers: auth(`${h}.${p}.${sig}`) });
        assert.equal(res.status, 401);
    });

    test("ไม่มี token / token ผิดรูปแบบ -> 401", async () => {
        assert.equal((await request(server, { path: protectedPath })).status, 401);
        assert.equal((await request(server, { path: protectedPath, headers: auth("not-a-jwt") })).status, 401);
    });

    test("Token ผ่าน query string ใช้ไม่ได้กับคำขอที่ไม่ใช่ GET", async () => {
        const token = signHs256Jwt({ sub: "s", username: "u@tu.ac.th" });
        const res = await request(server, { method: "DELETE", path: `/api/documents/1?token=${token}` });
        assert.equal(res.status, 401);
    });

    // ---------- CORS ----------
    const allowedOrigin = "https://main.d29fui7wfvh5a0.amplifyapp.com";
    const evilOrigin = "https://evil.example.com";

    test("CORS: Origin ที่อนุญาต -> ได้ Access-Control-Allow-Origin ตรงกับ Origin", async () => {
        const res = await request(server, { path: "/api/workflow/config", headers: { Origin: allowedOrigin } });
        assert.equal(res.status, 200);
        assert.equal(res.headers["access-control-allow-origin"], allowedOrigin);
        assert.equal(res.headers["access-control-allow-credentials"], "true");
    });

    test("CORS: OPTIONS preflight จาก Origin ที่อนุญาต -> 204 พร้อม methods/headers", async () => {
        const res = await request(server, {
            method: "OPTIONS",
            path: "/api/documents",
            headers: { Origin: allowedOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" }
        });
        assert.equal(res.status, 204);
        assert.equal(res.headers["access-control-allow-origin"], allowedOrigin);
        assert.match(res.headers["access-control-allow-methods"], /POST/);
        assert.match(res.headers["access-control-allow-headers"], /Authorization/i);
    });

    test("CORS: Origin ที่ไม่อนุญาต -> 403 และไม่มี CORS headers (ทั้ง GET และ OPTIONS)", async () => {
        for (const method of ["GET", "OPTIONS", "POST"]) {
            const res = await request(server, {
                method,
                path: "/api/auth/tu-login",
                headers: { Origin: evilOrigin, "Access-Control-Request-Method": "POST" }
            });
            assert.equal(res.status, 403, method);
            assert.equal(res.headers["access-control-allow-origin"], undefined, method);
        }
    });

    test("CORS: ไม่ใช้ wildcard และกำหนดรายการได้ด้วย CORS_ALLOWED_ORIGINS", async () => {
        process.env.CORS_ALLOWED_ORIGINS = "https://staging.example.com";
        const ok = await request(server, { path: "/api/workflow/config", headers: { Origin: "https://staging.example.com" } });
        assert.equal(ok.headers["access-control-allow-origin"], "https://staging.example.com");
        const denied = await request(server, { path: "/api/workflow/config", headers: { Origin: allowedOrigin } });
        assert.equal(denied.status, 403);
    });

    test("CORS: same-origin และคำขอที่ไม่มี Origin ยังใช้งานได้", async () => {
        const self = `http://127.0.0.1:${server.address().port}`;
        assert.equal((await request(server, { path: "/api/workflow/config", headers: { Origin: self } })).status, 200);
        assert.equal((await request(server, { path: "/api/workflow/config" })).status, 200);
    });
});
