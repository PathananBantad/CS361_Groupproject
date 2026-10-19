const test = require("node:test");
const assert = require("node:assert/strict");
const { ROLES, canAccessDocument } = require("../documentAuthorization");

const owned = { owner_id: 7, assignee_id: null };
const assigned = { owner_id: null, assignee_id: 7 };
const unrelated = { owner_id: 8, assignee_id: 9 };

test("only configured database roles are recognized", () => {
    assert.deepEqual(ROLES, ["document_officer", "faculty_staff", "case_owner", "admin", "executive"]);
    assert.equal(canAccessDocument({ roles: ["staff"], userId: 7, document: owned }), false);
    assert.equal(canAccessDocument({ roles: ["case_owner", "admin"], userId: 7, document: unrelated }), true);
});

test("document reads scope case owners and faculty staff to related documents", () => {
    for (const role of ["case_owner", "faculty_staff"]) {
        assert.equal(canAccessDocument({ roles: [role], userId: 7, document: owned }), true);
        assert.equal(canAccessDocument({ roles: [role], userId: 7, document: assigned }), true);
        assert.equal(canAccessDocument({ roles: [role], userId: 7, document: unrelated }), false);
    }
    for (const role of ["document_officer", "admin", "executive"]) {
        assert.equal(canAccessDocument({ roles: [role], userId: 7, document: unrelated }), true);
    }
});

test("upload is limited to document officers and admins regardless of document relationship", () => {
    for (const role of ROLES) {
        assert.equal(canAccessDocument({ roles: [role], userId: 7, document: unrelated, action: "upload" }), ["document_officer", "admin"].includes(role));
    }
});

test("status and forwarding require an allowed role and document relationship", () => {
    for (const action of ["status", "forward"]) {
        assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: owned, action }), true);
        assert.equal(canAccessDocument({ roles: ["faculty_staff"], userId: 7, document: unrelated, action }), false);
        assert.equal(canAccessDocument({ roles: ["executive"], userId: 7, document: owned, action }), false);
        assert.equal(canAccessDocument({ roles: ["document_officer"], userId: 7, document: unrelated, action }), true);
    }
});

test("missing identity, unknown action, and invalid role fail closed", () => {
    assert.equal(canAccessDocument({ roles: ["admin"], document: owned }), false);
    assert.equal(canAccessDocument({ roles: ["admin"], userId: 7, document: owned, action: "delete" }), false);
    assert.equal(canAccessDocument({ roles: ["made_up"], userId: 7, document: owned }), false);
});
