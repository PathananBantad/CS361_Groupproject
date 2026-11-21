// Unit tests สำหรับ Audit Trail — เน้น logic ที่ทดสอบได้แบบ pure (ไม่ต่อ DB)
// ครอบคลุม: การกรองข้อมูลลับ (sanitization) และ RBAC การเข้าถึงประวัติ
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    AUDIT_EVENTS,
    AUDIT_EVENT_METADATA,
    sanitizeAuditData,
    verifyAuditTrailAccess
} = require("../auditTrail");

test("AUDIT_EVENTS มีครบ 8 ประเภทเหตุการณ์ รวมการมอบหมายใหม่และ Share Link", () => {
    assert.deepEqual(
        Object.keys(AUDIT_EVENTS).sort(),
        ["ASSIGN", "DOCUMENT_CREATE", "FORWARD", "REASSIGN", "STATUS_CHANGE",
            "SHARE_LINK_CREATE", "SHARE_LINK_OPEN", "SHARE_LINK_REVOKE"].sort()
    );
    for (const event of ["SHARE_LINK_CREATE", "SHARE_LINK_OPEN", "SHARE_LINK_REVOKE"]) {
        assert.ok(AUDIT_EVENT_METADATA[event]?.label_th, `${event} needs metadata`);
    }
    assert.equal(AUDIT_EVENT_METADATA.REASSIGN.label_th, "การมอบหมายเอกสารใหม่");
});

test("sanitizeAuditData ปิดบังฟิลด์ลับ (password, token, secret)", () => {
    const out = sanitizeAuditData({
        username: "staff01",
        password: "p@ss",
        access_token: "abc",
        api_key: "xyz",
        note: "ปกติ"
    });
    assert.equal(out.password, "[REDACTED]");
    assert.equal(out.access_token, "[REDACTED]");
    assert.equal(out.api_key, "[REDACTED]");
    assert.equal(out.username, "staff01"); // ฟิลด์ปกติไม่ถูกแตะ
    assert.equal(out.note, "ปกติ");
});

test("sanitizeAuditData ปิดบัง JWT/Bearer ที่ฝังในข้อความ", () => {
    const out = sanitizeAuditData({
        remark: "token=eyJabcdefghij.eyJklmnopqrst.signature123 should hide"
    });
    assert.match(out.remark, /\[REDACTED_JWT\]/);
});

test("sanitizeAuditData ทำงานแบบ recursive กับ nested object และ array", () => {
    const out = sanitizeAuditData({
        level1: { secret: "s", items: [{ password: "x", ok: "keep" }] }
    });
    assert.equal(out.level1.secret, "[REDACTED]");
    assert.equal(out.level1.items[0].password, "[REDACTED]");
    assert.equal(out.level1.items[0].ok, "keep");
});

test("verifyAuditTrailAccess: admin/executive/document_officer เข้าถึงได้", () => {
    const doc = { owner_id: 99, assignee_id: 99 };
    for (const role of ["admin", "executive", "document_officer"]) {
        assert.equal(verifyAuditTrailAccess({ userId: 1, role }, doc).allowed, true, `${role} ควรเข้าถึงได้`);
    }
});

test("verifyAuditTrailAccess: faculty_staff/responsible_person need current or previous assignment", () => {
    const ownerOnly = { owner_id: 7, assignee_id: null };
    const current = { owner_id: 99, assignee_id: 7 };
    const unrelated = { owner_id: 99, assignee_id: 88 };
    assert.equal(verifyAuditTrailAccess({ userId: 7, role: "faculty_staff" }, ownerOnly).allowed, false);
    assert.equal(verifyAuditTrailAccess({ userId: 7, role: "faculty_staff" }, current).allowed, true);
    assert.equal(verifyAuditTrailAccess({ userId: 7, role: "faculty_staff" }, unrelated).allowed, false);
    assert.equal(verifyAuditTrailAccess({ userId: 7, role: "faculty_staff" }, unrelated, true).allowed, true);
    assert.equal(verifyAuditTrailAccess({ userId: 7, role: "responsible_person" }, current).allowed, true);
});

test("verifyAuditTrailAccess: role ที่ไม่รู้จัก และ unauthenticated ถูกปฏิเสธ", () => {
    // role ที่ไม่อยู่ใน ROLES ต้องถูกปฏิเสธแม้ userId จะตรงกับ assignee
    const doc = { owner_id: 1, assignee_id: 1 };
    assert.equal(verifyAuditTrailAccess({ userId: 1, role: "unknown_role" }, doc).allowed, false);
    assert.equal(verifyAuditTrailAccess({ userId: 777, role: null }, doc).allowed, false);
    assert.equal(verifyAuditTrailAccess(null, doc).allowed, false);
});
