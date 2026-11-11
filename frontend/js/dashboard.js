/* =====================================================
   DASHBOARD & DOCUMENT REGISTRY
   DocuFlow Electronic Mailbox & Document Flow System
   (โมดูลจัดการตารางทะเบียนเอกสาร ตัวกรอง และการสลับสิทธิ์)
===================================================== */

const tableBody = document.getElementById("documentTableBody");
const mobileList = document.getElementById("mobileList");
const globalSearch = document.getElementById("globalSearch");
const typeFilter = document.getElementById("filterType");
const urgencyFilter = document.getElementById("filterUrgency");
const shownCount = document.getElementById("shownCount");

// Role Selector Elements
const roleMenuBtn = document.getElementById("roleMenuBtn");
const roleDropdown = document.getElementById("roleDropdown");
const userRoleDot = document.getElementById("userRoleDot");
const userRoleDisplay = document.getElementById("userRoleDisplay");

let documents = [];
let currentFilters = new Set(["all"]);
let selectedUrgency = "";
let sortKey = null;
let sortDirection = 1;

// บทบาทผู้ใช้ปัจจุบัน (staff, admin, guest) สำหรับตรวจสอบสิทธิ์
let currentRole = null;
let currentUsername = null;

// Helper เพื่อหา API Base URL
function getApiBaseUrl() {
    // ใช้ฟังก์ชันกลางจาก cognito-config.js (ตรวจ Local จาก hostname ไม่ใช่แค่ port 3000)
    if (typeof window.resolveApiBaseUrl === "function") {
        return window.resolveApiBaseUrl();
    }
    const base = window.API_BASE_URL || "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";
    return base.endsWith("/api") ? base : `${base}/api`;
}

/* =====================================================
   ROLE & PERMISSION MANAGEMENT
===================================================== */
function initRoleManagement() {
    if (typeof window.initNavbarProfile === "function") {
        window.initNavbarProfile();
        return;
    }
    updateRoleUI();

    if (roleMenuBtn && roleDropdown) {
        roleMenuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isExpanded = roleMenuBtn.getAttribute("aria-expanded") === "true";
            roleMenuBtn.setAttribute("aria-expanded", !isExpanded);
            roleDropdown.hidden = isExpanded;
        });

        document.addEventListener("click", (e) => {
            if (!roleMenuBtn.contains(e.target) && !roleDropdown.contains(e.target)) {
                roleMenuBtn.setAttribute("aria-expanded", "false");
                roleDropdown.hidden = true;
            }
        });

        // ซ่อนตัวเลือกสลับ Role แต่คงปุ่ม Logout ไว้
        roleDropdown.querySelectorAll(".role-option").forEach(btn => {
            if (btn.id !== "logoutBtn") {
                btn.hidden = true;
                btn.style.display = "none";
            }
        });

        const logoutBtn = document.getElementById("logoutBtn");

        if (logoutBtn) {
            logoutBtn.addEventListener("click", () => {
                localStorage.removeItem("docuflow_role");
                localStorage.removeItem("docuflow_user");
                localStorage.removeItem("docuflow_access_token");
                localStorage.removeItem("docuflow_id_token");
                localStorage.removeItem("access_token");
                localStorage.removeItem("id_token");

                window.location.href = "login.html";
            });
        }
    }
}

function setUserRole(role, user) {
    // ไม่อนุญาตให้เปลี่ยน Role จากฝั่ง Frontend
    console.warn(
        "Role switching is disabled. User role is managed by the server."
    );
}

// Expose ให้โมดูลอื่นเรียกใช้ได้
window.setUserRole = setUserRole;

