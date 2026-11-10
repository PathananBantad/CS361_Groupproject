const ROLES = Object.freeze([
    "document_officer", "faculty_staff", "responsible_person", "admin", "executive"
]);

const ACTION_ROLES = Object.freeze({
    read: ROLES,
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

function canAccessDocument({ roles, userId, document, action = "read", previousAssignee = false }) {
    const normalized = (Array.isArray(roles) ? roles : [roles])
        .map((role) => String(role || "").trim().toLowerCase())
        .filter((role) => ROLES.includes(role));
    const allowedRoles = ACTION_ROLES[action];
    if (!allowedRoles || !normalized.some((role) => allowedRoles.includes(role)) || userId == null || !document) return false;

    const currentAssignee = document.assignee_id != null && String(document.assignee_id) === String(userId);
    const owner = document.owner_id != null && String(document.owner_id) === String(userId);
    const admin = normalized.includes("admin");
    const officer = normalized.includes("document_officer");
    const faculty = normalized.includes("faculty_staff");
    const executive = normalized.includes("executive");

    if (action === "read") return admin || officer || executive || owner || currentAssignee || previousAssignee;
    if (executive || (previousAssignee && !currentAssignee)) return false;
    if (action === "assign") {
        return document.status !== "Completed" && (admin || officer || currentAssignee || (faculty && owner));
    }
    if (action === "forward" && !["Received", "Assigned", "Processing"].includes(document.status || "Received")) {
        return false;
    }
    if (action === "status" && !admin && document.status === "Completed") return false;
    if (action === "delete" || action === "deadline") return true;
    if (action === "status" && admin) return true;
    return currentAssignee || ((admin || officer || faculty) && owner);
}

module.exports = {
    ROLES,
    ACTION_ROLES,
    mapCognitoGroupsToRoles,
    canAccessDocument
};
