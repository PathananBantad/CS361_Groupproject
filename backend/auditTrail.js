// ============================================================================
// DocuFlow Centralized Audit Trail Module
// ============================================================================
// Module สำหรับบันทึกและตรวจสอบประวัติการดำเนินการ (Audit Trail)
// รองรับการบันทึก: การมอบหมาย (ASSIGN), การส่งต่อ (FORWARD), และการเปลี่ยนสถานะ (STATUS_CHANGE)
// ดึงข้อมูลผู้ดำเนินการและวันเวลาจากฝั่ง Server เท่านั้น และมีระบบกรองข้อมูลลับ (Data Sanitization)
// ============================================================================

const defaultPool = require("./db");

// 1. กำหนดประเภท Event มาตรฐาน (Task 1)
const AUDIT_EVENTS = Object.freeze({
    ASSIGN: "ASSIGN",
    FORWARD: "FORWARD",
    STATUS_CHANGE: "STATUS_CHANGE",
    DOCUMENT_CREATE: "DOCUMENT_CREATE"
});

// คำอธิบายและ Metadata ของแต่ละ Event Type
const AUDIT_EVENT_METADATA = Object.freeze({
    [AUDIT_EVENTS.ASSIGN]: {
        label_th: "การมอบหมายเอกสาร",
        label_en: "Document Assignment",
        icon: "👤",
        color: "blue"
    },
    [AUDIT_EVENTS.FORWARD]: {
        label_th: "การส่งต่อเอกสาร",
        label_en: "Document Forwarding",
        icon: "⏩",
        color: "purple"
    },
    [AUDIT_EVENTS.STATUS_CHANGE]: {
        label_th: "การเปลี่ยนสถานะเอกสาร",
        label_en: "Document Status Change",
        icon: "🔄",
        color: "teal"
    },
    [AUDIT_EVENTS.DOCUMENT_CREATE]: {
        label_th: "การลงทะเบียนเอกสารใหม่",
        label_en: "Document Creation",
        icon: "📄",
        color: "green"
    }
});

// รายการคีย์ข้อมูลลับและข้อมูลความปลอดภัยที่ต้องคัดกรองออก (Task 10)
const SENSITIVE_KEY_PATTERNS = [
    /pass(word)?/i,
    /secret/i,
    /token/i,
    /auth(orization)?/i,
    /api[_-]?key/i,
    /credential/i,
    /cookie/i,
    /session/i,
    /private[_-]?key/i,
    /bearer/i
];

// Regex สำหรับดักจับ Token, JWT และ API Key ในข้อความทั่วไป
const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g;
const BEARER_PATTERN = /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi;
const GENERIC_KEY_PATTERN = /(AKIA[0-9A-Z]{16})|(ghp_[a-zA-Z0-9]{36})/g;

/**
 * ฟังก์ชันทำความสะอาดข้อมูลเพื่อป้องกันรหัสผ่าน, Token และความลับรั่วไหล (Task 10)
 * @param {any} data ข้อมูลที่ต้องการล้าง
 * @param {number} depth ระดับความลึกสูงสุดของ Object (ป้องกัน circular reference)
 * @returns {any} ข้อมูลที่ล้างความลับออกแล้ว
 */
function sanitizeAuditData(data, depth = 0) {
    if (depth > 6) return "[MAX_DEPTH]";
    if (data === null || data === undefined) return null;

    if (typeof data === "string") {
        let clean = data
            .replace(JWT_PATTERN, "[REDACTED_JWT]")
            .replace(BEARER_PATTERN, "[REDACTED_BEARER_TOKEN]")
            .replace(GENERIC_KEY_PATTERN, "[REDACTED_KEY]");
        return clean;
    }

    if (Array.isArray(data)) {
        return data.map((item) => sanitizeAuditData(item, depth + 1));
    }

    if (typeof data === "object") {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
            if (isSensitiveKey) {
                sanitized[key] = "[REDACTED]";
            } else {
                sanitized[key] = sanitizeAuditData(value, depth + 1);
            }
        }
        return sanitized;
    }

    return data;
}

