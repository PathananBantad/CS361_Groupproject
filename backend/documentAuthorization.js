const ROLES = Object.freeze([
    "document_officer", "faculty_staff", "case_owner", "admin", "executive"
]);

const ACTION_ROLES = Object.freeze({
    read: ROLES,
    upload: ["document_officer", "admin"],
    status: ["document_officer", "case_owner", "admin", "faculty_staff"],
    assign: ["document_officer", "admin"],
    forward: ["document_officer", "case_owner", "admin", "faculty_staff"]
});

function canAccessDocument({ roles, userId, document, action = "read" }) {
    const normalized = (Array.isArray(roles) ? roles : [roles])
        .map((role) => String(role || "").trim().toLowerCase())
        .filter((role) => ROLES.includes(role));
    const allowedRoles = ACTION_ROLES[action];
    if (!allowedRoles || !normalized.some((role) => allowedRoles.includes(role)) || userId == null) return false;

    if (normalized.some((role) => ["admin", "executive", "document_officer"].includes(role))) return true;
    return [document?.owner_id, document?.assignee_id]
        .some((id) => id != null && String(id) === String(userId));
}

module.exports = { ROLES, ACTION_ROLES, canAccessDocument };
