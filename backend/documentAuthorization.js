const ROLES = Object.freeze([
    "document_officer", "faculty_staff", "admin", "executive"
]);

const ACTION_ROLES = Object.freeze({
    read: ROLES,
    upload: ["document_officer", "admin"],
    status: ["document_officer", "admin", "faculty_staff"],
    assign: ["document_officer", "admin"],
    forward: ["document_officer", "admin", "faculty_staff"]
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
        staff: "faculty_staff",
        instructor: "faculty_staff",
        executive: "executive"
    };

    return [...new Set(
        groupList
            .filter(group => typeof group === "string")
            .map(group => groupToRole[group.trim().toLowerCase()])
            .filter(Boolean)
    )];
}

function canAccessDocument({ roles, userId, document, action = "read" }) {
    const normalized = (Array.isArray(roles) ? roles : [roles])
        .map((role) => String(role || "").trim().toLowerCase())
        .filter((role) => ROLES.includes(role));
    const allowedRoles = ACTION_ROLES[action];
    if (!allowedRoles || !normalized.some((role) => allowedRoles.includes(role)) || userId == null || !document) return false;

    // Admin, Executive, and Document Officer have system-wide read/view access to all documents and files
    if (action === "read" && normalized.some((r) => ["admin", "executive", "document_officer"].includes(r))) {
        return true;
    }

    // Document officers and Admins can assign any document across the system
    if (action === "assign" && normalized.some((r) => ["document_officer", "admin"].includes(r))) {
        return true;
    }

    const isRelated = [document.owner_id, document.assignee_id]
        .some((id) => id != null && String(id) === String(userId));

    // Admin has system-wide override to update status
    if (action === "status" && normalized.includes("admin")) return true;

    return isRelated;
}

module.exports = {
    ROLES,
    ACTION_ROLES,
    mapCognitoGroupsToRoles,
    canAccessDocument
};
