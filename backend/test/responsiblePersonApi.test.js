const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const app = require("../server");
const { signHs256Jwt } = require("../cognito-auth");
const pool = require("../db");

const SESSION_SECRET = process.env.SESSION_SECRET || "cs361_docuflow_secret_key_2026";

function makeRequest(server, options, bodyData = null) {
    return new Promise((resolve, reject) => {
        const addr = server.address();
        const reqOptions = {
            hostname: "127.0.0.1",
            port: addr.port,
            path: options.path,
            method: options.method || "GET",
            headers: options.headers || {}
        };

        const req = http.request(reqOptions, (res) => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: parsed
                });
            });
        });

        req.on("error", reject);
        if (bodyData) {
            req.write(typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData));
        }
        req.end();
    });
}

function authorizationHeader(token) {
    return { Authorization: ["Bearer", token].join(" ") };
}

describe("ResponsiblePerson Role & Permissions API Tests", () => {
    let server;
    let respUserId;
    let otherUserId;
    let docAssignedId;
    let docOtherId;
    let respToken;
    let roleSpoofToken;
    let multiToken;
    let dbAvailable = false;

    const respUsername = "resp.api.tester@example.com";
    const otherUsername = "other.api.tester@example.com";
    const multiUsername = "multi.api.tester@example.com";

    before(async () => {
        try {
            await pool.query("SELECT 1");
            dbAvailable = true;
        } catch (e) {
            console.warn("Live DB not available, skipping live API tests:", e.message);
            return;
        }

        // Start express server on dynamic ephemeral port
        server = app.listen(0);

        // Provision test users in DB
        const [rRows] = await pool.query("SELECT id FROM roles WHERE name = 'responsible_person'");
        const [aRows] = await pool.query("SELECT id FROM roles WHERE name = 'admin'");
        const [fRows] = await pool.query("SELECT id FROM roles WHERE name = 'faculty_staff'");
        const respRoleId = rRows[0].id;
        const adminRoleId = aRows[0].id;
        const facultyRoleId = fRows[0].id;

        // Clean up any stale test users
        await pool.query("DELETE FROM users WHERE username IN (?, ?, ?)", [respUsername, otherUsername, multiUsername]);

        // Insert resp user
        const [insResp] = await pool.query(
            "INSERT INTO users (username, password, role, cognito_sub, is_active, full_name) VALUES (?, 'COGNITO_AUTH', 'responsible_person', 'sub-resp-test', 1, 'Responsible Tester')",
            [respUsername]
        );
        respUserId = insResp.insertId;
        await pool.query("INSERT INTO users_roles (user_id, role_id) VALUES (?, ?)", [respUserId, respRoleId]);

        // Insert other user
        const [insOther] = await pool.query(
            "INSERT INTO users (username, password, role, cognito_sub, is_active, full_name) VALUES (?, 'COGNITO_AUTH', 'faculty_staff', 'sub-other-test', 1, 'Other Tester')",
            [otherUsername]
        );
        otherUserId = insOther.insertId;
        await pool.query("INSERT INTO users_roles (user_id, role_id) VALUES (?, ?)", [otherUserId, facultyRoleId]);

        // Insert multi user
        const [insMulti] = await pool.query(
            "INSERT INTO users (username, password, role, cognito_sub, is_active, full_name) VALUES (?, 'COGNITO_AUTH', 'admin', 'sub-multi-test', 1, 'Multi Role Tester')",
            [multiUsername]
        );
        const multiUserId = insMulti.insertId;
        await pool.query("INSERT INTO users_roles (user_id, role_id) VALUES (?, ?), (?, ?)", [multiUserId, respRoleId, multiUserId, adminRoleId]);

        // Insert test documents
        const [insDoc1] = await pool.query(`
            INSERT INTO documents (
                reference_no, subject, document_type, sender_name,
                receiving_channel, status, owner_id, assignee_id
            ) VALUES (
                'TEST-RESP-001', 'เอกสารมอบหมายให้ผู้รับผิดชอบ', 'เอกสารมอบหมายงาน',
                'สำนักงานคณบดี', 'EMAIL', 'Assigned', ?, ?
            )
        `, [otherUserId, respUserId]);
        docAssignedId = insDoc1.insertId;

        const [insDoc2] = await pool.query(`
            INSERT INTO documents (
                reference_no, subject, document_type, sender_name,
                receiving_channel, status, owner_id, assignee_id
            ) VALUES (
                'TEST-RESP-002', 'เอกสารของบุคคลอื่น', 'เอกสารมอบหมายงาน',
                'สำนักงานคณบดี', 'EMAIL', 'Assigned', ?, ?
            )
        `, [respUserId, otherUserId]);
        docOtherId = insDoc2.insertId;

        // Generate tokens
        respToken = signHs256Jwt({
            sub: "sub-resp-test",
            username: respUsername,
            email: respUsername,
            "cognito:groups": ["ResponsiblePerson"],
            role: "responsible_person",
            exp: Math.floor(Date.now() / 1000) + 3600
        }, SESSION_SECRET);
        roleSpoofToken = signHs256Jwt({
            sub: "sub-resp-test",
            username: respUsername,
            email: respUsername,
            role: "admin",
            "cognito:groups": [],
            exp: Math.floor(Date.now() / 1000) + 3600
        }, SESSION_SECRET);

        multiToken = signHs256Jwt({
            sub: "sub-multi-test",
            username: multiUsername,
            email: multiUsername,
            "cognito:groups": ["ResponsiblePerson", "Admin"],
            role: "admin",
            exp: Math.floor(Date.now() / 1000) + 3600
        }, SESSION_SECRET);
    });

    after(async () => {
        if (server) server.close();
        if (dbAvailable) {
            // Clean up created test data
            if (docAssignedId) await pool.query("DELETE FROM documents WHERE id IN (?, ?)", [docAssignedId, docOtherId]);
            await pool.query("DELETE FROM users WHERE username IN (?, ?, ?)", [respUsername, otherUsername, multiUsername]);
            await pool.end();
        }
    });

    test("1. GET /api/documents/:id - ResponsiblePerson อ่านเอกสารที่ตนได้รับมอบหมายได้ (200 OK)", async () => {
        if (!dbAvailable) return;
        const res = await makeRequest(server, {
            path: `/api/documents/${docAssignedId}`,
            method: "GET",
            headers: authorizationHeader(respToken)
        });

        assert.equal(res.statusCode, 200, "ต้องได้ HTTP 200");
        assert.equal(res.body.id, docAssignedId);
        assert.equal(res.body.assignee_id, respUserId);
    });

    test("2. GET /api/documents/:id - ResponsiblePerson ถูกปฏิเสธเมื่ออ่านเอกสารที่ตนไม่เกี่ยวข้อง (403 Forbidden)", async () => {
        if (!dbAvailable) return;
        const res = await makeRequest(server, {
            path: `/api/documents/${docOtherId}`,
            method: "GET",
            headers: authorizationHeader(respToken)
        });

        assert.equal(res.statusCode, 403, "ต้องได้ HTTP 403 Forbidden");
    });

    test("2a. owner_id ไม่ให้สิทธิ์อ่าน และ token role claim ที่ปลอมเป็น admin ไม่เพิ่มสิทธิ์", async () => {
        if (!dbAvailable) return;
        const ownerRes = await makeRequest(server, {
            path: `/api/documents/${docOtherId}`,
            headers: authorizationHeader(respToken)
        });
        assert.equal(ownerRes.statusCode, 403, "owner ที่ไม่ใช่ assignee ต้องอ่านไม่ได้");
        assert.deepEqual(ownerRes.body, { error: "Permission Denied" });

        const spoofedRoleRes = await makeRequest(server, {
            path: "/api/documents",
            method: "POST",
            headers: {
                ...authorizationHeader(roleSpoofToken),
                "Content-Type": "application/json"
            }
        }, {
            subject: "Token role claim must not grant admin",
            document_type: "Test",
            receiving_channel: "EMAIL",
            sender_name: "Test"
        });
        assert.equal(spoofedRoleRes.statusCode, 403, "role claim ใน token ไม่ควรแทนที่ role จากฐานข้อมูล");
        assert.deepEqual(spoofedRoleRes.body, { error: "Forbidden", code: "FORBIDDEN" });
    });

    test("3. PUT /api/documents/:id/status - ResponsiblePerson อัปเดตสถานะเอกสารของตนได้ (200 OK)", async () => {
        if (!dbAvailable) return;
        const res = await makeRequest(server, {
            path: `/api/documents/${docAssignedId}/status`,
            method: "PUT",
            headers: {
                ...authorizationHeader(respToken),
                "Content-Type": "application/json"
            }
        }, { status: "Processing", remarks: "กำลังดำเนินการโดย ResponsiblePerson" });

        assert.equal(res.statusCode, 200, "ต้องได้ HTTP 200");
        assert.equal(res.body.ok, true);
        assert.equal(res.body.data.status, "Processing");
    });

    test("4. PUT /api/documents/:id/status - ResponsiblePerson ถูกปฏิเสธเมื่อพยายามเปลี่ยนสถานะเอกสารของผู้อื่น (403 Forbidden)", async () => {
        if (!dbAvailable) return;
        const res = await makeRequest(server, {
            path: `/api/documents/${docOtherId}/status`,
            method: "PUT",
            headers: {
                ...authorizationHeader(respToken),
                "Content-Type": "application/json"
            }
        }, { status: "Processing" });

        assert.equal(res.statusCode, 403, "ต้องได้ HTTP 403 Forbidden");
    });

    test("4a. Current Assignee assign ได้; Previous Assignee อ่านได้แต่ทำ Workflow action ไม่ได้", async () => {
        if (!dbAvailable) return;
        const assignRes = await makeRequest(server, {
            path: `/api/documents/${docAssignedId}/assign`,
            method: "POST",
            headers: {
                ...authorizationHeader(respToken),
                "Content-Type": "application/json"
            }
        }, { assignee_id: otherUserId });
        assert.equal(assignRes.statusCode, 200, "Current Assignee สามารถ assign เอกสารได้");
        assert.equal(assignRes.body.ok, true);

        const previousReadRes = await makeRequest(server, {
            path: `/api/documents/${docAssignedId}`,
            headers: authorizationHeader(respToken)
        });
        assert.equal(previousReadRes.statusCode, 200, "Previous Assignee ยังอ่านเอกสารได้");
        assert.equal(previousReadRes.body.previous_assignee, true);

        for (const [path, method, body] of [
            [`/api/documents/${docAssignedId}/assign`, "POST", { assignee_id: respUserId }],
            [`/api/documents/${docAssignedId}/forward`, "POST", { new_assignee_id: respUserId }],
            [`/api/documents/${docAssignedId}/status`, "PUT", { status: "Completed" }]
        ]) {
            const response = await makeRequest(server, {
                path,
                method,
                headers: {
                    ...authorizationHeader(respToken),
                    "Content-Type": "application/json"
                }
            }, body);
            assert.equal(response.statusCode, 403, `Previous Assignee ${method} ${path} must be forbidden`);
            assert.equal(typeof response.body.error, "string", "Forbidden API response must contain an error");
        }
    });

    test("5. DELETE /api/documents/:id - ResponsiblePerson ไม่มีสิทธิ์ลบเอกสาร (403 Forbidden)", async () => {
        if (!dbAvailable) return;
        const res = await makeRequest(server, {
            path: `/api/documents/${docAssignedId}`,
            method: "DELETE",
            headers: authorizationHeader(respToken)
        });

        assert.equal(res.statusCode, 403, "ต้องได้ HTTP 403 Forbidden (เฉพาะ Admin เท่านั้นที่ลบได้)");
    });

    test("6. POST /api/documents - ResponsiblePerson ไม่มีสิทธิ์สร้างเอกสารใหม่ (403 Forbidden)", async () => {
        if (!dbAvailable) return;
        const res = await makeRequest(server, {
            path: "/api/documents",
            method: "POST",
            headers: {
                ...authorizationHeader(respToken),
                "Content-Type": "application/json"
            }
        }, {
            reference_no: "FORBIDDEN-001",
            subject: "ทดสอบสร้างเอกสาร",
            document_type: "เอกสารประชาสัมพันธ์",
            receiving_channel: "EMAIL",
            sender_name: "บุคคลภายนอก"
        });

        assert.equal(res.statusCode, 403, "ต้องได้ HTTP 403 Forbidden (เฉพาะ officer และ admin ที่สร้างได้)");
    });

    test("7. Multi-Role User (ResponsiblePerson + Admin) ได้รับสิทธิ์ Admin ในการลบและดูเอกสาร", async () => {
        if (!dbAvailable) return;
        // สามารถอ่านเอกสารใดก็ได้ในระบบ
        const readRes = await makeRequest(server, {
            path: `/api/documents/${docOtherId}`,
            method: "GET",
            headers: authorizationHeader(multiToken)
        });
        assert.equal(readRes.statusCode, 200, "Multi-role (มี Admin) ต้องอ่านเอกสารใดก็ได้");

        // สามารถลบเอกสารได้ตามสิทธิ์ Admin
        const delRes = await makeRequest(server, {
            path: `/api/documents/${docOtherId}`,
            method: "DELETE",
            headers: authorizationHeader(multiToken)
        });
        assert.equal(delRes.statusCode, 200, "Multi-role (มี Admin) ต้องลบเอกสารได้");
    });
});
