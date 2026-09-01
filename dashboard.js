/**
 * Data source configuration.
 * ---------------------------------------------------------------
 * For local preview / static hosting this points at the JSON file
 * shipped alongside the site. When the mock data is uploaded to an
 * S3 bucket (e.g. configured for static website hosting or served
 * behind CloudFront), just swap DATA_BASE_URL for the bucket/CDN
 * URL — no other code changes are needed, since every fetch below
 * is a relative path built from this constant.
 *
 * Example:
 *   const DATA_BASE_URL = "https://emailbox-mockdata.s3.ap-southeast-1.amazonaws.com";
 *
 * Note: if this page is opened directly as a file:// URL (double-
 * clicking dashboard.html instead of serving it over http), browsers
 * block fetch() of local files entirely. In that case we fall back
 * to the embedded copy of the same data below so the dashboard still
 * renders correctly.
 */
const S3_BASE_URL = "https://my-project-v1-2026.s3.ap-southeast-2.amazonaws.com";
const DASHBOARD_DATA_URL = "data/dashboard-mock.json";// Demo document files stored in the same S3 bucket.
// Upload these two PDF files to the bucket with the exact names below.
const DOCUMENT_FILE_URLS = {
  "DOC2568/00124":
    "https://my-project-v1-2026.s3.ap-southeast-2.amazonaws.com/data/document-00124-realistic.pdf",

  "DOC2568/00125":
    "https://my-project-v1-2026.s3.ap-southeast-2.amazonaws.com/data/document-00125-realistic.pdf"
};

const DASHBOARD_FALLBACK = {
  "user": {
    "name": "ผู้เยี่ยมชม",
    "role": "เข้าดูโดยไม่เข้าสู่ระบบ",
    "notifications": 0
  },
  "stats": [
    {
      "label": "เอกสารทั้งหมด",
      "value": 200,
      "icon": "file"
    },
    {
      "label": "รอดำเนินการ",
      "value": 24,
      "icon": "clock"
    },
    {
      "label": "ดำเนินการเสร็จสิ้น",
      "value": 156,
      "icon": "check"
    },
    {
      "label": "ส่งออกแล้ว",
      "value": 146,
      "icon": "send"
    }
  ],
  "recentDocuments": [
    {
      "docNo": "DOC2568/00125",
      "trackingNo": "TRK-68-0520-0001",
      "type": "เอกสารประชาสัมพันธ์",
      "fileType": "PDF",
      "sender": "สำนักงานคณะฯ",
      "receiver": "อาจารย์ ดร.สมชาย",
      "status": "Completed",
      "date": "20 พ.ค. 2568 14:30"
    },
    {
      "docNo": "DOC2568/00124",
      "trackingNo": "TRK-68-0520-0002",
      "type": "เอกสารขออนุมัติ",
      "fileType": "PDF",
      "sender": "งานการเงิน",
      "receiver": "น.ส. อารีย์ ใจดี",
      "status": "Received",
      "date": "20 พ.ค. 2568 13:45"
    },
    {
      "docNo": "DOC2568/00123",
      "trackingNo": "TRK-68-0520-0003",
      "type": "เอกสารรายงานผล",
      "fileType": "XLSX",
      "sender": "นักศึกษา",
      "receiver": "อาจารย์ ดร.สมชาย",
      "status": "Processing",
      "date": "20 พ.ค. 2568 11:20"
    },
    {
      "docNo": "DOC2568/00122",
      "trackingNo": "TRK-68-0520-0004",
      "type": "เอกสารแจ้งเพื่อทราบ",
      "fileType": "PDF",
      "sender": "บริษัท เอ็กซ์ จำกัด",
      "receiver": "คณะ/หน่วยงาน",
      "status": "Completed",
      "date": "19 พ.ค. 2568 16:10"
    },
    {
      "docNo": "DOC2568/00121",
      "trackingNo": "TRK-68-0520-0005",
      "type": "เอกสารมอบหมายงาน",
      "fileType": "PPTX",
      "sender": "อาจารย์ ดร.สมชาย",
      "receiver": "คณะ/หน่วยงาน",
      "status": "Assigned",
      "date": "19 พ.ค. 2568 09:15"
    }
  ],
  "workflowSteps": [
    {
      "step": 1,
      "title": "รับเอกสาร",
      "description": "รับเอกสารจากผู้ส่งผ่านช่องทางต่าง ๆ",
      "status": "done"
    },
    {
      "step": 2,
      "title": "ตรวจสอบและลงทะเบียน",
      "description": "ตรวจสอบความถูกต้องและลงทะเบียนเอกสาร",
      "status": "in_progress"
    },
    {
      "step": 3,
      "title": "ส่งต่อผู้เกี่ยวข้อง",
      "description": "ส่งต่อเอกสารไปยังบุคคลหรือหน่วยงานที่เกี่ยวข้อง",
      "status": "pending"
    },
    {
      "step": 4,
      "title": "ดำเนินการตามเรื่อง",
      "description": "ผู้รับผิดชอบดำเนินการและตอบกลับ",
      "status": "pending"
    },
    {
      "step": 5,
      "title": "จัดเก็บ/ปิดเรื่อง",
      "description": "จัดเก็บเอกสารและปิดเรื่อง",
      "status": "pending"
    }
  ],
  "channels": [
    {
      "label": "อิเล็กทรอนิกส์",
      "count": 880
    },
    {
      "label": "กระดาษ",
      "count": 376
    }
  ],

  "requiredInfoChecklist": [
    "ระบุประเภทเอกสารให้ถูกต้อง",
    "ระบุชื่อผู้ส่งและผู้รับให้ครบถ้วน",
    "แนบไฟล์เอกสารในรูปแบบที่รองรับ (PDF, DOCX, XLSX, PPTX)",
    "ระบุเรื่อง/รายละเอียดของเอกสาร",
    "ใส่ช่องทางการติดต่อกลับ (อีเมล/เบอร์โทรศัพท์)"
  ]
};

