// Unit tests สำหรับ Role-Based Access Control (RBAC) — ส่วนความปลอดภัยหลักของระบบ
// ทดสอบ logic ล้วน ไม่ต้องต่อ DB/network จึงรันได้เสถียรใน CI
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    ROLES,
    ACTION_ROLES,
    mapCognitoGroupsToRoles,
    canAccessDocument
} = require("../documentAuthorization");

test("ROLES ครอบคลุม 4 บทบาทหลักของระบบ", () => {
    assert.deepEqual(
        [...ROLES].sort(),
        ["admin", "document_officer", "executive", "faculty_staff"].sort()
    );
});

test("mapCognitoGroupsToRoles แปลงชื่อกลุ่ม Cognito เป็น role ของระบบ", () => {
    assert.deepEqual(mapCognitoGroupsToRoles(["Admin"]), ["admin"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["DocumentReceiver"]), ["document_officer"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["Staff/Instructor"]), ["faculty_staff"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["Executive"]), ["executive"]);
});

test("mapCognitoGroupsToRoles ไม่สนตัวพิมพ์เล็ก/ใหญ่ และตัด duplicate", () => {
    assert.deepEqual(mapCognitoGroupsToRoles(["admin", "ADMIN"]), ["admin"]);
});

test("mapCognitoGroupsToRoles คืนค่าว่างเมื่อกลุ่มไม่รู้จักหรือ input ไม่ใช่ array", () => {
    assert.deepEqual(mapCognitoGroupsToRoles(["unknown-group"]), []);
    assert.deepEqual(mapCognitoGroupsToRoles(null), []);
    assert.deepEqual(mapCognitoGroupsToRoles(undefined), []);
    assert.deepEqual(mapCognitoGroupsToRoles("Admin"), ["admin"]); // string เดี่ยว
});

test("canAccessDocument: ปฏิเสธเมื่อไม่มี document หรือ userId", () => {
    assert.equal(canAccessDocument({ roles: ["admin"], userId: null, document: { id: 1 }, action: "read" }), false);
    assert.equal(canAccessDocument({ roles: ["admin"], userId: 1, document: null, action: "read" }), false);
});

test("canAccessDocument READ: admin/executive/document_officer เข้าถึงเอกสารใดก็ได้", () => {
    const doc = { id: 5, owner_id: 99, assignee_id: 99 };
    for (const role of ["admin", "executive", "document_officer"]) {
        assert.equal(canAccessDocument({ roles: [role], userId: 1, document: doc, action: "read" }), true, `${role} ควรอ่านได้`);
    }
});

test("canAccessDocument READ: faculty_staff อ่านได้เฉพาะเอกสารที่เป็นเจ้าของหรือผู้รับมอบหมาย", () => {
    const owned = { id: 5, owner_id: 7, assignee_id: null };
    const assigned = { id: 6, owner_id: 99, assignee_id: 7 };
    const unrelated = { id: 7, owner_id: 99, assignee_id: 88 };
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: owned, action: "read" }), true);
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: assigned, action: "read" }), true);
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: unrelated, action: "read" }), false);
});

test("canAccessDocument ASSIGN: เฉพาะ document_officer และ admin", () => {
    const doc = { id: 5, owner_id: 99, assignee_id: 99 };
    assert.equal(canAccessDocument({ roles: ["document_officer"], userId: 1, document: doc, action: "assign" }), true);
    assert.equal(canAccessDocument({ roles: ["admin"], userId: 1, document: doc, action: "assign" }), true);
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 1, document: doc, action: "assign" }), false);
    assert.equal(canAccessDocument({ roles: ["executive"], userId: 1, document: doc, action: "assign" }), false);
});

test("canAccessDocument ปฏิเสธ role ที่ไม่รู้จัก (เช่น guest)", () => {
    const doc = { id: 5, owner_id: 7, assignee_id: 7 };
    assert.equal(canAccessDocument({ roles: ["guest"], userId: 7, document: doc, action: "read" }), false);
});

test("ACTION_ROLES: upload จำกัดเฉพาะ document_officer และ admin", () => {
    assert.deepEqual([...ACTION_ROLES.upload].sort(), ["admin", "document_officer"].sort());
});
