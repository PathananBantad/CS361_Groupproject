// Unit tests ครอบคลุม Permission Matrix V5 ทุก Role × Action
// ทดสอบ logic ล้วน ไม่ต้องต่อ DB/network — รันได้เสถียรใน CI
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    canAccessDocument,
    canPerformAction,
    requireAction,
    ACTION_ROLES
} = require("../documentAuthorization");

// ---- Fixtures ----
const DOC = {
    noAssignee:   { id: 1, owner_id: 10, assignee_id: null, status: "Received" },
    unrelated:    { id: 2, owner_id: 10, assignee_id: 99,   status: "Assigned" },
    assigned:     { id: 3, owner_id: 10, assignee_id: 20,   status: "Assigned" },
    processing:   { id: 4, owner_id: 10, assignee_id: 20,   status: "Processing" },
    completed:    { id: 5, owner_id: 10, assignee_id: 20,   status: "Completed" },
    received:     { id: 6, owner_id: 10, assignee_id: 20,   status: "Received" },
};

const USER = {
    admin:       { userId: 1,  roles: ["admin"] },
    officer:     { userId: 2,  roles: ["document_officer"] },
    executive:   { userId: 3,  roles: ["executive"] },
    faculty:     { userId: 20, roles: ["faculty_staff"] },
    responsible: { userId: 20, roles: ["responsible_person"] },
    // ผู้ใช้ที่ไม่ใช่ assignee ของ DOC.assigned
    facultyOther:     { userId: 50, roles: ["faculty_staff"] },
    responsibleOther: { userId: 50, roles: ["responsible_person"] },
};

function access(actor, doc, action, previousAssignee = false) {
    return canAccessDocument({ roles: actor.roles, userId: actor.userId, document: doc, action, previousAssignee });
}

// ---- READ ----
test("V5 READ: admin/officer/executive เห็นเอกสารทุกรายการ แม้ไม่ใช่ assignee", () => {
    for (const actor of [USER.admin, USER.officer, USER.executive]) {
        for (const doc of Object.values(DOC)) {
            assert.equal(access(actor, doc, "read"), true, `${actor.roles[0]} ควรอ่านได้ทุก doc`);
        }
    }
});

test("V5 READ: faculty_staff/responsible_person อ่านได้เฉพาะ Current Assignee", () => {
    // userId=20 เป็น current assignee ของ DOC.assigned
    for (const actor of [USER.faculty, USER.responsible]) {
        assert.equal(access(actor, DOC.assigned, "read"), true, `${actor.roles[0]} (current assignee) อ่านได้`);
    }
});

test("V5 READ: faculty_staff/responsible_person อ่านได้เมื่อเป็น Previous Assignee", () => {
    for (const actor of [USER.facultyOther, USER.responsibleOther]) {
        assert.equal(access(actor, DOC.unrelated, "read", true), true, `${actor.roles[0]} (prev assignee) อ่านได้`);
    }
});

test("V5 READ: faculty_staff/responsible_person อ่านไม่ได้เมื่อไม่เกี่ยวข้อง", () => {
    for (const actor of [USER.facultyOther, USER.responsibleOther]) {
        assert.equal(access(actor, DOC.unrelated, "read"), false, `${actor.roles[0]} (ไม่ใช่ assignee) อ่านไม่ได้`);
    }
});

test("V5 READ: owner_id ไม่ให้สิทธิ์อ่าน (faculty/responsible ที่เป็นแค่ owner)", () => {
    // DOC.noAssignee มี owner_id=10, userId=10 แต่ไม่ใช่ assignee
    const ownerOnly = { userId: 10, roles: ["faculty_staff"] };
    assert.equal(access(ownerOnly, DOC.noAssignee, "read"), false, "owner_id เท่านั้น ต้องอ่านไม่ได้");
    const ownerOnlyR = { userId: 10, roles: ["responsible_person"] };
    assert.equal(access(ownerOnlyR, DOC.noAssignee, "read"), false, "owner_id เท่านั้น ต้องอ่านไม่ได้ (responsible_person)");
});

// ---- UPLOAD ----
test("V5 UPLOAD: admin/officer upload ได้; executive/faculty/responsible upload ไม่ได้", () => {
    assert.equal(access(USER.admin, DOC.assigned, "upload"), true);
    assert.equal(access(USER.officer, DOC.assigned, "upload"), true);
    assert.equal(access(USER.executive, DOC.assigned, "upload"), false);
    assert.equal(access(USER.faculty, DOC.assigned, "upload"), false);
    assert.equal(access(USER.responsible, DOC.assigned, "upload"), false);
});