function updateRoleUI() {
    if (!userRoleDisplay || !userRoleDot) return;

    const roleLabels = {
        admin: "ผู้ดูแลระบบ (Admin)",
        document_officer: "เจ้าหน้าที่รับเอกสาร",
        faculty_staff: "อาจารย์ / บุคลากร",
        staff: "อาจารย์ / บุคลากร",
        executive: "ผู้บริหาร",
        responsible_person: "ผู้รับผิดชอบเรื่อง",
        guest: "ผู้ใช้ทั่วไป"
    };

    const roleLabel = roleLabels[currentRole] || currentRole || "ไม่ระบุบทบาท";

    userRoleDot.className = "profile-icon";

    if (currentRole === "admin") {
        userRoleDot.classList.add("role-admin");
    } else if (currentRole === "executive") {
        userRoleDot.classList.add("role-executive");
    } else if (currentRole === "document_officer") {
        userRoleDot.classList.add("role-officer");
    } else if (currentRole === "guest") {
        userRoleDot.classList.add("role-guest");
    } else {
        userRoleDot.classList.add("role-staff");
    }

    const displayText = `${roleLabel} (${currentUsername || "-"})`;
    userRoleDisplay.textContent = displayText;
    userRoleDisplay.title = displayText;
    if (roleMenuBtn) {
        roleMenuBtn.title = `${displayText} (คลิกเพื่อดูข้อมูลผู้ใช้และออกจากระบบ)`;
    }
}

