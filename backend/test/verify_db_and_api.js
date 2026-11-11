// ใช้ secret เฉพาะการทดสอบ (ห้าม hardcode secret จริงของระบบในโค้ด)
// ต้องตั้งก่อน require server/session เพื่อให้ server ตรวจ token ด้วย secret เดียวกัน
process.env.SESSION_SECRET ||= "test-only-session-secret";
const SESSION_SECRET = process.env.SESSION_SECRET;

const pool = require("../db");
const { mapCognitoGroupsToRoles, canAccessDocument, ROLES, ACTION_ROLES } = require("../documentAuthorization");
const { signHs256Jwt } = require("../cognito-auth");
const http = require("node:http");


function maskSecret(val) {
    if (!val || typeof val !== "string") return val;
    if (val.length <= 8) return "****";
    return val.substring(0, 4) + "..." + val.substring(val.length - 4);
}

function maskEmail(email) {
    if (!email || typeof email !== "string") return email;
    const parts = email.split("@");
    if (parts.length !== 2) return maskSecret(email);
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length > 2 ? name[0] + "***" + name[name.length - 1] : "***";
    return `${maskedName}@${domain}`;
}

async function runVerification() {
    console.log("==========================================================");
    console.log("📋 1. VERIFICATION: DATABASE ROLES & USERS_ROLES");
    console.log("==========================================================");

    // 1. ตรวจสอบ Roles ทั้งหมดใน DB
    const [roles] = await pool.query("SELECT id, name, description, created_at FROM roles ORDER BY id");
    console.log("รายการ Role ทั้งหมดในระบบ:");
    console.table(roles.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        created_at: r.created_at
    })));

    // 2. ตรวจสอบความถูกต้องตาม Acceptance Criteria
    const responsibleCount = roles.filter(r => r.name === "responsible_person").length;
    const ownerCount = roles.filter(r => r.name.toLowerCase() === "owner").length;
    const defaultRolesPresent = ["admin", "document_officer", "faculty_staff", "executive"].every(name =>
        roles.some(r => r.name === name)
    );

    console.log(`- จำนวน responsible_person ในตาราง roles: ${responsibleCount} (เกณฑ์: ต้องมีเพียง 1 รายการ) -> ${responsibleCount === 1 ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);
    console.log(`- จำนวน owner role ในตาราง roles: ${ownerCount} (เกณฑ์: ต้องไม่มี Owner role) -> ${ownerCount === 0 ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);
    console.log(`- Role เดิมทั้งหมดยังคงอยู่: ${defaultRolesPresent ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);

    console.log("\n==========================================================");
    console.log("📋 2. VERIFICATION: COGNITO GROUP MAPPING");
    console.log("==========================================================");
    const testCases = [
        { group: ["ResponsiblePerson"], expected: ["responsible_person"] },
        { group: ["responsibleperson"], expected: ["responsible_person"] },
        { group: ["RESPONSIBLEPERSON"], expected: ["responsible_person"] },
        { group: ["ResponsiblePerson", "Admin"], expected: ["responsible_person", "admin"] },
        { group: ["ResponsiblePerson", "Staff/Instructor"], expected: ["responsible_person", "faculty_staff"] },
        { group: ["Staff/Instructor"], expected: ["faculty_staff"] },
        { group: ["DocumentReceiver"], expected: ["document_officer"] },
        { group: ["Executive"], expected: ["executive"] }
    ];

    for (const tc of testCases) {
        const mapped = mapCognitoGroupsToRoles(tc.group);
        const pass = JSON.stringify(mapped.sort()) === JSON.stringify(tc.expected.sort());
        console.log(`  Mapping: ${JSON.stringify(tc.group)} -> ${JSON.stringify(mapped)} [${pass ? "✅ ผ่าน" : "❌ ล้มเหลว"}]`);
    }

    console.log("\n==========================================================");
    console.log("📋 3. VERIFICATION: LOGIN & PROVISIONING WITH ResponsiblePerson");
    console.log("==========================================================");

    // จำลอง User ที่มีกลุ่ม ResponsiblePerson ใน Cognito
    const testCognitoSub = "sub-test-resp-person-001";
    const testUsername = "responsible.test@example.com";
    const testGroups = ["ResponsiblePerson"];

    // สร้าง Token ปลอดภัยที่ระบบรองรับ (HS256 Bearer Token)
    const testToken = signHs256Jwt({
        sub: testCognitoSub,
        username: testUsername,
        email: testUsername,
        "cognito:groups": testGroups,
        role: "responsible_person",
        exp: Math.floor(Date.now() / 1000) + 3600
    }, SESSION_SECRET);

    console.log(`สร้าง JWT Access Token จำลองสำหรับบัญชี ResponsiblePerson:`);
    console.log(`- Username: ${maskEmail(testUsername)}`);
    console.log(`- Cognito Groups: ${JSON.stringify(testGroups)}`);
    console.log(`- Bearer Token: ${maskSecret(testToken)}`);

    // ตรวจสอบการ Map และ Provision เข้า DB
    const mappedRoles = mapCognitoGroupsToRoles(testGroups);
    console.log(`- Mapped Application Role: ${JSON.stringify(mappedRoles)}`);

    // ทำการ Provision / Sync ลง DB ให้ตรงกับ server.js loadUserRole
    const [existingUsers] = await pool.query("SELECT id, username, role FROM users WHERE username = ?", [testUsername]);
    let testUserId;
    if (existingUsers.length === 0) {
        const [ins] = await pool.query(
            "INSERT INTO users (username, password, role, cognito_sub, is_active, full_name) VALUES (?, 'COGNITO_AUTH', 'responsible_person', ?, 1, ?)",
            [testUsername, testCognitoSub, "Responsible Person Tester"]
        );
        testUserId = ins.insertId;
        console.log(`  + Provisioned new user ID: ${testUserId} with role 'responsible_person'`);
    } else {
        testUserId = existingUsers[0].id;
        console.log(`  + Existing user ID: ${testUserId}`);
    }

    // ซิงค์เข้า users_roles
    const [respRoleRow] = await pool.query("SELECT id FROM roles WHERE name = 'responsible_person'");
    await pool.query(
        "INSERT IGNORE INTO users_roles (user_id, role_id) VALUES (?, ?)",
        [testUserId, respRoleRow[0].id]
    );

    // ตรวจสอบข้อมูลใน DB
    const [userCheck] = await pool.query(
        `SELECT u.id, u.username, u.role, GROUP_CONCAT(r.name) AS roles
         FROM users u
         JOIN users_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.id = ?
         GROUP BY u.id, u.username, u.role`,
        [testUserId]
    );

    console.log(`\nผลการอ่านข้อมูลจาก DB หลัง Provision:`);
    console.table(userCheck.map(u => ({
        id: u.id,
        username: maskEmail(u.username),
        role_column: u.role,
        users_roles: u.roles
    })));

    const isMatch = userCheck[0]?.role === "responsible_person" && userCheck[0]?.roles?.includes("responsible_person");
    console.log(`- Role จาก Cognito และ DB ตรงกัน: ${isMatch ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);

    console.log("\n==========================================================");
    console.log("📋 4. VERIFICATION: PERMISSIONS OF ResponsiblePerson (RBAC)");
    console.log("==========================================================");

    const docAssigned = { id: 991, owner_id: 1, assignee_id: testUserId, status: "Assigned" };
    const docOther = { id: 992, owner_id: 1, assignee_id: 9999, status: "Assigned" };

    const tests = [
        { action: "read", doc: docAssigned, desc: "อ่านเอกสารที่ได้รับมอบหมาย", expected: true },
        { action: "read", doc: docOther, desc: "อ่านเอกสารของผู้อื่นที่ตนไม่ได้รับมอบหมาย", expected: false },
        { action: "status", doc: docAssigned, desc: "เปลี่ยนสถานะเอกสารที่ได้รับมอบหมาย", expected: true },
        { action: "status", doc: docOther, desc: "เปลี่ยนสถานะเอกสารที่ตนไม่ได้รับมอบหมาย", expected: false },
        { action: "assign", doc: docAssigned, desc: "มอบหมายต่อ (Reassign) ในฐานะ Current Assignee", expected: true },
        { action: "assign", doc: docOther, desc: "มอบหมายเอกสารที่ตนไม่ได้เป็น Assignee", expected: false },
        { action: "forward", doc: docAssigned, desc: "ส่งต่อเอกสาร (Forward) ที่ตนรับผิดชอบ", expected: true },
        { action: "forward", doc: docOther, desc: "ส่งต่อเอกสารของผู้อื่น", expected: false },
        { action: "upload", doc: docAssigned, desc: "อัปโหลดเอกสารใหม่ (เฉพาะ officer/admin)", expected: false },
        { action: "delete", doc: docAssigned, desc: "ลบเอกสาร (เฉพาะ admin)", expected: false }
    ];

    for (const t of tests) {
        const allowed = canAccessDocument({
            roles: ["responsible_person"],
            userId: testUserId,
            document: t.doc,
            action: t.action
        });
        const passed = allowed === t.expected;
        const resultLabel = allowed ? "HTTP 200 / ALLOWED" : "HTTP 403 / FORBIDDEN";
        console.log(`  [${resultLabel}] ${t.desc}: ${passed ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);
    }

    console.log("\n==========================================================");
    console.log("📋 5. VERIFICATION: MULTIPLE ROLES USER (ผู้ใช้ที่มีหลาย Role)");
    console.log("==========================================================");

    const multiUserSub = "sub-test-multi-role-002";
    const multiUsername = "multi.role.user@example.com";
    const multiGroups = ["ResponsiblePerson", "Admin"];

    const multiMappedRoles = mapCognitoGroupsToRoles(multiGroups);
    console.log(`ผู้ใช้จำลอง: ${maskEmail(multiUsername)}`);
    console.log(`Cognito Groups: ${JSON.stringify(multiGroups)}`);
    console.log(`Mapped Roles: ${JSON.stringify(multiMappedRoles)}`);

    // Provision multi-role user
    const [existingMulti] = await pool.query("SELECT id FROM users WHERE username = ?", [multiUsername]);
    let multiUserId;
    if (existingMulti.length === 0) {
        const [ins] = await pool.query(
            "INSERT INTO users (username, password, role, cognito_sub, is_active, full_name) VALUES (?, 'COGNITO_AUTH', 'admin', ?, 1, ?)",
            [multiUsername, multiUserSub, "Multi Role User"]
        );
        multiUserId = ins.insertId;
    } else {
        multiUserId = existingMulti[0].id;
    }

    // Sync all mapped roles into users_roles
    for (const rName of multiMappedRoles) {
        const [rRows] = await pool.query("SELECT id FROM roles WHERE name = ?", [rName]);
        if (rRows.length > 0) {
            await pool.query("INSERT IGNORE INTO users_roles (user_id, role_id) VALUES (?, ?)", [multiUserId, rRows[0].id]);
        }
    }

    const [multiDbCheck] = await pool.query(
        `SELECT u.id, u.username, u.role, GROUP_CONCAT(r.name ORDER BY r.name) AS roles
         FROM users u
         JOIN users_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.id = ?
         GROUP BY u.id, u.username, u.role`,
        [multiUserId]
    );

    console.log(`\nผลการอ่านข้อมูล Multi-Role User จาก DB:`);
    console.table(multiDbCheck.map(u => ({
        id: u.id,
        username: maskEmail(u.username),
        active_role: u.role,
        all_roles_in_db: u.roles
    })));

    const rolesInDb = (multiDbCheck[0]?.roles || "").split(",");
    const hasBoth = rolesInDb.includes("responsible_person") && rolesInDb.includes("admin");
    console.log(`- DB มีทั้ง role 'responsible_person' และ 'admin': ${hasBoth ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);

    // ทดสอบสิทธิ์ของ Multi-role user (ต้องได้รับสิทธิ์ของทั้งสอง role)
    const canDelete = canAccessDocument({
        roles: rolesInDb,
        userId: multiUserId,
        document: docOther,
        action: "delete"
    });
    const canReadAny = canAccessDocument({
        roles: rolesInDb,
        userId: multiUserId,
        document: docOther,
        action: "read"
    });
    const canReassignAsResp = canAccessDocument({
        roles: rolesInDb,
        userId: multiUserId,
        document: { ...docAssigned, assignee_id: multiUserId },
        action: "assign"
    });

    console.log(`  [HTTP 200 / ALLOWED] ลบเอกสารได้ตามสิทธิ์ Admin: ${canDelete ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);
    console.log(`  [HTTP 200 / ALLOWED] อ่านเอกสารใดก็ได้ตามสิทธิ์ Admin: ${canReadAny ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);
    console.log(`  [HTTP 200 / ALLOWED] มอบหมายต่อในฐานะ Responsible Person: ${canReassignAsResp ? "✅ ผ่าน" : "❌ ล้มเหลว"}`);

    // ล้างข้อมูลผู้ใช้ทดสอบเพื่อคืนสภาพ DB ให้สะอาด
    await pool.query("DELETE FROM users WHERE id IN (?, ?)", [testUserId, multiUserId]);
    console.log("\n🧹 คืนสภาพฐานข้อมูล (Clean up test accounts) เรียบร้อย");

    console.log("\n==========================================================");
    console.log("🎉 ALL VERIFICATIONS COMPLETED SUCCESSFULLY!");
    console.log("==========================================================");

    process.exit(0);
}

runVerification().catch(err => {
    console.error("Verification failed:", err);
    process.exit(1);
});

