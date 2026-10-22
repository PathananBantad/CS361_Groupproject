const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function dashboard() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', addEventListener() {}, querySelectorAll() { return []; } });
        return elements.get(id);
    };
    const context = vm.createContext({
        document: { getElementById: element, querySelectorAll: () => [] },
        window: { addEventListener() {}, location: { replace() {} } },
        localStorage: { getItem: () => null },
        Intl, Date, URLSearchParams, setInterval() {}, console
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/dashboard.js'), 'utf8'), context);
    vm.runInContext(`
        todayInThailand = () => '2026-10-23';
        documents = [
            { id: '1', code: 'REF-001', number: 'DOC-1', type: 'ขออนุมัติ', description: 'ใช้ห้องเรียน', sender: 'สมชาย', receiver: 'สมหญิง', rawStatus: 'Received', statusKey: 'received', statusLabel: 'ได้รับเอกสารแล้ว', deadlineDate: '2026-10-22', deadline: '22/10/2569', receivedDateKey: '2026-10-20' },
            { id: '2', code: 'REF-002', number: 'DOC-2', type: 'ประชาสัมพันธ์', description: 'งานประชุม', sender: 'สมชาย', receiver: 'สมหญิง', rawStatus: 'Completed', statusKey: 'completed', statusLabel: 'ดำเนินการเสร็จสิ้น', deadlineDate: '2026-10-22', deadline: '22/10/2569', receivedDateKey: '2026-10-21' },
            { id: '3', code: 'REF-003', number: 'DOC-3', type: 'ขออนุมัติ', description: 'ใช้ห้องเรียน', sender: 'สมชาย', receiver: 'สมหญิง', rawStatus: 'Assigned', statusKey: 'assigned', statusLabel: 'มอบหมายแล้ว', deadlineDate: '2026-10-23', deadline: '23/10/2569', receivedDateKey: '2026-10-23' },
            { id: '4', code: 'REF-004', number: 'DOC-4', type: 'อื่น', description: 'ไม่มีวันครบกำหนด', sender: 'คนอื่น', receiver: 'ผู้รับ', rawStatus: 'Processing', statusKey: 'processing', statusLabel: 'กำลังดำเนินการ', deadlineDate: '', receivedDateKey: '' }
        ];
        renderTable = list => { window.resultIds = list.map(doc => doc.id).join(','); };
        renderMobile = () => {};
    `, context);
    return { context, element, run: code => vm.runInContext(code, context) };
}

test('overdue excludes completed, due today, and missing deadlines', () => {
    const { element, run, context } = dashboard();
    element('filterDeadline').value = 'overdue';
    run('render()');
    assert.equal(context.window.resultIds, '1');
});
test('date range includes both endpoints and combines with subject and status', () => {
    const { element, run, context } = dashboard();
    element('filterFrom').value = '2026-10-20';
    element('filterTo').value = '2026-10-23';
    element('filterSubject').value = 'ห้องเรียน';
    run('currentFilters = new Set(["Assigned"]); render()');
    assert.equal(context.window.resultIds, '3');
    element('filterTo').value = '2026-10-22';
    run('render()');
    assert.equal(context.window.resultIds, '');
});
test('search finds reference, type and Thai or English status', () => {
    for (const [keyword, expected] of [['REF-002', '2'], ['ขออนุมัติ', '1,3'], ['Completed', '2'], ['มอบหมายแล้ว', '3']]) {
        const { element, run, context } = dashboard();
        element('globalSearch').value = keyword;
        run('render()');
        assert.equal(context.window.resultIds, expected);
    }
});
test('structured search combines reference, type, sender and receiver', () => {
    const { element, run, context } = dashboard();
    element('filterReference').value = 'REF-001';
    element('filterType').value = 'อนุมัติ';
    element('filterSender').value = 'สมชาย';
    element('filterReceiver').value = 'สมหญิง';
    run('render()');
    assert.equal(context.window.resultIds, '1');
});

test('database ISO dates retain their calendar day in Thailand', () => {
    const { run } = dashboard();
    assert.equal(run('dateOnly("2026-10-22T17:00:00.000Z")'), '2026-10-23');
    assert.equal(run('dateOnly("2026-10-23")'), '2026-10-23');
});
