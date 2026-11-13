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

test("ROLES ครอบคลุม 5 บทบาทหลักของระบบ", () => {
    assert.deepEqual(
        [...ROLES].sort(),
        ["admin", "document_officer", "executive", "faculty_staff", "responsible_person"].sort()
    );
});

test("mapCognitoGroupsToRoles แปลงชื่อกลุ่ม Cognito เป็น role ของระบบ", () => {
    assert.deepEqual(mapCognitoGroupsToRoles(["Admin"]), ["admin"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["DocumentReceiver"]), ["document_officer"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["Staff/Instructor"]), ["faculty_staff"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["Executive"]), ["executive"]);
    assert.deepEqual(mapCognitoGroupsToRoles(["ResponsiblePerson"]), ["responsible_person"]);
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

test("canAccessDocument READ: faculty_staff อ่านได้เฉพาะเอกสารที่เป็น Current หรือ Previous Assignee (ไม่ใช่ owner)", () => {
    // ตาม V5: owner_id ไม่ให้สิทธิ์อ่าน — ต้องเป็น assignee เท่านั้น
    const owned = { id: 5, owner_id: 7, assignee_id: null };
    const assigned = { id: 6, owner_id: 99, assignee_id: 7 };
    const unrelated = { id: 7, owner_id: 99, assignee_id: 88 };
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: owned, action: "read" }), false, "owner เท่านั้น (ไม่ใช่ assignee) ต้องอ่านไม่ได้");
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: assigned, action: "read" }), true, "current assignee อ่านได้");
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: unrelated, action: "read" }), false, "ไม่ใช่ assignee อ่านไม่ได้");
    // previous assignee อ่านได้
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: unrelated, action: "read", previousAssignee: true }), true, "previous assignee อ่านได้");
});

test("canAccessDocument ASSIGN: document_officer และ admin มอบหมายเอกสารที่ไม่เกี่ยวข้องได้", () => {
    const doc = { id: 5, owner_id: 99, assignee_id: 99 };
    assert.equal(canAccessDocument({ roles: ["document_officer"], userId: 1, document: doc, action: "assign" }), true);
    assert.equal(canAccessDocument({ roles: ["admin"], userId: 1, document: doc, action: "assign" }), true);
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 1, document: doc, action: "assign" }), false);
    assert.equal(canAccessDocument({ roles: ["executive"], userId: 1, document: doc, action: "assign" }), false);
});

test("canAccessDocument ปฏิเสธ role ที่ไม่รู้จัก", () => {
    const doc = { id: 5, owner_id: 7, assignee_id: 7 };
    assert.equal(canAccessDocument({ roles: ["unknown_role"], userId: 7, document: doc, action: "read" }), false);
});

test("ACTION_ROLES: upload จำกัดเฉพาะ document_officer และ admin", () => {
    assert.deepEqual([...ACTION_ROLES.upload].sort(), ["admin", "document_officer"].sort());
});

test("canAccessDocument DELETE: เฉพาะ admin เท่านั้น", () => {
    const doc = { id: 5, owner_id: 1, assignee_id: 2 };
    assert.equal(canAccessDocument({ roles: ["admin"], userId: 1, document: doc, action: "delete" }), true);
    assert.equal(canAccessDocument({ roles: ["document_officer"], userId: 1, document: doc, action: "delete" }), false);
    assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 1, document: doc, action: "delete" }), false);
    assert.equal(canAccessDocument({ roles: ["executive"], userId: 1, document: doc, action: "delete" }), false);
    assert.deepEqual(ACTION_ROLES.delete, ["admin"]);
});

test("Responsible Person can reassign only as current assignee", () => {
    const document = { owner_id: 7, assignee_id: 8, status: "Assigned" };
    const context = { roles: ["responsible_person"], document, action: "assign" };
    assert.equal(canAccessDocument({ ...context, userId: 7 }), false);
    assert.equal(canAccessDocument({ ...context, userId: 8 }), true);
    assert.equal(canAccessDocument({ ...context, userId: 8, document: { ...document, status: "Completed" } }), false);
});

test("Previous assignees and executives can read without workflow rights", () => {
    const document = { owner_id: 7, assignee_id: 8, status: "Assigned" };
    const contexts = [
        { roles: ["responsible_person"], userId: 7, document, previousAssignee: true },
        { roles: ["faculty_staff"], userId: 7, document, previousAssignee: true },
        { roles: ["executive"], userId: 8, document }
    ];
    for (const context of contexts) {
        assert.equal(canAccessDocument({ ...context, action: "read" }), true);
        for (const action of ["assign", "forward", "status"]) {
            assert.equal(canAccessDocument({ ...context, action }), false);
        }
    }
});
