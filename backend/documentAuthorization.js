const ROLES = Object.freeze([
    "document_officer", "faculty_staff", "responsible_person", "admin", "executive", "branch_head"
]);

// ลำดับความสำคัญเมื่อผู้ใช้มีหลาย Role (ใช้เลือก Role หลักที่แสดง/บันทึกใน users.role)
const ROLE_PRIORITY = Object.freeze([
    "admin", "executive", "document_officer", "branch_head", "responsible_person", "faculty_staff"
]);

// ชื่อ Cognito Group มาตรฐานของแต่ละ Role (ตรงกับ Group ใน User Pool และ Lambda Post Authentication)
const COGNITO_GROUP_BY_ROLE = Object.freeze({
    admin: "Admin",
    executive: "Executive",
    document_officer: "DocumentReceiver",
    responsible_person: "ResponsiblePerson",
    faculty_staff: "Staff/Instructor",
    branch_head: "BranchHead"
});

const DEFAULT_ROLE = "faculty_staff";

const ACTION_ROLES = Object.freeze({
    read: ROLES,
    head_review: ["branch_head"],
    // ลงทะเบียนเอกสารใหม่ได้เฉพาะ Document Officer เท่านั้น (Role อื่นรวมถึง admin ได้ 403)
    register: ["document_officer"],
    upload: ["document_officer", "admin"],
    status: ["document_officer", "admin", "faculty_staff", "responsible_person"],
    assign: ["document_officer", "admin", "faculty_staff", "responsible_person"],
    deadline: ["document_officer", "admin"],
    forward: ["document_officer", "admin", "faculty_staff", "responsible_person"],
    delete: ["admin"],
    // สร้าง/ดู/ยกเลิก Share Link (ADR #72) — executive อ่านอย่างเดียว จึงถูกตัดออกโดย canPerformAction
    share: ["document_officer", "admin", "faculty_staff", "responsible_person"]
});

function mapCognitoGroupsToRoles(groups) {
    const groupList = Array.isArray(groups)
        ? groups
        : typeof groups === "string"
            ? [groups]
            : [];

    const groupToRole = {
        admin: "admin",
        document_officer: "document_officer",
        documentreceiver: "document_officer",
        "staff/instructor": "faculty_staff",
        faculty_staff: "faculty_staff",
        staff: "faculty_staff",
        instructor: "faculty_staff",
        executive: "executive",
        branchhead: "branch_head",
        branch_head: "branch_head",
        responsibleperson: "responsible_person",
        responsible_person: "responsible_person"
    };

    return [...new Set(
        groupList
            .filter(group => typeof group === "string")
            .map(group => group.trim().toLowerCase())
            .filter(group => Object.hasOwn(groupToRole, group))
            .map(group => groupToRole[group])
            .filter(Boolean)
    )];
}

// เลือก Role หลักตาม ROLE_PRIORITY; ไม่พบ Role ที่รู้จักให้คืน fallback
function resolvePrimaryRole(roles, fallback = DEFAULT_ROLE) {
    const normalized = normalizeRoles(roles);
    return ROLE_PRIORITY.find(role => normalized.includes(role)) || fallback;
}

function cognitoGroupForRole(role) {
    return COGNITO_GROUP_BY_ROLE[role] || COGNITO_GROUP_BY_ROLE[DEFAULT_ROLE];
}

function normalizeRoles(roles) {
    return (Array.isArray(roles) ? roles : [roles])
        .map(role => String(role || "").trim().toLowerCase())
        .filter(role => ROLES.includes(role));
}

function canPerformAction(roles, action) {
    const normalized = normalizeRoles(roles);
    if (!normalized.length || action === "read") return false;
    if (normalized.includes("executive")) return false;

    const allowedRoles = ACTION_ROLES[action];
    return Boolean(allowedRoles && normalized.some(role => allowedRoles.includes(role)));
}

function requireAction(action) {
    return (req, res, next) => {
        const roles = req.userRoles || [req.userRole];
        if (!canPerformAction(roles, action)) {
            return res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
        }
        return next();
    };
}

