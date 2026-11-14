// Unit tests สูตร Priority ของ Inbox อาจารย์ (V7) — pure ไม่ต่อ DB
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    CATEGORY, inboxCategory, isOverdue, compareInboxPriority, buildInboxOrderBy, FOR_INFO_TYPES
} = require("../inboxPriority");

test("แบ่งประเภทเป็น ต้องดำเนินการ / เพื่อทราบ ตาม Feedback อาจารย์", () => {
    for (const t of ["เอกสารขออนุมัติ", "เอกสารมอบหมายงาน", "เอกสารรอการตอบกลับ"]) {
        assert.equal(inboxCategory(t), CATEGORY.ACTION, t);
    }
    for (const t of ["เอกสารประชาสัมพันธ์", "เอกสารแจ้งเพื่อทราบ", "เอกสารแจ้งกำหนดการ/การนัดหมาย", "เอกสารรายงานผล"]) {
        assert.equal(inboxCategory(t), CATEGORY.INFO, t);
    }
});

test("รับชื่อสั้นที่เก็บจริงใน documents.document_type (value ของฟอร์ม register.html)", () => {
    for (const t of ["ขออนุมัติ", "มอบหมายงาน", "รอการตอบกลับ"]) {
        assert.equal(inboxCategory(t), CATEGORY.ACTION, t);
    }
    for (const t of ["ประชาสัมพันธ์", "แจ้งเพื่อทราบ", "กำหนดการ/การนัดหมาย", "รายงานผล"]) {
        assert.equal(inboxCategory(t), CATEGORY.INFO, t);
    }
});

test("ประเภทที่ไม่รู้จักนับเป็น ต้องดำเนินการ (กันงานตกหล่น)", () => {
    assert.equal(inboxCategory("ประเภทใหม่"), CATEGORY.ACTION);
    assert.equal(inboxCategory(null), CATEGORY.ACTION);
});

test("ปักดาว > ต้องดำเนินการ > เพื่อทราบ", () => {
    const docs = [
        { id: 1, document_type: "เอกสารประชาสัมพันธ์", deadline: "2026-11-15" },
        { id: 2, document_type: "เอกสารขออนุมัติ", deadline: "2026-12-30" },
        { id: 3, document_type: "เอกสารรายงานผล", deadline: "2026-12-30", is_pinned: 1 }
    ];
    assert.deepEqual(docs.sort(compareInboxPriority).map(d => d.id), [3, 2, 1]);
});

test("เสมอกัน: กำหนดส่งใกล้ก่อน, ไม่มีกำหนดส่งไว้ท้าย, แล้วยังไม่เปิดก่อน", () => {
    const t = "เอกสารมอบหมายงาน";
    const docs = [
        { id: 1, document_type: t, deadline: null, seen_at: null },
        { id: 2, document_type: t, deadline: "2026-11-20", seen_at: "2026-11-14 10:00:00" },
        { id: 3, document_type: t, deadline: "2026-11-20", seen_at: null },
        { id: 4, document_type: t, deadline: "2026-11-16", seen_at: "2026-11-14 10:00:00" }
    ];
    assert.deepEqual(docs.sort(compareInboxPriority).map(d => d.id), [4, 3, 2, 1]);
});

test("เกินกำหนดเป็นป้ายเท่านั้น: เอกสาร เพื่อทราบ ที่เกินกำหนด ไม่แซง ต้องดำเนินการ", () => {
    const now = new Date("2026-11-14T09:00:00");
    const overdueInfo = { id: 1, document_type: "เอกสารแจ้งเพื่อทราบ", deadline: "2026-11-01" };
    const action = { id: 2, document_type: "เอกสารขออนุมัติ", deadline: "2026-12-01" };
    assert.equal(isOverdue(overdueInfo.deadline, now), true);
    assert.deepEqual([overdueInfo, action].sort(compareInboxPriority).map(d => d.id), [2, 1]);
});

test("isOverdue: วันครบกำหนดยังไม่เกิน, ไม่มีกำหนดส่งไม่เกิน", () => {
    const now = new Date("2026-11-14T23:59:00");
    assert.equal(isOverdue("2026-11-14", now), false);
    assert.equal(isOverdue("2026-11-13", now), true);
    assert.equal(isOverdue(null, now), false);
});

test("buildInboxOrderBy ต้องระบุ pinnedExpr และ seenExpr (ปฏิเสธเมื่อขาด)", () => {
    assert.throws(() => buildInboxOrderBy({}), /required/);
    const { sql, params } = buildInboxOrderBy({ pinnedExpr: "p.user_id IS NOT NULL", seenExpr: "a.seen_at" });
    assert.match(sql, /^ORDER BY/);
    assert.deepEqual(params, [...FOR_INFO_TYPES]);
});
