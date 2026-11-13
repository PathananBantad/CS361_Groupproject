const ROLES = Object.freeze([
    "document_officer", "faculty_staff", "responsible_person", "admin", "executive"
]);

const ACTION_ROLES = Object.freeze({
    read: ROLES,
    register: ["document_officer", "admin"],
    upload: ["document_officer", "admin"],
    status: ["document_officer", "admin", "faculty_staff", "responsible_person"],
    assign: ["document_officer", "admin", "faculty_staff", "responsible_person"],
    deadline: ["document_officer", "admin"],
    forward: ["document_officer", "admin", "faculty_staff", "responsible_person"],
    delete: ["admin"]
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
    // faculty_staff/responsible_person เห็นเฉพาะเอกสารที่เป็น Current หรือ Previous Assignee
    if (action === "read") {
        if (normalized.some(role => ["admin", "document_officer", "executive"].includes(role))) return true;
        return currentAssignee || previousAssignee;
    }

    if (!canPerformAction(normalized, action)) return false;

    if (!currentAssignee && !normalized.includes("admin") &&
        normalized.includes("document_officer") && (forwardedByViewer || previousAssignee) &&
        ["forward", "status"].includes(action)) return false;

    // Previous assignees are read-only unless an officer/admin permission independently applies.
    const privilegedAssigneeRole = normalized.some(role => ["admin", "document_officer"].includes(role));
    if (previousAssignee && !currentAssignee && !privilegedAssigneeRole) return false;

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

    // upload, deadline: เฉพาะ admin/officer (ถูกกรองจาก ACTION_ROLES แล้ว)
    // delete: เฉพาะ admin (ถูกกรองจาก ACTION_ROLES แล้ว)
    if (action === "upload" || action === "deadline" || action === "delete") {
        return true;
    }

    return false;
}

module.exports = {
    ROLES,
    ACTION_ROLES,
    mapCognitoGroupsToRoles,
    normalizeRoles,
    canPerformAction,
    requireAction,
    canAccessDocument
};