test("V5 REGISTER: only document_officer can register; admin/executive/others are blocked", () => {
    assert.deepEqual([...ACTION_ROLES.register], ["document_officer"]);
    for (const [actor, expected] of [
        [USER.admin, false],
        [USER.officer, true],
        [USER.executive, false],
        [USER.faculty, false],
        [USER.responsible, false]
    ]) {
        assert.equal(canPerformAction(actor.roles, "register"), expected, actor.roles[0]);
    }
});

// ---- DELETE ----
test("V5 DELETE: เฉพาะ admin; ทุก role อื่น delete ไม่ได้", () => {
    assert.equal(access(USER.admin, DOC.assigned, "delete"), true);
    assert.equal(access(USER.officer, DOC.assigned, "delete"), false);
    assert.equal(access(USER.executive, DOC.assigned, "delete"), false);
    assert.equal(access(USER.faculty, DOC.assigned, "delete"), false);
    assert.equal(access(USER.responsible, DOC.assigned, "delete"), false);
});

// ---- DEADLINE ----
test("V5 DEADLINE: admin/officer แก้ deadline ได้; ทุก role อื่นทำไม่ได้", () => {
    assert.equal(access(USER.admin, DOC.assigned, "deadline"), true);
    assert.equal(access(USER.officer, DOC.assigned, "deadline"), true);
    assert.equal(access(USER.executive, DOC.assigned, "deadline"), false);
    assert.equal(access(USER.faculty, DOC.assigned, "deadline"), false);
    assert.equal(access(USER.responsible, DOC.assigned, "deadline"), false);
});

// ---- ASSIGN ----
test("V5 ASSIGN: admin/officer assign ได้ไม่จำกัด (ไม่ใช่ assignee ก็ได้)", () => {
    assert.equal(access(USER.admin, DOC.unrelated, "assign"), true);
    assert.equal(access(USER.officer, DOC.unrelated, "assign"), true);
});

test("V5 ASSIGN: executive assign ไม่ได้", () => {
    assert.equal(access(USER.executive, DOC.assigned, "assign"), false);
    assert.equal(access(USER.executive, DOC.unrelated, "assign"), false);
});

test("V5 ASSIGN: faculty_staff assign ได้เฉพาะในฐานะ Current Assignee", () => {
    assert.equal(access(USER.faculty, DOC.assigned, "assign"), true,  "current assignee assign ได้");
    assert.equal(access(USER.facultyOther, DOC.assigned, "assign"), false, "ไม่ใช่ assignee assign ไม่ได้");
    // owner_id ไม่ให้สิทธิ์ assign
    const ownerOnly = { userId: 10, roles: ["faculty_staff"] };
    assert.equal(access(ownerOnly, DOC.assigned, "assign"), false, "owner_id เท่านั้น assign ไม่ได้");
});

test("V5 ASSIGN: responsible_person assign ได้เฉพาะในฐานะ Current Assignee", () => {
    assert.equal(access(USER.responsible, DOC.assigned, "assign"), true,  "current assignee assign ได้");
    assert.equal(access(USER.responsibleOther, DOC.assigned, "assign"), false, "ไม่ใช่ assignee assign ไม่ได้");
});

test("V5 ASSIGN: ห้าม assign เอกสาร Completed (ทุก role)", () => {
    assert.equal(access(USER.admin, DOC.completed, "assign"), false);
    assert.equal(access(USER.officer, DOC.completed, "assign"), false);
    assert.equal(access(USER.faculty, DOC.completed, "assign"), false);
    assert.equal(access(USER.responsible, DOC.completed, "assign"), false);
});

// ---- FORWARD ----
test("V5 FORWARD: admin/officer forward ได้ไม่จำกัด", () => {
    assert.equal(access(USER.admin, DOC.assigned, "forward"), true);
    assert.equal(access(USER.officer, DOC.processing, "forward"), true);
});

test("V5 FORWARD: executive forward ไม่ได้", () => {
    assert.equal(access(USER.executive, DOC.assigned, "forward"), false);
});

test("V5 FORWARD: faculty/responsible forward ได้เฉพาะ Current Assignee, เฉพาะสถานะที่ถูกต้อง", () => {
    assert.equal(access(USER.faculty, DOC.assigned, "forward"), true,     "current assignee, Assigned → ได้");
    assert.equal(access(USER.responsible, DOC.processing, "forward"), true, "current assignee, Processing → ได้");
    assert.equal(access(USER.facultyOther, DOC.assigned, "forward"), false, "ไม่ใช่ assignee → ไม่ได้");
    assert.equal(access(USER.responsible, DOC.completed, "forward"), false, "Completed → ไม่ได้");
});

// ---- STATUS ----
test("V5 STATUS: admin/officer เปลี่ยน status ได้ทุกเอกสาร; Completed เปลี่ยนได้เฉพาะ admin", () => {
    assert.equal(access(USER.admin, DOC.assigned, "status"), true);
    assert.equal(access(USER.officer, DOC.assigned, "status"), true);
    assert.equal(access(USER.admin, DOC.completed, "status"), true);
    assert.equal(access(USER.officer, DOC.completed, "status"), false);
});