/**
 * ดึงข้อมูลผู้ดำเนินการ (Actor) และ Client IP จาก Server Authentication (Task 5)
 * ป้องกันการปลอมแปลงโดยไม่เชื่อถือค่าที่ Client ส่งมาใน Body
 * @param {import("express").Request} req
 * @returns {{ actorUserId: string, actorUsername: string, actorRole: string, ipAddress: string }}
 */
function extractServerActor(req) {
    const actorUserId = req.userId == null ? "system" : String(req.userId);
    const actorUsername = req.dbUsername || "system";
    const actorRole = req.userRole || "unknown";

    // IP Address จาก Request ของ Server
    const ipAddress =
        (req.headers && req.headers["x-forwarded-for"]
            ? req.headers["x-forwarded-for"].split(",")[0].trim()
            : req.socket?.remoteAddress) || null;

    return {
        actorUserId,
        actorUsername,
        actorRole,
        ipAddress
    };
}

/**
 * กลไกกลางสำหรับบันทึก Audit Event (Task 2, 3, 4, 6, 7)
 * รองรับการทำงานร่วมกับ Database Transaction เพื่อความสอดคล้องของข้อมูล
 *
 * @param {Object} params
 * @param {number|string} params.documentId ID ของเอกสารที่เกี่ยวข้อง
 * @param {string} params.actorUserId ID ของผู้กระทำ (Server-derived)
 * @param {string} [params.actorUsername] ชื่อบัญชีผู้กระทำ (Server-derived)
 * @param {string} [params.actorRole] บทบาทของผู้กระทำ (Server-derived)
 * @param {string} params.eventType ชนิด Event (ASSIGN, FORWARD, STATUS_CHANGE, DOCUMENT_CREATE)
 * @param {Object} [params.beforeState] ข้อมูลก่อนการเปลี่ยนแปลง (Task 6)
 * @param {Object} [params.afterState] ข้อมูลหลังการเปลี่ยนแปลง (Task 6)
 * @param {Object} [params.details] รายละเอียดเพิ่มเติม (เช่น หมายเหตุ, เหตุผล)
 * @param {string} [params.ipAddress] IP ของผู้ดำเนินการ
 * @param {any} [params.connection] Optional database connection สำหรับ Transaction
 * @returns {Promise<Object>} ข้อมูล Audit Trail Record ที่บันทึกสำเร็จ
 */
