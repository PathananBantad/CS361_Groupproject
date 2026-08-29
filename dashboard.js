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
const DATA_BASE_URL = "data";

const DASHBOARD_FALLBACK = {
  "user": {
    "name": "น.ส. อารีย์ ใจดี",
    "role": "เจ้าหน้าที่รับเอกสาร",
    "notifications": 3
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
      "delta": "ต้องดำเนินการ",
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
      "type": "หนังสือราชการ",
      "fileType": "PDF",
      "sender": "สำนักงานคณะฯ",
      "receiver": "อาจารย์ ดร.สมชาย",
      "status": "เสร็จสิ้น",
      "date": "20 พ.ค. 2568 14:30"
    },
    {
      "docNo": "DOC2568/00124",
      "trackingNo": "TRK-68-0520-0002",
      "type": "บันทึกข้อความ",
      "fileType": "DOCX",
      "sender": "งานการเงิน",
      "receiver": "น.ส. อารีย์ ใจดี",
      "status": "รอดำเนินการ",
      "date": "20 พ.ค. 2568 13:45"
    },
    {
      "docNo": "DOC2568/00123",
      "trackingNo": "TRK-68-0520-0003",
      "type": "แบบฟอร์ม",
      "fileType": "XLSX",
      "sender": "นักศึกษา",
      "receiver": "อาจารย์ ดร.สมชาย",
      "status": "ระหว่างดำเนินการ",
      "date": "20 พ.ค. 2568 11:20"
    },
    {
      "docNo": "DOC2568/00122",
      "trackingNo": "TRK-68-0520-0004",
      "type": "หนังสือภายนอก",
      "fileType": "PDF",
      "sender": "บริษัท เอ็กซ์ จำกัด",
      "receiver": "คณะ/หน่วยงาน",
      "status": "เสร็จสิ้น",
      "date": "19 พ.ค. 2568 16:10"
    },
    {
      "docNo": "DOC2568/00121",
      "trackingNo": "TRK-68-0520-0005",
      "type": "เอกสารนำเสนอ",
      "fileType": "PPTX",
      "sender": "อาจารย์ ดร.สมชาย",
      "receiver": "คณะ/หน่วยงาน",
      "status": "ยกเลิก",
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
      "title": "เสนอผู้รับผิดชอบ",
      "description": "เสนอเอกสารไปยังผู้รับผิดชอบเรื่อง",
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
  "documentTypeBreakdown": [
    {
      "label": "หนังสือราชการ",
      "percent": 35,
      "count": 440,
      "color": "#7A1F23"
    },
    {
      "label": "บันทึกข้อความ",
      "percent": 25,
      "count": 314,
      "color": "#B5892B"
    },
    {
      "label": "แบบฟอร์ม",
      "percent": 15,
      "count": 188,
      "color": "#3F6C51"
    },
    {
      "label": "หนังสือภายนอก",
      "percent": 15,
      "count": 188,
      "color": "#9C3B41"
    },
    {
      "label": "เอกสารนำเสนอ",
      "percent": 10,
      "count": 126,
      "color": "#D9B968"
    }
  ],
  "channels": [
    {
      "label": "E-mail",
      "percent": 45,
      "count": 566
    },
    {
      "label": "Web Submission",
      "percent": 25,
      "count": 314
    },
    {
      "label": "Upload File",
      "percent": 20,
      "count": 251
    },
    {
      "label": "หน่วยงานภายนอก",
      "percent": 10,
      "count": 125
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
  "E-mail": '<path d="M4 4h16v16H4z"></path><path d="M4 7l8 6 8-6"></path>',
  "Web Submission": '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"></path>',
  "Upload File": '<path d="M12 3v12"></path><path d="M7 8l5-5 5 5"></path><path d="M4 21h16"></path>',
  "หน่วยงานภายนอก": '<path d="M3 21h18"></path><path d="M6 21V8l6-4 6 4v13"></path><path d="M10 21v-6h4v6"></path>'
};

function svgIcon(pathData, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${pathData}</svg>`;
}

async function loadJSON(file, fallback) {
  try {
    const res = await fetch(`${DATA_BASE_URL}/${file}`);
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
        <div class="stat-delta">${s.delta}</div>
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
  body.innerHTML = docs.map(d => `
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
    </tr>
  `).join("");
}

function renderTimeline(steps) {
  const list = document.getElementById("timelineList");
  const statusLabel = { done: "เสร็จสิ้น", in_progress: "กำลังดำเนินการ", pending: "รอดำเนินการ" };
  const statusIcon = {
    done: svgIcon('<polyline points="20 6 9 17 4 12"></polyline>', 12),
    in_progress: svgIcon('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path>', 12),
    pending: svgIcon('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path>', 12)
  };
  list.innerHTML = steps.map(s => `
    <li class="timeline-item ${s.status}">
      <div class="timeline-num">${s.status === "done" ? svgIcon('<polyline points="20 6 9 17 4 12"></polyline>', 14) : s.step}</div>
      <div class="timeline-body">
        <h3>${s.title}</h3>
        <p>${s.description}</p>
        <span class="timeline-status ${s.status}">${statusIcon[s.status]} ${statusLabel[s.status]}</span>
      </div>
    </li>
  `).join("");
}

function renderDonut(breakdown) {
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  let acc = 0;
  const stops = breakdown.map(b => {
    const start = acc;
    acc += b.percent;
    return `${b.color} ${start}% ${acc}%`;
  }).join(", ");

  const chart = document.getElementById("donutChart");
  chart.style.background = `conic-gradient(${stops})`;
  document.getElementById("donutTotal").textContent = total.toLocaleString("th-TH");

  const legend = document.getElementById("breakdownLegend");
  legend.innerHTML = breakdown.map(b => `
    <li>
      <span class="legend-dot" style="background:${b.color}"></span>
      ${b.label}
      <span class="pct">${b.percent}% (${b.count})</span>
    </li>
  `).join("");
}

function renderChannels(channels) {
  const list = document.getElementById("channelList");
  list.innerHTML = channels.map(c => `
    <li>
      <div class="channel-icon">${svgIcon(CHANNEL_ICONS[c.label] || CHANNEL_ICONS["E-mail"], 17)}</div>
      <div class="channel-info">
        <div class="channel-name">${c.label}</div>
        <div class="channel-bar"><div class="channel-bar-fill" style="width:${c.percent}%"></div></div>
      </div>
      <div class="channel-pct">${c.percent}% (${c.count})</div>
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
  document.getElementById("notifCount").textContent = user.notifications;
}

async function initDashboard() {
  const data = await loadJSON("dashboard-mock.json", DASHBOARD_FALLBACK);
  renderUser(data.user);
  renderStats(data.stats);
  renderDocuments(data.recentDocuments);
  renderTimeline(data.workflowSteps);
  renderDonut(data.documentTypeBreakdown);
  renderChannels(data.channels);
  renderChecklist(data.requiredInfoChecklist);

  const pendingCount = data.recentDocuments.filter(d => d.status === "รอดำเนินการ" || d.status === "ระหว่างดำเนินการ").length;
  const navBadge = document.getElementById("navPendingBadge");
  if (navBadge) navBadge.textContent = pendingCount || navBadge.textContent;
}

initDashboard();
