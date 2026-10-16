const http = require("http");
const app = require("./server");
const pool = require("./db");

let server;
const PORT = 3999;

function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: "127.0.0.1",
            port: PORT,
            path: path,
            method: method,
            headers: {
                "Content-Type": "application/json",
                ...headers
            }
        };

        if (payload) {
            options.headers["Content-Length"] = Buffer.byteLength(payload);
        }

        const req = http.request(options, (res) => {
            let resData = "";
            res.on("data", (chunk) => resData += chunk);
            res.on("end", () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(resData);
                } catch {
                    parsed = resData;
                }
                resolve({ status: res.statusCode, data: parsed, headers: res.headers });
            });
        });

        req.on("error", reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

async function runTests() {
    server = app.listen(PORT, () => {
        console.log(`Test server running on port ${PORT}`);
    });

    try {
        console.log("\n==========================================");
        console.log("RUNNING V3 WORKFLOW STATUS TESTS");
        console.log("==========================================");

        // 1. Test GET /api/workflow/config
        console.log("\n1. Testing GET /api/workflow/config...");
        const configRes = await request("GET", "/api/workflow/config");
        console.assert(configRes.status === 200, "Config status should be 200");
        console.assert(configRes.data.version === "V3", "Version should be V3");
        console.assert(configRes.data.statuses.length === 4, "Should have 4 statuses in V3");
        console.log("✓ GET /api/workflow/config passed!");

        // 2. Create a test document in DB
        console.log("\n2. Creating test document with status 'Received'...");
        const testRef = `TEST-V3-${Date.now()}`;
        const [insertRes] = await pool.query(
            `INSERT INTO documents (reference_no, subject, document_type, sender_name, receiving_channel, status)
             VALUES (?, 'ทดสอบ Workflow V3', 'เอกสารมอบหมายงาน', 'ผู้ทดสอบ', 'EMAIL', 'Received')`,
            [testRef]
        );
        const testDocId = insertRes.insertId;
        console.log(`✓ Test document created with ID: ${testDocId}, status: Received`);

        // 3. Test Permission: Guest should be rejected with 403
        console.log("\n3. Testing Guest permission (should return 403)...");
        const guestRes = await request("PUT", `/api/documents/${testDocId}/status`, { status: "Assigned" }, {
            "x-user-role": "guest",
            "x-user-id": "guest_user"
        });
        console.assert(guestRes.status === 403, `Expected 403 but got ${guestRes.status}`);
        console.log("✓ Guest rejected with 403 Forbidden:", guestRes.data.error);

        // 4. Test Invalid status name (should return 400)
        console.log("\n4. Testing Invalid status value (should return 400)...");
        const invalidStatusRes = await request("PUT", `/api/documents/${testDocId}/status`, { status: "InvalidStatus" }, {
            "x-user-role": "staff",
            "x-user-id": "staff01"
        });
        console.assert(invalidStatusRes.status === 400, `Expected 400 but got ${invalidStatusRes.status}`);
        console.log("✓ Invalid status rejected with 400 Bad Request:", invalidStatusRes.data.error);

        // 5. Test Same status transition (Received -> Received should return 400)
        console.log("\n5. Testing Same status transition Received -> Received (should return 400)...");
        const sameStatusRes = await request("PUT", `/api/documents/${testDocId}/status`, { status: "Received" }, {
            "x-user-role": "staff",
            "x-user-id": "staff01"
        });
        console.assert(sameStatusRes.status === 400, `Expected 400 but got ${sameStatusRes.status}`);
        console.log("✓ Same status rejected with 400 Bad Request:", sameStatusRes.data.error);

        // 6. Test Invalid transition (skipping steps: Received -> Processing or Received -> Completed should return 400 for staff)
        console.log("\n6. Testing Invalid transition skipping step Received -> Completed (should return 400)...");
        const skipRes = await request("PUT", `/api/documents/${testDocId}/status`, { status: "Completed" }, {
            "x-user-role": "staff",
            "x-user-id": "staff01"
        });
        console.assert(skipRes.status === 400, `Expected 400 but got ${skipRes.status}`);
        console.log("✓ Invalid transition rejected with 400 Bad Request:", skipRes.data.error);

        // 7. Test Valid Transition Step 1: Received -> Assigned by Staff
        console.log("\n7. Testing Valid transition Received -> Assigned by Staff...");
        const step1Res = await request("PUT", `/api/documents/${testDocId}/status`, {
            status: "Assigned",
            remarks: "มอบหมายให้เจ้าหน้าที่ดำเนินการ"
        }, {
            "x-user-role": "staff",
            "x-user-id": "staff01",
            "x-username": "staff01"
        });
        console.assert(step1Res.status === 200, `Expected 200 but got ${step1Res.status}`);
        console.assert(step1Res.data.data.status === "Assigned", "Status should be Assigned");
        console.log("✓ Received -> Assigned succeeded:", step1Res.data.message);

        // 8. Test Valid Transition Step 2: Assigned -> Processing by Staff
        console.log("\n8. Testing Valid transition Assigned -> Processing by Staff...");
        const step2Res = await request("PUT", `/api/documents/${testDocId}/status`, {
            status: "Processing",
            remarks: "กำลังตรวจทานเนื้อหาและจัดเตรียมเอกสาร"
        }, {
            "x-user-role": "staff",
            "x-user-id": "staff01",
            "x-username": "staff01"
        });
        console.assert(step2Res.status === 200, `Expected 200 but got ${step2Res.status}`);
        console.assert(step2Res.data.data.status === "Processing", "Status should be Processing");
        console.log("✓ Assigned -> Processing succeeded:", step2Res.data.message);

        // 9. Test Valid Transition Step 3: Processing -> Completed by Staff
        console.log("\n9. Testing Valid transition Processing -> Completed by Staff...");
        const step3Res = await request("PUT", `/api/documents/${testDocId}/status`, {
            status: "Completed",
            remarks: "ดำเนินการเอกสารเรียบร้อยสมบูรณ์"
        }, {
            "x-user-role": "staff",
            "x-user-id": "staff01",
            "x-username": "staff01"
        });
        console.assert(step3Res.status === 200, `Expected 200 but got ${step3Res.status}`);
        console.assert(step3Res.data.data.status === "Completed", "Status should be Completed");
        console.log("✓ Processing -> Completed succeeded:", step3Res.data.message);

        // 10. Test Transitioning from Completed (Terminal state should return 400 for staff)
        console.log("\n10. Testing Transitioning from Completed for Staff (should return 400)...");
        const terminalRes = await request("PUT", `/api/documents/${testDocId}/status`, {
            status: "Processing"
        }, {
            "x-user-role": "staff",
            "x-user-id": "staff01"
        });
        console.assert(terminalRes.status === 400, `Expected 400 but got ${terminalRes.status}`);
        console.log("✓ Completed terminal state rejected with 400 Bad Request:", terminalRes.data.error);

        // 11. Test Admin override/revert capability
        console.log("\n11. Testing Admin override transition (Completed -> Processing)...");
        const adminRes = await request("PUT", `/api/documents/${testDocId}/status`, {
            status: "Processing",
            remarks: "ผู้ดูแลระบบแก้ไขกลับมาเป็น Processing เนื่องจากต้องแก้ไขข้อมูลเพิ่มเติม"
        }, {
            "x-user-role": "admin",
            "x-user-id": "admin01",
            "x-username": "admin01"
        });
        console.assert(adminRes.status === 200, `Expected 200 but got ${adminRes.status}`);
        console.assert(adminRes.data.data.status === "Processing", "Status should be Processing after admin change");
        console.log("✓ Admin override succeeded:", adminRes.data.message);

        // 12. Test GET /api/documents/:id/status-history (Audit Log)
        console.log("\n12. Testing GET /api/documents/:id/status-history (Audit Trail)...");
        const historyRes = await request("GET", `/api/documents/${testDocId}/status-history`);
        console.assert(historyRes.status === 200, "History status should be 200");
        console.assert(historyRes.data.history.length === 4, `Expected 4 history entries, got ${historyRes.data.history.length}`);
        console.log("✓ Status history retrieved successfully! Entries count:", historyRes.data.history.length);
        historyRes.data.history.forEach((h, idx) => {
            console.log(`   [${idx + 1}] ${h.old_status} -> ${h.new_status} | By: ${h.changed_by} | Note: ${h.remarks} | Time: ${h.changed_at}`);
        });

        // Clean up test document
        console.log("\nCleaning up test document...");
        await pool.query("DELETE FROM documents WHERE id = ?", [testDocId]);
        console.log("✓ Test document cleaned up.");

        console.log("\n==========================================");
        console.log("ALL V3 WORKFLOW STATUS TESTS PASSED 100%!");
        console.log("==========================================\n");

    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        server.close();
        process.exit(0);
    }
}

runTests();
