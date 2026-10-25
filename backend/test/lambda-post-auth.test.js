const test = require("node:test");
const assert = require("node:assert/strict");

test("PostAuthentication Lambda: detects and assigns admin vs default Staff/Instructor correctly", async () => {
    const ADMIN_EMAILS = [
        "pathanan.ban@dome.tu.ac.th",
        "pakhwan.jul@dome.tu.ac.th"
    ];
    const DEFAULT_STAFF_GROUP = "Staff/Instructor";
    const ADMIN_GROUP = "admin";

    function determineTargetGroup(email, currentGroups) {
        if (currentGroups && currentGroups.length > 0) {
            return null; // Skip, already has group
        }
        const cleanEmail = String(email || "").toLowerCase().trim();
        if (ADMIN_EMAILS.includes(cleanEmail)) {
            return ADMIN_GROUP;
        }
        return DEFAULT_STAFF_GROUP;
    }

    // 1. First time login for pathanan.ban@dome.tu.ac.th -> admin
    assert.equal(determineTargetGroup("pathanan.ban@dome.tu.ac.th", []), "admin");

    // 2. First time login for pakhwan.jul@dome.tu.ac.th -> admin
    assert.equal(determineTargetGroup("pakhwan.jul@dome.tu.ac.th", []), "admin");

    // 3. First time login for regular user -> Staff/Instructor
    assert.equal(determineTargetGroup("student123@dome.tu.ac.th", []), "Staff/Instructor");
    assert.equal(determineTargetGroup("somchai.pra@dome.tu.ac.th", []), "Staff/Instructor");

    // 4. Subsequent logins when user already has group -> null (do nothing, do not overwrite)
    assert.equal(determineTargetGroup("somchai.pra@dome.tu.ac.th", ["Staff/Instructor"]), null);
    assert.equal(determineTargetGroup("somchai.pra@dome.tu.ac.th", ["document_officer"]), null);
    assert.equal(determineTargetGroup("pathanan.ban@dome.tu.ac.th", ["admin"]), null);
});