/* =====================================================
   FETCH DOCUMENTS
===================================================== */
async function fetchDocuments() {
    const params = new URLSearchParams();

    const apiBase = getApiBaseUrl();
    // Guest ต้องไม่แนบ Token ใด ๆ เพื่อให้ backend ปล่อยผ่านในฐานะ Guest (ป้องกัน 401 จาก Token เก่าที่ค้างอยู่)
    const isGuest = currentRole === "guest";
    const token = isGuest ? "" : (localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token") || localStorage.getItem("docuflow_id_token") || localStorage.getItem("id_token") || "");

    try {
        const headers = {};
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await window.apiFetch(`${apiBase}/documents?${params.toString()}`, { headers });

        if (!response.ok) {
            throw new Error(`เซิร์ฟเวอร์ตอบกลับรหัสข้อผิดพลาด: ${response.status}`);
        }

        const data = await response.json();
        const rows = Array.isArray(data) ? data : (data.documents || data.data || []);

        const V3_STATUS_CONFIG = {
            Received: { key: "received", label: "ได้รับเอกสารแล้ว", color: "teal", step: 1 },
            Assigned: { key: "assigned", label: "มอบหมายแล้ว", color: "orange", step: 2 },
            Processing: { key: "processing", label: "กำลังดำเนินการ", color: "blue", step: 3 },
            Completed: { key: "completed", label: "ดำเนินการเสร็จสิ้น", color: "green", step: 4 }
        };

        documents = rows.map(row => {
            if (isGuest) row = { reference_no: row.reference_no, status: row.status };
            const rawStatus = row.status || "Received";
            const cfg = V3_STATUS_CONFIG[rawStatus] || {
                key: rawStatus.toLowerCase(),
                label: rawStatus,
                color: "gray",
                step: 1
            };

            // วันที่รับ: แสดงวันที่ลงรับ (receive_date) หรือวันที่สร้างเอกสาร (created_at)
            let receivedDate = "-";
            const dateValue = row.receive_date || row.created_at || row.received_at;
            if (dateValue) {
                if (typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue.trim())) {
                    const [y, m, d] = dateValue.trim().split("-").map(Number);
                    receivedDate = new Date(y, m - 1, d).toLocaleDateString("th-TH");
                } else {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime())) {
                        receivedDate = date.toLocaleDateString("th-TH");
                    }
                }
            }

            // เวลาที่ลงทะเบียน: ดึงจาก created_at ซึ่งเป็นเวลาจริงที่บันทึกเอกสารลงระบบ (ไม่ใช้ receive_date เพราะเป็นแค่วันที่ไม่มีเวลา ป้องกันการเพี้ยนเป็น 07:00)
            let receivedTime = "-";
            const timeValue = row.created_at || row.registered_at;
            if (timeValue) {
                const timeStr = String(timeValue).trim();
                // ถ้าเป็น date-only string (ไม่มีเวลา) จะไม่นำมาคำนวณเวลาเพื่อกันการเพี้ยนเป็น 07:00
                if (!/^\d{4}-\d{2}-\d{2}$/.test(timeStr)) {
                    const timeDate = new Date(timeStr.includes(" ") && !timeStr.includes("T") ? timeStr.replace(" ", "T") : timeStr);
                    if (!isNaN(timeDate.getTime())) {
                        receivedTime = timeDate.toLocaleTimeString("th-TH", {
                            hour: "2-digit",
                            minute: "2-digit"
                        });
                    }
                }
            }

            // ชื่อไฟล์เดิม
            let originalFileName = row.display_file_name || row.file_name;
            if (!originalFileName && row.file_key) {
                const parts = row.file_key.split("/");
                const last = parts[parts.length - 1];
                const dash = last.indexOf("-");
                originalFileName = dash !== -1 ? last.substring(dash + 1) : last;
            }

            function safeFormatDate(val) {
                if (!val) return "-";
                if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
                    const [y, m, d] = val.trim().split("-").map(Number);
                    return new Date(y, m - 1, d).toLocaleDateString("th-TH");
                }
                const d = new Date(val);
                if (isNaN(d.getTime())) return "-";
                return d.toLocaleDateString("th-TH");
            }

            return {
                id: String(row.id),
                number: row.document_number || "-",
                code: row.reference_no || "-",
                type: row.document_type || "-",
                description: row.subject || row.remarks || "-",
                sender: row.sender_name || "-",
                sender_dept: row.sender_department || "-",
                sender_contact: row.sender_contact || "-",
                receiver: row.receiver_name || "-",
                assignee_id: row.assignee_id || null,
                assignee_username: row.assignee_username || null,
                assignee_full_name: row.assignee_full_name || null,
                owner_id: row.owner_id || null,
                owner_username: row.owner_username || null,
                owner_full_name: row.owner_full_name || null,
                creator_username: row.creator_username || null,
                send_date: safeFormatDate(row.sent_date),
                receive_date: safeFormatDate(row.receive_date),
                deadline: safeFormatDate(row.deadline),
                deadlineDate: dateOnly(row.deadline),
                receivedDateKey: dateOnly(row.receive_date || row.received_at || row.created_at),
                remarks: row.remarks || "-",
                channel: row.receiving_channel || "-",
                rawStatus: rawStatus,
                statusKey: cfg.key,
                statusLabel: cfg.label,
                statusStep: cfg.step,
                color: cfg.color,
                receivedDate: receivedDate,
                receivedTime: receivedTime,
                file_key: row.file_key || null,
                file_name: originalFileName || null,
                file_size: row.file_size || null,
                mime_type: row.mime_type || null,
                raw: row
            };
        });

        // บันทึกใน window เพื่อให้ document-modal.js ดึงข้อมูลได้
        window.docuflowDocuments = documents;

        render();

    } catch (error) {
        console.error("Fetch documents error:", error);
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-table">
                        ไม่สามารถโหลดข้อมูลเอกสารได้: ${escapeHtml(error.message)}
                    </td>
                </tr>
            `;
        }
        if (mobileList) {
            mobileList.innerHTML = `<div class="empty-table">ไม่สามารถโหลดข้อมูลเอกสารได้</div>`;
        }
    }
}

// Date-only deadlines expire after the end of that day in Thailand.
function dateOnly(value) {
    if (!value) return "";
    const text = String(value);
    if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
        const date = new Date(text);
        if (Number.isNaN(date.getTime())) return "";
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
        const get = type => parts.find(part => part.type === type).value;
        return `${get("year")}-${get("month")}-${get("day")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return "";
}
function todayInThailand() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
}
function isOverdue(doc, today = todayInThailand()) {
    return Boolean(doc.deadlineDate && doc.rawStatus !== "Completed" && doc.deadlineDate < today);
}
function deadlineLabel(doc) {
    if (!doc.deadlineDate) return "";
    return `<small class="deadline-label ${isOverdue(doc) ? "deadline-overdue" : ""}">ครบกำหนด: ${escapeHtml(doc.deadline)}${isOverdue(doc) ? " • เกินกำหนด" : ""}</small>`;
}

