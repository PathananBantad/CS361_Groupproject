const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function picker(ok = true) {
    const elements = new Map();
    function create() {
        return { value: '', hidden: false, children: [], listeners: {}, validityMessage: '',
            addEventListener(name, callback) { this.listeners[name] = callback; },
            setCustomValidity(message) { this.validityMessage = message; },
            replaceChildren() { this.children = []; },
            append(child) { this.children.push(child); }
        };
    }
    const element = id => {
        if (!elements.has(id)) elements.set(id, create());
        return elements.get(id);
    };
    const context = vm.createContext({
        document: { getElementById: element, querySelector: () => create(), createElement: create },
        window: { apiFetch: async () => ({ ok, json: async () => ({ data: [
            { id: 42, full_name: 'สมชาย ใจดี', username: 'faculty42' },
            { id: 99, full_name: 'สมหญิง ดีใจ', username: 'faculty99' }
        ] }) }) },
        getApiBaseUrl: () => '/api'
    });
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/register.js'), 'utf8').split('// รายการนามสกุล')[0];
    vm.runInContext(source, context);
    await vm.runInContext('loadAssignees()', context);
    return { element };
}

test('assignee search selects the actual user ID, and editing clears that selection', async () => {
    const { element } = await picker();
    const search = element('assigneeSearch');
    search.value = 'สมชาย';
    search.listeners.input();
    const results = element('assigneeResults');
    assert.equal(results.children.length, 1);
    assert.equal(element('assigneeSelect').value, '');
    assert.ok(search.validityMessage);
    results.children[0].listeners.click();
    assert.equal(element('assigneeSelect').value, '42');
    assert.equal(element('recipient').value, 'สมชาย ใจดี');
    assert.equal(search.validityMessage, '');
    search.value = 'faculty99';
    search.listeners.input();
    assert.equal(element('assigneeSelect').value, '');
    results.children[0].listeners.click();
    assert.equal(element('assigneeSelect').value, '99');
});
test('failed assignee loading provides feedback without assigning a sample account', async () => {
    const { element } = await picker(false);
    assert.match(element('assigneeHint').textContent, /โหลดรายชื่อ/);
    assert.equal(element('assigneeSelect').value, '');
});
