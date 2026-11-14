// =====================================================
// สูตร Priority ของ Inbox อาจารย์ (V7, ตาม Feedback อาจารย์) — ใช้ร่วมกันใน #77 / #82
//   1) ปักดาว (document_pins) ก่อนเสมอ
//   2) ต้องดำเนินการ (ขออนุมัติ / มอบหมายงาน / รอการตอบกลับ)
//   3) เพื่อทราบ (ประชาสัมพันธ์ / แจ้งเพื่อทราบ / กำหนดการ / รายงานผล)
//   เสมอกัน → กำหนดส่ง (deadline) ใกล้ก่อน (ไม่มีกำหนดส่งไว้ท้าย) → ยังไม่เปิด (seen_at IS NULL) ก่อน
//   เกินกำหนด = ป้าย (badge) เท่านั้น ไม่ดันลำดับขึ้น
// ประเภทที่ไม่รู้จัก (ไม่อยู่ในรายการ "เพื่อทราบ") นับเป็น "ต้องดำเนินการ" เพื่อไม่ให้งานตกหล่น
// =====================================================

// documents.document_type เก็บค่า value ของฟอร์ม (register.html) ซึ่งเป็นชื่อสั้น เช่น "ขออนุมัติ"
// ส่วนตาราง document_types ใช้ชื่อเต็ม เช่น "เอกสารขออนุมัติ" จึงรับทั้งสองแบบ
const ACTION_REQUIRED_TYPES = Object.freeze([
    "ขออนุมัติ", "มอบหมายงาน", "รอการตอบกลับ",
    "เอกสารขออนุมัติ", "เอกสารมอบหมายงาน", "เอกสารรอการตอบกลับ"
]);

const FOR_INFO_TYPES = Object.freeze([
    "ประชาสัมพันธ์", "แจ้งเพื่อทราบ", "กำหนดการ/การนัดหมาย", "รายงานผล",
    "เอกสารประชาสัมพันธ์", "เอกสารแจ้งเพื่อทราบ", "เอกสารแจ้งกำหนดการ/การนัดหมาย", "เอกสารรายงานผล"
]);

const CATEGORY = Object.freeze({ ACTION: "ACTION", INFO: "INFO" });

function inboxCategory(documentType) {
    return FOR_INFO_TYPES.includes(String(documentType || "").trim()) ? CATEGORY.INFO : CATEGORY.ACTION;
}

function toDayStart(value) {
    if (value == null || value === "") return null;
    const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// deadline เป็น DATE: เกินกำหนดเมื่อวันนี้ > deadline (วันสุดท้ายยังไม่ถือว่าเกิน)
function isOverdue(deadline, now = new Date()) {
    const due = toDayStart(deadline);
    return due != null && toDayStart(now) > due;
}

// comparator สำหรับเรียงใน JS (เช่น หลังดึงข้อมูลแล้ว หรือใน test)
// doc: { is_pinned, document_type, deadline, seen_at, created_at }
function compareInboxPriority(a, b) {
    const pin = Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned));
    if (pin) return pin;
    const rank = d => (inboxCategory(d.document_type) === CATEGORY.ACTION ? 0 : 1);
    const cat = rank(a) - rank(b);
    if (cat) return cat;
    const da = toDayStart(a.deadline), db = toDayStart(b.deadline);
    if (da !== db) {
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
    }
    const unseen = Number(b.seen_at == null) - Number(a.seen_at == null);
    if (unseen) return unseen;
    const ts = v => (v == null ? 0 : new Date(v).getTime() || 0);
    return ts(b.created_at) - ts(a.created_at) || (Number(b.id) || 0) - (Number(a.id) || 0);
}

// ORDER BY ฝั่ง SQL ที่ให้ผลเดียวกับ compareInboxPriority
// pinnedExpr: นิพจน์ที่เป็นจริงเมื่อปักดาว เช่น "p.user_id IS NOT NULL"
// seenExpr:   คอลัมน์ seen_at ของแถวมอบหมายของผู้ดู เช่น "a.seen_at"
function buildInboxOrderBy({ docAlias = "d", pinnedExpr, seenExpr }) {
    if (!pinnedExpr || !seenExpr) throw new Error("pinnedExpr and seenExpr are required");
    const placeholders = FOR_INFO_TYPES.map(() => "?").join(", ");
    return {
        sql: `ORDER BY (${pinnedExpr}) DESC,
            CASE WHEN ${docAlias}.document_type IN (${placeholders}) THEN 1 ELSE 0 END ASC,
            ${docAlias}.deadline IS NULL ASC, ${docAlias}.deadline ASC,
            (${seenExpr} IS NULL) DESC,
            ${docAlias}.created_at DESC, ${docAlias}.id DESC`,
        params: [...FOR_INFO_TYPES]
    };
}

module.exports = {
    ACTION_REQUIRED_TYPES,
    FOR_INFO_TYPES,
    CATEGORY,
    inboxCategory,
    isOverdue,
    compareInboxPriority,
    buildInboxOrderBy
};