/* =====================================================
   RENDER
===================================================== */
function render() {
    let result = [...documents];
    const keyword = globalSearch ? globalSearch.value.trim().toLowerCase() : "";

    if (keyword) {
        result = result.filter(doc => (
            doc.number.toLowerCase().includes(keyword) ||
            doc.code.toLowerCase().includes(keyword) ||
            doc.type.toLowerCase().includes(keyword) ||
            doc.description.toLowerCase().includes(keyword) ||
            doc.sender.toLowerCase().includes(keyword) ||
            doc.receiver.toLowerCase().includes(keyword) ||
            doc.rawStatus.toLowerCase().includes(keyword) ||
            doc.statusLabel.toLowerCase().includes(keyword)
        ));
    }

    if (!currentFilters.has("all")) {
        result = result.filter(doc => {
            for (const filter of currentFilters) {
                const fLower = String(filter).toLowerCase();
                if (
                    doc.statusKey === fLower ||
                    (doc.rawStatus && doc.rawStatus.toLowerCase() === fLower) ||
                    (doc.statusLabel && doc.statusLabel.toLowerCase() === fLower)
                ) {
                    return true;
                }
            }
            return false;
        });
    }

    const selectedType = typeFilter.value.toLocaleLowerCase();
    if (selectedType) {
        result = result.filter(doc => doc.type.toLocaleLowerCase().includes(selectedType));
    }

    if (selectedUrgency === "overdue") {
        const today = todayInThailand();
        result = result.filter(doc => isOverdue(doc, today));
    } else if (selectedUrgency === "due-soon") {
        const today = todayInThailand();
        const cutoff = new Date(`${today}T00:00:00Z`);
        cutoff.setUTCDate(cutoff.getUTCDate() + 3);
        const lastDate = cutoff.toISOString().slice(0, 10);
        result = result.filter(doc =>
            doc.rawStatus !== "Completed" && doc.deadlineDate >= today && doc.deadlineDate <= lastDate
        );
    }

    if (sortKey) {
        result.sort((a, b) => {
            const valueA = a[sortKey] ?? "";
            const valueB = b[sortKey] ?? "";

            if (sortKey === "deadlineDate") {
                const emptyA = !valueA;
                const emptyB = !valueB;
                if (emptyA !== emptyB) return emptyA ? 1 : -1;
            }

            return String(valueA).localeCompare(String(valueB)) * sortDirection;
        });
    }

    if (currentRole === "guest") {
        renderGuestTracking(result);
    } else {
        renderTable(result);
        renderMobile(result);
    }

    if (shownCount) {
        shownCount.textContent = result.length;
    }
}

/* =====================================================
   RENDER TABLE (ปุ่มหลักเพียงปุ่มเดียว: เรียกดูเอกสาร)
===================================================== */
function renderGuestTracking(list) {
    const status = doc => `<span class="status-badge status-${escapeHtml(doc.statusKey)}">${escapeHtml(doc.statusLabel)}</span>`;
    if (tableBody) {
        tableBody.innerHTML = list.map(doc => `<tr><td>${escapeHtml(doc.code)}</td><td>${status(doc)}</td></tr>`).join("") ||
            '<tr><td colspan="2" class="empty-table">ไม่พบข้อมูลเอกสารในระบบ</td></tr>';
    }
    if (mobileList) {
        mobileList.innerHTML = list.map(doc =>
            `<div class="mobile-document"><div class="mobile-top"><strong>${escapeHtml(doc.code)}</strong>${status(doc)}</div></div>`
        ).join("") || '<div class="empty-table">ไม่พบข้อมูลเอกสารในระบบ</div>';
    }
}