test("V5 STATUS: executive เปลี่ยน status ไม่ได้", () => {
    assert.equal(access(USER.executive, DOC.assigned, "status"), false);
});

test("V5 STATUS: faculty/responsible เปลี่ยน status ได้เฉพาะ Current Assignee, ห้ามเปลี่ยน Completed", () => {
    assert.equal(access(USER.faculty, DOC.assigned, "status"), true,  "current assignee → ได้");
    assert.equal(access(USER.responsible, DOC.processing, "status"), true, "current assignee → ได้");
    assert.equal(access(USER.facultyOther, DOC.assigned, "status"), false, "ไม่ใช่ assignee → ไม่ได้");
    assert.equal(access(USER.faculty, DOC.completed, "status"), false, "Completed → ไม่ได้ (non-admin)");
    assert.equal(access(USER.responsible, DOC.completed, "status"), false, "Completed → ไม่ได้ (non-admin)");
});

// ---- PREVIOUS ASSIGNEE: read-only ----
test("V5 Previous Assignee: อ่านได้แต่ทำ workflow action ไม่ได้ (faculty/responsible)", () => {
    for (const actor of [USER.facultyOther, USER.responsibleOther]) {
        assert.equal(access(actor, DOC.unrelated, "read", true), true, `${actor.roles[0]} prev assignee อ่านได้`);
        for (const action of ["assign", "forward", "status", "upload", "delete", "deadline"]) {
            assert.equal(access(actor, DOC.unrelated, action, true), false, `${actor.roles[0]} prev assignee ทำ ${action} ไม่ได้`);
        }
    }
});

// ---- OWNER_ID ไม่ให้สิทธิ์ใดๆ ----
test("V5 owner_id ไม่ให้สิทธิ์ในการ assign/forward/status (faculty_staff)", () => {
    // userId=10 เป็น owner ของ DOC.unrelated แต่ไม่ใช่ assignee
    const ownerFaculty = { userId: 10, roles: ["faculty_staff"] };
    assert.equal(access(ownerFaculty, DOC.unrelated, "assign"), false, "owner assign ไม่ได้");
    assert.equal(access(ownerFaculty, DOC.unrelated, "forward"), false, "owner forward ไม่ได้");
    assert.equal(access(ownerFaculty, DOC.unrelated, "status"), false, "owner status ไม่ได้");
    assert.equal(access(ownerFaculty, DOC.unrelated, "read"), false, "owner อ่านไม่ได้");
});

// ---- MULTI-ROLE ----
test("V5 Multi-role: admin + responsible_person ได้สิทธิ์ตาม admin", () => {
    const multiAdmin = { userId: 50, roles: ["admin", "responsible_person"] };
    assert.equal(access(multiAdmin, DOC.unrelated, "assign"), true);
    assert.equal(access(multiAdmin, DOC.unrelated, "delete"), true);
    assert.equal(access(multiAdmin, DOC.unrelated, "read"), true);
});

test("V5 Multi-role: executive + faculty_staff ถูกบล็อกโดย executive สำหรับ workflow action", () => {
    // executive บล็อก assign/forward/status แม้มี faculty_staff ด้วย
    // ตาม logic ใหม่: executive check มาก่อน normalized.some(allowedRoles) แล้ว faculty_staff ผ่าน allowedRoles แต่ executive บล็อก
    const multiExecFaculty = { userId: 20, roles: ["executive", "faculty_staff"] };
    // READ: executive ให้อ่านได้ทุก doc
    assert.equal(access(multiExecFaculty, DOC.unrelated, "read"), true);
    // workflow: executive บล็อก
    assert.equal(access(multiExecFaculty, DOC.assigned, "assign"), false);
    assert.equal(access(multiExecFaculty, DOC.assigned, "forward"), false);
    assert.equal(access(multiExecFaculty, DOC.assigned, "status"), false);
});

test("V5 requireAction middleware blocks unauthorized API calls from roles and mixed executive roles", () => {
    for (const action of ["register", "assign", "forward", "status"]) {
        let nextCalled = false;
        let statusCode = null;
        const middleware = requireAction(action);
        middleware(
            { userRoles: ["executive", "admin"] },
            { status(code) { statusCode = code; return this; }, json() { return this; } },
            () => { nextCalled = true; }
        );
        assert.equal(statusCode, 403, `${action} must be forbidden for executive`);
        assert.equal(nextCalled, false);
    }

    let nextCalled = false;
    requireAction("assign")(
        { userRoles: ["faculty_staff"] },
        { status() { throw new Error("Current assignee should pass the role gate"); } },
        () => { nextCalled = true; }
    );
    assert.equal(nextCalled, true, "resource-level authorization checks Current Assignee");
});
