const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Read frontend/js/document-modal.js
const modalScript = fs.readFileSync(path.join(__dirname, '../js/document-modal.js'), 'utf8');

test('adminOverrideWrap is visible only for admin and hidden for staff & document officer', () => {
    // Verify using static analysis of renderWorkflowUI logic in document-modal.js
    assert.match(modalScript, /adminOverrideWrap\.hidden\s*=\s*!isAdmin;/, 'adminOverrideWrap must be hidden when user is not admin');
});

test('guest is blocked from opening document modal and dashboard locks action button', () => {
    assert.match(modalScript, /auth\.isGuest\s*\|\|\s*!auth\.hasPermission/, 'openDocumentModal must check guest and block opening');

    const dashboardScript = fs.readFileSync(path.join(__dirname, '../js/dashboard.js'), 'utf8');
    assert.match(dashboardScript, /currentRole\s*===\s*["']guest["']/, 'dashboard must check guest role');
    assert.match(dashboardScript, /ไม่มีสิทธิ์ดู/, 'dashboard must render locked button for guest');
});
