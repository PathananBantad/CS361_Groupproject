const { mapCognitoGroupsToRoles, canAccessDocument } = require('../documentAuthorization');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '✅' : '❌'} ${label} (ได้ ${actual}, ต้องการ ${expected})`);
  ok ? pass++ : fail++;
}

// ---- ทดสอบ mapCognitoGroupsToRoles ----
check('map Admin', JSON.stringify(mapCognitoGroupsToRoles(['Admin'])), JSON.stringify(['admin']));
check('map document_officer', JSON.stringify(mapCognitoGroupsToRoles(['document_officer'])), JSON.stringify(['document_officer']));
check('map DocumentReceiver', JSON.stringify(mapCognitoGroupsToRoles(['DocumentReceiver'])), JSON.stringify(['document_officer']));
check('map Staff/Instructor', JSON.stringify(mapCognitoGroupsToRoles(['Staff/Instructor'])), JSON.stringify(['faculty_staff']));
check('map Executive', JSON.stringify(mapCognitoGroupsToRoles(['Executive'])), JSON.stringify(['executive']));
check('map group แปลกๆ ที่ไม่รู้จัก ต้องถูกกรองทิ้ง', JSON.stringify(mapCognitoGroupsToRoles(['SomeRandomGroup'])), JSON.stringify([]));
check('map string เดี่ยว (ไม่ใช่ array)', JSON.stringify(mapCognitoGroupsToRoles('Admin')), JSON.stringify(['admin']));

// ---- ทดสอบ canAccessDocument ----
const doc = { owner_id: 'user-1', assignee_id: 'user-2' };

// เจ้าหน้าที่รับเอกสาร (document_officer) - ต้อง read ได้ทุกเอกสารแม้ไม่เกี่ยวข้อง
check('document_officer อ่านเอกสารที่ไม่เกี่ยวข้องได้ (system-wide)',
  canAccessDocument({ roles: ['document_officer'], userId: 'user-99', document: doc, action: 'read' }), true);

// Staff/Instructor สามารถ forward เอกสารที่ตนเองได้รับมอบหมายได้ (แต่ forward เอกสารที่ไม่เกี่ยวข้องไม่ได้)
check('faculty_staff forward เอกสารที่ตัวเองเป็น assignee ได้',
  canAccessDocument({ roles: ['faculty_staff'], userId: 'user-2', document: doc, action: 'forward' }), true);
check('faculty_staff forward เอกสารที่ไม่เกี่ยวข้อง ต้องถูกปฏิเสธ',
  canAccessDocument({ roles: ['faculty_staff'], userId: 'user-99', document: doc, action: 'forward' }), false);

// Staff/Instructor เปลี่ยนสถานะเอกสารที่ได้รับมอบหมายได้
check('faculty_staff เปลี่ยน status เอกสารที่ตัวเองเป็น assignee ได้',
  canAccessDocument({ roles: ['faculty_staff'], userId: 'user-2', document: doc, action: 'status' }), true);

// Executive - read ได้ทุกที่ แต่ upload ไม่ได้
check('executive อ่านได้ทุกเอกสาร',
  canAccessDocument({ roles: ['executive'], userId: 'user-99', document: doc, action: 'read' }), true);
check('executive upload ไม่ได้',
  canAccessDocument({ roles: ['executive'], userId: 'user-99', document: doc, action: 'upload' }), false);

// Admin - status เอกสารที่ไม่เกี่ยวข้องได้ (system override)
check('admin เปลี่ยน status เอกสารที่ไม่เกี่ยวข้องได้',
  canAccessDocument({ roles: ['admin'], userId: 'user-99', document: doc, action: 'status' }), true);

// ไม่มี role เลย (เช่น group ไม่ match) - ต้องถูกปฏิเสธทุกอย่าง
check('ไม่มี role ที่ map ได้เลย ต้องถูกปฏิเสธ',
  canAccessDocument({ roles: [], userId: 'user-1', document: doc, action: 'read' }), false);

// ไม่มี document ส่งมา - ต้องถูกปฏิเสธเสมอ (เคสนี้คือจุดที่เคยเตือนเรื่อง upload)
check('ไม่มี document เลย ต้องถูกปฏิเสธ',
  canAccessDocument({ roles: ['admin'], userId: 'user-1', document: null, action: 'read' }), false);

console.log(`\nผ่าน ${pass} / ล้มเหลว ${fail}`);
process.exit(fail > 0 ? 1 : 0);