const ICONS = {
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path>',
  check: '<path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>',
  send: '<path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path>'
};

const CHANNEL_ICONS = {
  "อิเล็กทรอนิกส์": '<path d="M4 4h16v16H4z"></path><path d="M4 7l8 6 8-6"></path>',
  "กระดาษ": '<path d="M6 3h9l3 3v15H6z"></path><path d="M15 3v4h4"></path><path d="M9 12h6M9 16h6"></path>'
};

function svgIcon(pathData, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${pathData}</svg>`;
}

async function loadJSON(file, fallback) {
  try {
    const url = file === "dashboard-mock.json" ? DASHBOARD_DATA_URL : `${S3_BASE_URL}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ไม่สามารถโหลด ${file} ได้ (${res.status})`);
    return await res.json();
  } catch (err) {
    console.warn(`ใช้ข้อมูลสำรอง (fallback) แทนการ fetch ${file}:`, err.message);
    return fallback;
  }
}

function renderStats(stats) {
  const grid = document.getElementById("statGrid");
  grid.innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-icon">${svgIcon(ICONS[s.icon] || ICONS.file, 22)}</div>
      <div>
        <div class="stat-label">${s.label}</div>
        <div class="stat-value">${s.value.toLocaleString("th-TH")}</div>
      </div>
    </div>
  `).join("");
}

function renderDocuments(docs) {
  const body = document.getElementById("docTableBody");
  if (!docs.length) {
    body.innerHTML = `<tr><td colspan="6" class="table-loading">ยังไม่มีเอกสาร</td></tr>`;
    return;
  }
  body.innerHTML = docs.map(d => {
    const fileUrl = d.fileUrl || DOCUMENT_FILE_URLS[d.docNo];
    const fileAction = fileUrl
      ? `<a class="file-view-btn" href="${fileUrl}" target="_blank" rel="noopener noreferrer">ดูไฟล์</a>`
      : `<span class="file-unavailable">—</span>`;

    return `
      <tr>
        <td>
          <span class="doc-no">${d.docNo}</span>
          <span class="doc-track">${d.trackingNo}</span>
        </td>
        <td>
          <div class="doc-type-cell">
            <span class="file-chip">${d.fileType}</span>
            <span>${d.type}</span>
          </div>
        </td>
        <td>${d.sender}</td>
        <td>${d.receiver}</td>
        <td><span class="status-pill status-${d.status}">${d.status}</span></td>
        <td>${d.date}</td>
        <td>${fileAction}</td>
      </tr>
    `;
  }).join("");
}

function renderTimeline(steps) {
  const list = document.getElementById("timelineList");
  list.innerHTML = steps.map(s => `
    <li class="timeline-item">
      <div class="timeline-num">${s.step}</div>
      <div class="timeline-body">
        <h3>${s.title}</h3>
        <p>${s.description}</p>
      </div>
    </li>
  `).join("");
}

function renderStatuses() {
  const list = document.getElementById("statusList");
  const statuses = [
    { label: "Received", description: "ได้รับเอกสารแล้ว" },
    { label: "Assigned", description: "ส่งต่อผู้เกี่ยวข้องแล้ว" },
    { label: "Processing", description: "อยู่ระหว่างดำเนินการ" },
    { label: "Completed", description: "ดำเนินการเสร็จสิ้น" }
  ];
  list.innerHTML = statuses.map(s => `
    <div class="status-item">
      <span class="status-dot"></span>
      <div>
        <strong>${s.label}</strong>
        <span>${s.description}</span>
      </div>
    </div>
  `).join("");
}

function renderChannels(channels) {
  const list = document.getElementById("channelList");
  list.innerHTML = channels.map(c => `
    <li>
      <div class="channel-icon">${svgIcon(CHANNEL_ICONS[c.label] || CHANNEL_ICONS["อิเล็กทรอนิกส์"], 17)}</div>
      <div class="channel-info">
        <div class="channel-name">${c.label}</div>
      </div>
    </li>
  `).join("");
}

function renderChecklist(items) {
  const list = document.getElementById("requiredInfoList");
  list.innerHTML = items.map(item => `
    <li>${svgIcon('<polyline points="20 6 9 17 4 12"></polyline>', 15)} ${item}</li>
  `).join("");
}

function renderUser(user) {
  document.getElementById("userName").textContent = user.name;
  document.getElementById("userRole").textContent = user.role;
  document.getElementById("userAvatar").textContent = user.name.trim().charAt(0);
}

async function initDashboard() {
  const data = await loadJSON("dashboard-mock.json", DASHBOARD_FALLBACK);
  renderUser(data.user);
  renderStats(data.stats);
  renderDocuments(data.recentDocuments);
  renderTimeline(data.workflowSteps);
  renderStatuses();
  renderChannels(data.channels);
  renderChecklist(data.requiredInfoChecklist);

  const pendingCount = data.recentDocuments.filter(d => d.status === "รอดำเนินการ" || d.status === "ระหว่างดำเนินการ").length;
  const navBadge = document.getElementById("navPendingBadge");
  if (navBadge) navBadge.textContent = pendingCount || navBadge.textContent;
}

initDashboard();
