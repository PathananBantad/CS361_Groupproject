// Scroll-reveal for sections
const reveals = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  });
}, { threshold: .12 });
reveals.forEach(el => io.observe(el));

// Document types: fetched from data/document-types.json (mock data,
// structured so this URL can be swapped for an S3/CDN URL later).
// If the page is opened directly as a file:// URL, browsers block
// fetch() of local files — in that case we fall back to the copy
// embedded below so the page still renders correctly offline.
const DOC_TYPES_URL =
  "https://my-project-v1-2026.s3.ap-southeast-2.amazonaws.com/data/document-types.json";
const DOC_TYPES_FALLBACK = [
  {
    "document_type": "เอกสารประชาสัมพันธ์",
    "description": "เอกสารที่ใช้สำหรับประชาสัมพันธ์ข้อมูลหรือกิจกรรมให้บุคลากรและนักศึกษาทราบ",
    "example": "บริษัทภายนอกฝากประชาสัมพันธ์การแข่งขัน Hackathon",
    "required_information": [
      "หน่วยงานผู้รับ",
      "หน่วยงานผู้ส่ง",
      "เลขที่หนังสือ",
      "วันที่ส่งเอกสาร",
      "วันที่รับเอกสาร",
      "เรื่อง",
      "ประเภทเอกสาร",
      "ไฟล์เอกสาร"
    ]
  },
  {
    "document_type": "เอกสารขออนุมัติ",
    "description": "เอกสารที่ใช้ขออนุมัติการดำเนินการ สถานที่ หรืองบประมาณจากผู้มีอำนาจ",
    "example": "ขอใช้สถานที่ห้องเรียนเพื่อทำกิจกรรมชมรม",
    "required_information": [
      "หน่วยงานผู้รับ",
      "หน่วยงานผู้ส่ง",
      "เลขที่หนังสือ",
      "วันที่ส่งเอกสาร",
      "วันที่รับเอกสาร",
      "เรื่อง",
      "ประเภทเอกสาร",
      "ไฟล์เอกสาร",
      "ต้องลงนามอนุมัติ"
    ]
  },
  {
    "document_type": "เอกสารมอบหมายงาน",
    "description": "เอกสารที่ใช้มอบหมายภารกิจหรือหน้าที่ให้บุคคลหรือคณะกรรมการดำเนินการ",
    "example": "มอบหมายให้คณะกรรมการไปลงพื้นที่เพื่อตรวจสอบ",
    "required_information": [
      "หน่วยงานผู้รับ",
      "หน่วยงานผู้ส่ง",
      "เลขที่หนังสือ",
      "วันที่ส่งเอกสาร",
      "วันที่รับเอกสาร",
      "เรื่อง",
      "ประเภทเอกสาร",
      "ผู้รับผิดชอบ",
      "กำหนดการหรือ Deadline",
      "ไฟล์เอกสาร"
    ]
  },
  {
    "document_type": "เอกสารแจ้งเพื่อทราบ",
    "description": "เอกสารที่แจ้งข้อมูลหรือเหตุการณ์ให้ผู้เกี่ยวข้องรับทราบ โดยไม่ต้องดำเนินการตอบกลับ",
    "example": "แจ้งว่าจะมีการพ่นไล่ยุงบริเวณอาคารที่กำหนด",
    "required_information": [
      "หน่วยงานผู้รับ",
      "หน่วยงานผู้ส่ง",
      "เลขที่หนังสือ",
      "วันที่ส่งเอกสาร",
      "วันที่รับเอกสาร",
      "เรื่อง",
      "ประเภทเอกสาร",
      "ไฟล์เอกสาร"
    ]
  },
  {
    "document_type": "เอกสารรอการตอบกลับ",
    "description": "เอกสารที่ต้องการคำตอบ การยืนยัน หรือการตอบรับจากผู้รับก่อนดำเนินการขั้นต่อไป",
    "example": "การเรียนเชิญบุคคลภายนอกมาเป็นวิทยากร",
    "required_information": [
      "หน่วยงานผู้รับ",
      "หน่วยงานผู้ส่ง",
      "เลขที่หนังสือ",
      "วันที่ส่งเอกสาร",
      "วันที่รับเอกสาร",
      "เรื่อง",
      "ประเภทเอกสาร",
      "กำหนดการหรือ Deadline",
      "ไฟล์เอกสาร"
    ]
  },
  {
    "document_type": "เอกสารแจ้งกำหนดการ/การนัดหมาย",
    "description": "เอกสารที่แจ้งวัน เวลา และสถานที่ของกิจกรรมหรือการนัดหมายให้ผู้เกี่ยวข้องทราบ",
    "example": "แจ้งว่ามีการนัดหมายให้ไปที่นี่เวลานี้",
    "required_information": [
      "หน่วยงานผู้รับ",
      "หน่วยงานผู้ส่ง",
      "เลขที่หนังสือ",
      "วันที่ส่งเอกสาร",
      "วันที่รับเอกสาร",
      "เรื่อง",
      "ประเภทเอกสาร",
      "กำหนดการหรือ Deadline",
      "ไฟล์เอกสาร"
    ]
  },
  {
    "document_type": "เอกสารรายงานผล",
    "description": "เอกสารที่รายงานผลการดำเนินงาน การปฏิบัติงาน หรือการปรับปรุงกระบวนการ",
    "example": "รายงานผลการปรับรูปแบบการสอน",
    "required_information": [
      "หน่วยงานผู้รับ",
      "หน่วยงานผู้ส่ง",
      "เลขที่หนังสือ",
      "วันที่ส่งเอกสาร",
      "วันที่รับเอกสาร",
      "เรื่อง",
      "ประเภทเอกสาร",
      "ไฟล์เอกสาร"
    ]
  }
];

const DOC_ICONS = [
  '<path d="M3 11l18-5v12L3 14v-3z"></path><path d="M11.6 16.8a3 3 0 1 1-5.2-3"></path>',
  '<path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>',
  '<path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"></path><path d="M13 21h6a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2z"></path>',
  '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path>',
  '<path d="M4 4h16v16H4z"></path><path d="M4 7l8 6 8-6"></path>',
  '<circle cx="6" cy="6" r="2.4"></circle><circle cx="18" cy="18" r="2.4"></circle><path d="M8.2 6h5.8a4 4 0 0 1 4 4v4"></path>',
  '<path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path>'
];

function docCardHTML(doc, index) {
  const iconPath = DOC_ICONS[index % DOC_ICONS.length];
  const reqList = doc.required_information.map(item => `<li>${item}</li>`).join('');
  return `
    <div class="doc-card">
      <div class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconPath}</svg></div>
      <h3>${doc.document_type}</h3>
      <p>${doc.description}</p>
      <p class="example">เช่น ${doc.example}</p>
      <details>
        <summary>ข้อมูลที่ต้องเตรียม (${doc.required_information.length})</summary>
        <ul class="required-list">${reqList}</ul>
      </details>
    </div>
  `;
}

async function loadDocumentTypes() {
  const grid = document.getElementById('docGrid');
  if (!grid) return;
  let docTypes;
  try {
    const res = await fetch(DOC_TYPES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    docTypes = await res.json();
  } catch (err) {
    // fetch() can't reach local files over file:// or the request
    // otherwise failed — use the embedded copy of the same data instead.
    console.warn('ใช้ข้อมูลสำรอง (fallback) แทนการ fetch:', err.message);
    docTypes = DOC_TYPES_FALLBACK;
  }
  grid.innerHTML = docTypes.map(docCardHTML).join('');
}

loadDocumentTypes();
