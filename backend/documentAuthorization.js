const ROLES = Object.freeze([
    "document_officer", "faculty_staff", "case_owner", "admin", "executive"
]);

const ACTION_ROLES = Object.freeze({
    read: ROLES,
    upload: ["document_officer", "admin"],
    status: ["document_officer", "case_owner", "admin", "faculty_staff"],
    assign: ["document_officer", "faculty_staff", "case_owner", "admin"],
    forward: ["document_officer", "case_owner", "admin", "faculty_staff"]
});

function canAccessDocument({ roles, userId, document, action = "read" }) {
    const normalized = (Array.isArray(roles) ? roles : [roles])
        .map((role) => String(role || "").trim().toLowerCase())
        .filter((role) => ROLES.includes(role));
    const allowedRoles = ACTION_ROLES[action];
    if (!allowedRoles || !normalized.some((role) => allowedRoles.includes(role)) || userId == null || !document) return false;

    const isRelated = [document.owner_id, document.assignee_id]
        .some((id) => id != null && String(id) === String(userId));

    // The matrix marks document reads as conditional for every role. A global
    // role does not by itself grant access to a document's contents.
    // Document officers may assign any document, but other assignment-capable
    // roles must already be related to it.
    if (action === "assign" && normalized.includes("document_officer")) return true;
    return isRelated;
}

module.exports = { ROLES, ACTION_ROLES, canAccessDocument };
