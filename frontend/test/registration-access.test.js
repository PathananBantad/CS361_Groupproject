const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/navbar-profile.js'), 'utf8');
function check(role, page) {
    const link = { hidden: false };
    const form = { hidden: false };
    let redirect;
    const context = {
        document: { readyState: 'complete', getElementById: id => id === 'registerForm' ? form : null, querySelectorAll: () => [link] },
        localStorage: { getItem: key => key === 'docuflow_role' ? role : 'test-user' },
        window: { location: { pathname: '/html/' + page, replace: target => { redirect = target; } } }
    };
    vm.runInNewContext(source, context);
    return { link, form, redirect };
}
test('admin and document officers can see and open registration', () => {
    for (const role of ['admin', 'document_officer']) {
        const result = check(role, 'register.html');
        assert.equal(result.link.hidden, false);
        assert.equal(result.form.hidden, false);
        assert.equal(result.redirect, undefined);
    }
});
test('other roles cannot see registration links or open its form directly', () => {
    for (const role of ['faculty_staff', 'case_owner', 'executive', 'guest', 'unknown']) {
        assert.equal(check(role, 'dashboard.html').link.hidden, true);
        const result = check(role, 'register.html');
        assert.equal(result.form.hidden, true);
        assert.equal(result.redirect, role === 'guest' ? 'login.html' : 'dashboard.html');
    }
});