function renderTable(list) {
    if (!tableBody) return;

    if (!list.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-table">
                    ไม่พบข้อมูลเอกสารในระบบ
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = list.map(doc => {
        const hasFile = Boolean(doc.file_key);
        let actionButtonHtml = "";
        // Add delete button for admin role
        if (currentRole === "admin") {
            actionButtonHtml += `<button class="btn-delete" data-delete="${doc.id}" title="ลบเอกสาร"><svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"/><line x1="10" y1="11" x2="14" y2="11"/></svg>ลบ</button>`;
        }

        actionButtonHtml += hasFile
            ? `<button class="btn-preview" data-open="${doc.id}" type="button" title="เรียกดูรายละเอียดและเนื้อหาเอกสาร">
                   <svg class="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                   <span>เรียกดูเอกสาร</span>
               </button>`
            : `<button class="btn-preview" data-open="${doc.id}" type="button" title="เรียกดูรายละเอียดเอกสาร">
                   <svg class="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                   <span>ดูรายละเอียด</span>
               </button>`;

        return `
            <tr data-id="${doc.id}">
                <td>
                    <div class="doc-number">
                        ${escapeHtml(doc.number)}
                        <span class="doc-code">${escapeHtml(doc.code)}</span>
                    </div>
                </td>
                <td>
                    <div class="type-name">${escapeHtml(doc.type)}</div>
                    <span class="type-desc">${escapeHtml(doc.description)}</span>
                </td>
                <td class="person-cell">${escapeHtml(doc.sender)}</td>
                <td class="person-cell">${escapeHtml(doc.receiver)}</td>
                <td>
                    <span class="status-badge status-${doc.statusKey}">
                        ${escapeHtml(doc.statusLabel)}
                    </span>
                    ${deadlineLabel(doc)}
                </td>
                <td class="received">
                    <strong>${escapeHtml(doc.receivedDate)}</strong>
                    <span>${escapeHtml(doc.receivedTime)}</span>
                </td>
                <td style="text-align: center;">
                    <div class="file-actions">
                        ${actionButtonHtml}
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // คลิกปุ่มเรียกดูเอกสารเพื่อเปิด Modal จาก document-modal.js
    tableBody.querySelectorAll("[data-open]").forEach(button => {
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            triggerOpenModal(button.dataset.open);
        });
    });

    // คลิกที่แถวเพื่อเปิด Modal
    tableBody.querySelectorAll("tr[data-id]").forEach(row => {
        row.addEventListener("click", () => {
            triggerOpenModal(row.dataset.id);
        });
    });

    // ปุ่มลบเอกสาร (เฉพาะ admin)
    tableBody.querySelectorAll("[data-delete]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const docId = btn.dataset.delete;
            if (!confirm("คุณแน่ใจหรือว่าต้องการลบเอกสารนี้? การลบจะไม่สามารถย้อนกลับได้")) return;
            try {
                const apiBase = getApiBaseUrl();
                const token = localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token") || localStorage.getItem("docuflow_id_token") || localStorage.getItem("id_token") || "";
                const headers = {};
                if (token) headers["Authorization"] = `Bearer ${token}`;

                const response = await window.apiFetch(`${apiBase}/documents/${docId}`, {
                    method: "DELETE",
                    headers
                });
                const res = await response.json().catch(() => ({}));
                if (response.ok && res.ok) {
                    alert(res.message || "ลบเอกสารสำเร็จ");
                    fetchDocuments();
                } else {
                    alert(res.error || res.message || `เกิดข้อผิดพลาดในการลบ (HTTP ${response.status})`);
                }
            } catch (err) {
                console.error("Delete error:", err);
                alert("เกิดข้อผิดพลาดในการลบเอกสาร: " + (err.message || err));
            }
        });
    });
}

/* =====================================================
   RENDER MOBILE
===================================================== */
function renderMobile(list) {
    if (!mobileList) return;

    if (!list.length) {
        mobileList.innerHTML = `<div class="empty-table">ไม่พบข้อมูลเอกสารในระบบ</div>`;
        return;
    }

    mobileList.innerHTML = list.map(doc => {
        const hasFile = Boolean(doc.file_key);
        let actionButtonHtml = "";
        // Add delete button for admin role
        if (currentRole === "admin") {
            actionButtonHtml += `<button class="btn-delete" data-delete="${doc.id}" title="ลบเอกสาร"><svg class="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"/><line x1="10" y1="11" x2="14" y2="11"/></svg>ลบ</button>`;
        }

        actionButtonHtml += hasFile
            ? `<button class="btn-preview" data-open="${doc.id}" type="button">
                   <svg class="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                   <span>เรียกดูเอกสาร</span>
               </button>`
            : `<button class="btn-preview" data-open="${doc.id}" type="button">
                   <svg class="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                   <span>ดูรายละเอียด</span>
               </button>`;

        return `
            <div class="mobile-document" data-id="${doc.id}">
                <div class="mobile-top">
                    <div class="mobile-main">
                        <div class="mobile-number">${escapeHtml(doc.number)}</div>
                        <div class="mobile-name"><strong>${escapeHtml(doc.type)}:</strong> ${escapeHtml(doc.description)}</div>
                    </div>
                    <span class="status-badge status-${doc.statusKey}">
                        ${escapeHtml(doc.statusLabel)}
                    </span>
                    ${deadlineLabel(doc)}
                </div>
                <div class="mobile-meta">
                    <div>
                        <small style="color: #92757c;">ผู้ส่ง: </small>
                        <span>${escapeHtml(doc.sender)}</span>
                    </div>
                    <div>
                        <small style="color: #92757c;">วันที่รับ: </small>
                        <span>${escapeHtml(doc.receivedDate)}</span>
                    </div>
                </div>
                <div class="file-actions" style="margin-top: 12px;">
                    ${actionButtonHtml}
                </div>
            </div>
        `;
    }).join("");

    mobileList.querySelectorAll("[data-open]").forEach(button => {
        button.addEventListener("click", (e) => {
            e.stopPropagation();
            triggerOpenModal(button.dataset.open);
        });
    });

    mobileList.querySelectorAll(".mobile-document").forEach(card => {
        card.addEventListener("click", () => {
            triggerOpenModal(card.dataset.id);
        });
    });

    // ปุ่มลบเอกสาร (เฉพาะ admin) - mobile
    mobileList.querySelectorAll("[data-delete]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const docId = btn.dataset.delete;
            if (!confirm("คุณแน่ใจหรือว่าต้องการลบเอกสารนี้? การลบจะไม่สามารถย้อนกลับได้")) return;
            try {
                const apiBase = getApiBaseUrl();
                const token = localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token") || localStorage.getItem("docuflow_id_token") || localStorage.getItem("id_token") || "";
                const headers = {};
                if (token) headers["Authorization"] = `Bearer ${token}`;

                const response = await window.apiFetch(`${apiBase}/documents/${docId}`, {
                    method: "DELETE",
                    headers
                });
                const res = await response.json().catch(() => ({}));
                if (response.ok && res.ok) {
                    alert(res.message || "ลบเอกสารสำเร็จ");
                    fetchDocuments();
                } else {
                    alert(res.error || res.message || `เกิดข้อผิดพลาดในการลบ (HTTP ${response.status})`);
                }
            } catch (err) {
                console.error("Delete error:", err);
                alert("เกิดข้อผิดพลาดในการลบเอกสาร: " + (err.message || err));
            }
        });
    });
}

// Helper เรียกเปิด Modal ผ่านโมดูล document-modal.js
function triggerOpenModal(id) {
    if (currentRole === "guest") {
        alert("ผู้ใช้ทั่วไป (Guest) ไม่มีสิทธิ์ในการเปิดดูรายละเอียดเอกสาร กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่");
        return;
    }
    if (window.DocuFlowModal && typeof window.DocuFlowModal.open === "function") {
        window.DocuFlowModal.open(id);
    } else if (typeof window.openDocumentModal === "function") {
        window.openDocumentModal(id);
    } else {
        console.error("Document modal module is not loaded.");
    }
}

/* =====================================================
   STATUS FILTERS
===================================================== */
function syncFilterButtons() {
    document.querySelectorAll("[data-filter]").forEach(button => {
        const filter = button.dataset.filter;
        button.classList.toggle("active", currentFilters.has(filter));
    });
}

function setFilter(filter) {
    if (filter === "all") {
        currentFilters.clear();
        currentFilters.add("all");
    } else {
        currentFilters.delete("all");
        if (currentFilters.has(filter)) {
            currentFilters.delete(filter);
        } else {
            currentFilters.add(filter);
        }
        if (currentFilters.size === 0) {
            currentFilters.add("all");
        }
    }
    syncFilterButtons();
    render();
}

/* =====================================================
   SORTING
===================================================== */
function setupSorting() {
    document.querySelectorAll("[data-sort]").forEach(header => {
        header.addEventListener("click", () => {
            const key = header.dataset.sort;
            if (sortKey === key) {
                sortDirection *= -1;
            } else {
                sortKey = key;
                sortDirection = 1;
            }
            render();
        });
    });
}

/* =====================================================
   SEARCH & FILTER LISTENERS
===================================================== */
if (globalSearch) {
    globalSearch.addEventListener("input", () => {
        render();
    });
}

typeFilter.addEventListener("change", render);
const urgencyButtons = urgencyFilter.querySelectorAll("[data-urgency]");
urgencyButtons.forEach(button => {
    button.addEventListener("click", () => {
        const urgency = button.dataset.urgency;
        selectedUrgency = selectedUrgency === urgency ? "" : urgency;
        urgencyButtons.forEach(option => {
            option.setAttribute("aria-pressed", String(option.dataset.urgency === selectedUrgency));
        });
        render();
    });
});
// Re-evaluate deadlines when returning to the dashboard and across midnight.
window.addEventListener("focus", render);
setInterval(render, 60000);

document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
        setFilter(button.dataset.filter);
    });
});

/* =====================================================
   ESCAPE HTML HELPER
===================================================== */
function escapeHtml(value) {
    // ใช้ฟังก์ชันกลางจาก cognito-config.js (มี fallback เผื่อโหลดไม่ทัน)
    if (typeof window.escapeHtmlSafe === "function") {
        return window.escapeHtmlSafe(value);
    }
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* =====================================================
   INITIALIZE
===================================================== */
function initializeDashboard() {
    const savedUser = localStorage.getItem("docuflow_user");
    const accessToken = localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token");
    const savedRole = localStorage.getItem("docuflow_role");

    // ตรวจสอบสถานะการเข้าสู่ระบบ
    if (!savedUser && !accessToken) {
        window.location.replace("login.html");
        return;
    }

    // ค่าเริ่มต้นเป็น guest เมื่อไม่มีบทบาทที่บันทึกไว้ เพื่อให้การ์ดสิทธิ์ฝั่ง Client ทำงานถูกต้อง
    currentRole = savedRole || "guest";
    currentUsername = savedUser || "Guest";

    // รองรับการส่งคำค้นหาข้ามหน้า (เช่น มาจาก register.html หรือ guide.html)
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get("search");
    if (searchQuery && globalSearch) {
        globalSearch.value = searchQuery;
    }

    initRoleManagement();
    document.getElementById("guestTrackingHint").hidden = currentRole !== "guest";
    document.getElementById("executiveReadOnly").hidden = currentRole !== "executive";
    if (currentRole === "guest") {
        const headings = tableBody.closest("table").tHead.rows[0];
        headings.innerHTML = '<th scope="col">เลขอ้างอิง</th><th scope="col">สถานะ</th>';
        typeFilter.hidden = true;
        urgencyFilter.hidden = true;
        if (globalSearch) globalSearch.placeholder = "ค้นหาด้วยเลขอ้างอิง";
    }
    syncFilterButtons();
    setupSorting();
    fetchDocuments();
}

initializeDashboard();

// Expose fetchDocuments for external trigger and listen to status change events
window.fetchDocuments = fetchDocuments;
window.addEventListener("docuflow:statusChanged", () => {
    fetchDocuments();
});