async function recordAuditEvent({
    documentId,
    actorUserId,
    actorUsername = null,
    actorRole = null,
    eventType,
    beforeState = null,
    afterState = null,
    details = null,
    ipAddress = null,
    connection = null
}) {
    if (!documentId) {
        throw new Error("documentId is required for audit trail recording");
    }
    if (!actorUserId) {
        throw new Error("actorUserId is required for audit trail recording");
    }
    if (!eventType || !AUDIT_EVENTS[eventType]) {
        throw new Error(`Invalid eventType: "${eventType}". Allowed: ${Object.keys(AUDIT_EVENTS).join(", ")}`);
    }

    // ทำความสะอาดข้อมูลความลับก่อนบันทึก (Task 10)
    const sanitizedBefore = beforeState ? sanitizeAuditData(beforeState) : null;
    const sanitizedAfter = afterState ? sanitizeAuditData(afterState) : null;
    const sanitizedDetails = details ? sanitizeAuditData(details) : null;

    const db = connection || defaultPool;

    const [result] = await db.query(
        `INSERT INTO document_audit_trails 
            (document_id, actor_user_id, actor_username, actor_role, event_type, before_state, after_state, details, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
            documentId,
            String(actorUserId),
            actorUsername ? String(actorUsername) : null,
            actorRole ? String(actorRole) : null,
            eventType,
            sanitizedBefore ? JSON.stringify(sanitizedBefore) : null,
            sanitizedAfter ? JSON.stringify(sanitizedAfter) : null,
            sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
            ipAddress || null
        ]
    );

    const auditId = result.insertId;

    return {
        audit_id: auditId,
        document_id: documentId,
        actor_user_id: actorUserId,
        actor_username: actorUsername,
        actor_role: actorRole,
        event_type: eventType,
        before_state: sanitizedBefore,
        after_state: sanitizedAfter,
        details: sanitizedDetails,
        ip_address: ipAddress,
        created_at: new Date()
    };
}

/**
 * ดึงรายการ Audit Trail ของเอกสารตาม ID (Task 8)
 *
 * @param {number|string} documentId
 * @param {Object} [filters]
 * @param {string} [filters.eventType] กรองตาม Event Type
 * @param {string} [filters.startDate] กรองตั้งแต่วันที่ (YYYY-MM-DD)
 * @param {string} [filters.endDate] กรองถึงวันที่ (YYYY-MM-DD)
 * @param {any} [poolOrConn]
 * @returns {Promise<Array>} รายการประวัติที่จัดรูปแบบพร้อมแสดงผล
 */
async function getAuditTrailByDocumentId(documentId, filters = {}, poolOrConn = defaultPool) {
    let sql = `
        SELECT 
            id AS audit_id,
            document_id,
            actor_user_id,
            actor_username,
            actor_role,
            event_type,
            before_state,
            after_state,
            details,
            ip_address,
            created_at AS timestamp
        FROM document_audit_trails
        WHERE document_id = ?
    `;
    const params = [documentId];

    if (filters.eventType && AUDIT_EVENTS[filters.eventType]) {
        sql += " AND event_type = ?";
        params.push(filters.eventType);
    }

    if (filters.startDate) {
        sql += " AND created_at >= ?";
        params.push(filters.startDate);
    }

    if (filters.endDate) {
        sql += " AND created_at <= ?";
        params.push(`${filters.endDate} 23:59:59`);
    }

    sql += " ORDER BY created_at ASC, id ASC";

    const [rows] = await poolOrConn.query(sql, params);

    return rows.map((row) => {
        const meta = AUDIT_EVENT_METADATA[row.event_type] || {
            label_th: row.event_type,
            label_en: row.event_type,
            icon: "📝",
            color: "gray"
        };

        let beforeState = row.before_state;
        let afterState = row.after_state;
        let details = row.details;

        if (typeof beforeState === "string") {
            try { beforeState = JSON.parse(beforeState); } catch { }
        }
        if (typeof afterState === "string") {
            try { afterState = JSON.parse(afterState); } catch { }
        }
        if (typeof details === "string") {
            try { details = JSON.parse(details); } catch { }
        }

        return {
            ...row,
            event_metadata: meta,
            before_state: beforeState,
            after_state: afterState,
            details: details
        };
    });
}

/**
 * ดึงรายการ Audit Trail ทั้งระบบพร้อมระบบแบ่งหน้า สำหรับ Admin/Auditor
 *
 * @param {Object} options
 * @param {number} [options.page=1]
 * @param {number} [options.limit=20]
 * @param {string} [options.eventType]
 * @param {string} [options.actorUserId]
 * @param {string|number} [options.documentId]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {any} [poolOrConn]
 */
async function queryAuditTrails(options = {}, poolOrConn = defaultPool) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
    const offset = (page - 1) * limit;

    let whereClause = "WHERE 1=1";
    const params = [];

    if (options.documentId) {
        whereClause += " AND a.document_id = ?";
        params.push(options.documentId);
    }

    if (options.eventType && AUDIT_EVENTS[options.eventType]) {
        whereClause += " AND a.event_type = ?";
        params.push(options.eventType);
    }

    if (options.actorUserId) {
        whereClause += " AND a.actor_user_id = ?";
        params.push(options.actorUserId);
    }

    if (options.startDate) {
        whereClause += " AND a.created_at >= ?";
        params.push(options.startDate);
    }

    if (options.endDate) {
        whereClause += " AND a.created_at <= ?";
        params.push(`${options.endDate} 23:59:59`);
    }

    const countSql = `SELECT COUNT(*) AS total FROM document_audit_trails a ${whereClause}`;
    const [countRows] = await poolOrConn.query(countSql, params);
    const total = countRows[0].total;

    const listSql = `
        SELECT 
            a.id AS audit_id,
            a.document_id,
            d.reference_no,
            d.subject,
            a.actor_user_id,
            a.actor_username,
            a.actor_role,
            a.event_type,
            a.before_state,
            a.after_state,
            a.details,
            a.ip_address,
            a.created_at AS timestamp
        FROM document_audit_trails a
        LEFT JOIN documents d ON a.document_id = d.id
        ${whereClause}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ? OFFSET ?
    `;

    const [rows] = await poolOrConn.query(listSql, [...params, limit, offset]);

    const enriched = rows.map((row) => {
        let beforeState = row.before_state;
        let afterState = row.after_state;
        let details = row.details;

        if (typeof beforeState === "string") {
            try { beforeState = JSON.parse(beforeState); } catch { }
        }
        if (typeof afterState === "string") {
            try { afterState = JSON.parse(afterState); } catch { }
        }
        if (typeof details === "string") {
            try { details = JSON.parse(details); } catch { }
        }

        return {
            ...row,
            event_metadata: AUDIT_EVENT_METADATA[row.event_type] || {},
            before_state: beforeState,
            after_state: afterState,
            details: details
        };
    });

    return {
        data: enriched,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
}

/**
 * ตรวจสอบสิทธิ์ในการดู Audit Trail ตาม Role Matrix (Task 8)
 *
 * Role Matrix:
 * - admin: ดูได้ทุกเอกสาร และดูประวัติรวมทั้งระบบได้
 * - executive: ดูได้ทุกเอกสาร
 * - document_officer: ดูได้ทุกเอกสารที่รับเข้ามาในระบบ
 * - faculty_staff / staff: ดูได้เฉพาะเอกสารที่ตนเองเกี่ยวข้อง
 * - guest / unauthenticated: ไม่มีสิทธิ์เข้าถึง (403/401)
 *
 * @param {Object} actor { userId, role }
 * @param {Object} document ข้อมูลเอกสาร
 * @returns {{ allowed: boolean, reason?: string }}
 */
function verifyAuditTrailAccess(actor, document) {
    if (!actor || !actor.role) {
        return { allowed: false, reason: "Authentication required" };
    }

    const role = String(actor.role).trim().toLowerCase();
    const userId = String(actor.userId || "");

    // 1. Admin, Executive และ Document Officer สามารถดูประวัติของเอกสารได้ทุกฉบับ
    if (["admin", "executive", "document_officer"].includes(role)) {
        return { allowed: true };
    }

    // 2. หากเป็น faculty_staff ต้องเป็นเจ้าของหรือผู้รับมอบหมายเอกสาร
    if (document) {
        const docOwnerId = document.owner_id ? String(document.owner_id) : null;
        const docAssigneeId = document.assignee_id ? String(document.assignee_id) : null;

        if (docOwnerId === userId || docAssigneeId === userId) {
            return { allowed: true };
        }

    }

    return {
        allowed: false,
        reason: "Access denied: คุณไม่มีสิทธิ์เข้าถึงประวัติการดำเนินการของเอกสารฉบับนี้"
    };
}

module.exports = {
    AUDIT_EVENTS,
    AUDIT_EVENT_METADATA,
    sanitizeAuditData,
    extractServerActor,
    recordAuditEvent,
    getAuditTrailByDocumentId,
    queryAuditTrails,
    verifyAuditTrailAccess
};