function canAccessDocument({ roles, userId, document, action = "read", previousAssignee = false, forwardedByViewer = false }) {
    const normalized = normalizeRoles(roles);

    // ตรวจสอบ input พื้นฐาน — ต้องมี roles ที่รู้จัก, userId และ document
    if (!normalized.length || userId == null || !document) return false;

    const currentAssignee = document.assignee_id != null && String(document.assignee_id) === String(userId);
    // ห้ามใช้ owner_id เป็นเกณฑ์ตัดสินสิทธิ์ตาม Permission Matrix V5
    // READ: admin/officer/executive เห็นเอกสารทุกรายการ
    // branch_head เห็นเอกสารทางการและเอกสารที่เป็น Current Assignee
    // faculty_staff/responsible_person เห็นเฉพาะเอกสารที่เป็น Current หรือ Previous Assignee
    if (action === "read") {
        if (normalized.some(role => ["admin", "document_officer", "executive"].includes(role))) return true;
        if (normalized.includes("branch_head") &&
            (document.is_official === 1 || document.is_official === true || currentAssignee)) return true;
        return currentAssignee || previousAssignee;
    }

    if (!canPerformAction(normalized, action)) return false;

    if (action === "head_review") return normalized.includes("branch_head");

    if (!currentAssignee && !normalized.includes("admin") &&
        normalized.includes("document_officer") && (forwardedByViewer || previousAssignee) &&
        ["assign", "forward", "status"].includes(action)) return false;

    // Previous assignees are read-only for workflow actions, regardless of their role.
    if (previousAssignee && !currentAssignee && ["assign", "forward", "status"].includes(action)) return false;

    if (action === "assign") {
        if (document.status === "Completed") return false;
        // admin/officer assign ได้ไม่จำกัด; faculty/responsible assign ได้เฉพาะในฐานะ Current Assignee
        if (normalized.some(role => ["admin", "document_officer"].includes(role))) return true;
        return currentAssignee; // faculty_staff และ responsible_person ต้องเป็น assignee ปัจจุบัน
    }

    if (action === "forward") {
        if (!["Received", "Assigned", "Processing"].includes(document.status || "Received")) return false;
        if (normalized.some(role => ["admin", "document_officer"].includes(role))) return true;
        return currentAssignee; // faculty_staff และ responsible_person ต้องเป็น assignee ปัจจุบัน
    }

    if (action === "status") {
        // เฉพาะ admin เปลี่ยน status ของเอกสาร Completed ได้ (admin override)
        // ให้ตรงกับ PUT /api/documents/:id/status ที่ไม่มี transition ออกจาก Completed สำหรับ non-admin
        if (normalized.includes("admin")) return true;
        if (document.status === "Completed") return false;
        if (normalized.includes("document_officer")) return true;
        return currentAssignee;
    }

    if (action === "share") {
        // admin/officer แชร์ได้ทุกเอกสาร; faculty/responsible แชร์ได้เฉพาะเมื่อเป็น Current Assignee
        // Previous Assignee เป็นอ่านอย่างเดียว จึงแชร์ต่อไม่ได้
        if (normalized.some(role => ["admin", "document_officer"].includes(role))) return true;
        return currentAssignee;
    }

    // upload, deadline: เฉพาะ admin/officer (ถูกกรองจาก ACTION_ROLES แล้ว)
    // delete: เฉพาะ admin (ถูกกรองจาก ACTION_ROLES แล้ว)
    if (action === "upload" || action === "deadline" || action === "delete") {
        return true;
    }

    return false;
}

module.exports = {
    ROLES,
    ROLE_PRIORITY,
    COGNITO_GROUP_BY_ROLE,
    DEFAULT_ROLE,
    resolvePrimaryRole,
    cognitoGroupForRole,
    ACTION_ROLES,
    mapCognitoGroupsToRoles,
    normalizeRoles,
    canPerformAction,
    requireAction,
    canAccessDocument
};
