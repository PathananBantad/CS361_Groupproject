const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    ROLES,
    ACTION_ROLES,
    mapCognitoGroupsToRoles,
    canAccessDocument
} = require("../documentAuthorization");

// Helper เพื่อจำลอง resolveLoginRole จาก frontend/js/login.js
function resolveLoginRole(responseRole, groups = []) {
    const aliases = {
        documentreceiver: "document_officer",
        "staff/instructor": "faculty_staff",
        instructor: "faculty_staff",
        staff: "faculty_staff",
        responsibleperson: "responsible_person",
        responsible_person: "responsible_person"
    };
    const normalize = value => {
        const role = String(value || "").trim().toLowerCase();
        return Object.hasOwn(aliases, role) ? aliases[role] : role;
    };
    const groupRoles = (Array.isArray(groups) ? groups : [groups]).map(normalize).filter(Boolean);
    const candidateRoles = [...groupRoles];
    if (responseRole) candidateRoles.push(normalize(responseRole));

    return ["admin", "executive", "document_officer", "responsible_person", "faculty_staff"]
        .find(role => candidateRoles.includes(role)) || (responseRole ? normalize(responseRole) : groupRoles[0]) || "faculty_staff";
}

test("1. มี responsible_person ใน ROLES และไม่มี Owner role", () => {
    assert.equal(ROLES.includes("responsible_person"), true, "ROLES ต้องมี responsible_person");
    assert.equal(ROLES.includes("owner"), false, "ROLES ต้องไม่มี owner role");
    assert.deepEqual(
        [...ROLES].sort(),
        ["admin", "document_officer", "executive", "faculty_staff", "responsible_person"].sort()
    );
});

test("2. mapCognitoGroupsToRoles แปลง ResponsiblePerson เป็น responsible_person", () => {
    assert.deepEqual(mapCognitoGroupsToRoles(["ResponsiblePerson"]), ["responsible_person"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["responsibleperson"]), ["responsible_person"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["RESPONSIBLEPERSON"]), ["responsible_person"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["responsible_person"]), ["responsible_person"]);
});

test("3. mapCognitoGroupsToRoles รองรับผู้ใช้ที่มีหลาย Role (Multiple Roles)", () => {
    // ผู้ใช้ที่มีทั้ง ResponsiblePerson และ Admin
    const multiRole1 = mapCognitoGroupsToRoles(["ResponsiblePerson", "Admin"]);
    assert.equal(multiRole1.includes("responsible_person"), true);
    assert.equal(multiRole1.includes("admin"), true);
    assert.equal(multiRole1.length, 2);

    // ผู้ใช้ที่มีทั้ง ResponsiblePerson และ Staff/Instructor
    const multiRole2 = mapCognitoGroupsToRoles(["ResponsiblePerson", "Staff/Instructor"]);
    assert.equal(multiRole2.includes("responsible_person"), true);
    assert.equal(multiRole2.includes("faculty_staff"), true);
    assert.equal(multiRole2.length, 2);

    // ผู้ใช้ที่มีทั้ง ResponsiblePerson และ DocumentReceiver
    const multiRole3 = mapCognitoGroupsToRoles(["DocumentReceiver", "ResponsiblePerson"]);
    assert.equal(multiRole3.includes("responsible_person"), true);
    assert.equal(multiRole3.includes("document_officer"), true);
    assert.equal(multiRole3.length, 2);
});

test("4. resolveLoginRole กำหนด application role ให้ผู้ใช้ใน ResponsiblePerson ได้ถูกต้อง", () => {
    assert.equal(resolveLoginRole(null, ["ResponsiblePerson"]), "responsible_person");
    assert.equal(resolveLoginRole("responsible_person", []), "responsible_person");
    assert.equal(resolveLoginRole("faculty_staff", ["ResponsiblePerson"]), "responsible_person");
});

test("5. resolveLoginRole จัดลำดับความสำคัญ role เมื่อผู้ใช้มีหลาย Role", () => {
    // Admin มีลำดับสูงกว่า responsible_person
    assert.equal(resolveLoginRole(null, ["ResponsiblePerson", "Admin"]), "admin");
    // responsible_person มีลำดับสูงกว่า faculty_staff
    assert.equal(resolveLoginRole(null, ["ResponsiblePerson", "Staff/Instructor"]), "responsible_person");
});

test("6. สิทธิ์การเข้าถึง (RBAC) ของ responsible_person", () => {
    const assignedDoc = { id: 10, owner_id: 1, assignee_id: 20, status: "Assigned" };
    const unassignedDoc = { id: 11, owner_id: 1, assignee_id: 99, status: "Assigned" };

    // READ: อ่านได้เมื่อเป็น assignee
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 20, document: assignedDoc, action: "read" }), true);
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 50, document: unassignedDoc, action: "read" }), false);

    // STATUS CHANGE: เปลี่ยนสถานะได้เมื่อเป็น assignee
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 20, document: assignedDoc, action: "status" }), true);
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 50, document: unassignedDoc, action: "status" }), false);

    // FORWARD: ส่งต่อได้เมื่อเป็น assignee
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 20, document: assignedDoc, action: "forward" }), true);
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 50, document: unassignedDoc, action: "forward" }), false);

    // ASSIGN: มอบหมายต่อได้เมื่อเป็น assignee
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 20, document: assignedDoc, action: "assign" }), true);
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 50, document: unassignedDoc, action: "assign" }), false);

    // UPLOAD & DELETE: ไม่มีสิทธิ์ (upload เฉพาะ admin/officer, delete เฉพาะ admin)
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 20, document: assignedDoc, action: "upload" }), false);
    assert.equal(canAccessDocument({ roles: ["responsible_person"], userId: 20, document: assignedDoc, action: "delete" }), false);
});

test("7. ตรวจสอบไฟล์ Migration add_responsible_person_role.sql ว่ารันซ้ำได้อย่างปลอดภัย (Idempotent)", () => {
    const sqlPath = path.join(__dirname, "../database/add_responsible_person_role.sql");
    assert.equal(fs.existsSync(sqlPath), true, "ต้องมีไฟล์ add_responsible_person_role.sql");

    const sqlContent = fs.readFileSync(sqlPath, "utf-8");
    assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS roles/i, "ต้องมี CREATE TABLE IF NOT EXISTS");
    assert.match(sqlContent, /responsible_person/i, "ต้องมี role name 'responsible_person'");
    // ต้องมี ON DUPLICATE KEY UPDATE หรือ INSERT IGNORE
    const isIdempotent = /ON DUPLICATE KEY UPDATE/i.test(sqlContent) || /INSERT IGNORE/i.test(sqlContent);
    assert.equal(isIdempotent, true, "Migration ต้องรันซ้ำได้อย่างปลอดภัย");
});

