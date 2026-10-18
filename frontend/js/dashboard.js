/* =====================================================
   DASHBOARD & DOCUMENT REGISTRY
   DocuFlow Electronic Mailbox & Document Flow System
   (โมดูลจัดการตารางทะเบียนเอกสาร ตัวกรอง และการสลับสิทธิ์)
===================================================== */

const tableBody = document.getElementById("documentTableBody");
const mobileList = document.getElementById("mobileList");
const globalSearch = document.getElementById("globalSearch");
const shownCount = document.getElementById("shownCount");

// Role Selector Elements
const roleMenuBtn = document.getElementById("roleMenuBtn");
const roleDropdown = document.getElementById("roleDropdown");
const userRoleDot = document.getElementById("userRoleDot");
const userRoleDisplay = document.getElementById("userRoleDisplay");

let documents = [];
let currentFilters = new Set(["all"]);
let sortKey = null;
let sortDirection = 1;

// บทบาทผู้ใช้ปัจจุบัน (staff, admin, guest) สำหรับตรวจสอบสิทธิ์
let currentRole = localStorage.getItem("docuflow_role") || "staff";
let currentUsername = localStorage.getItem("docuflow_user") || "staff01";

// Helper เพื่อหา API Base URL
function getApiBaseUrl() {
    if (window.location.port === "3000") {
        return "/api";
    }
    return "http://localhost:3000/api";
}

/* =====================================================
   ROLE & PERMISSION MANAGEMENT
===================================================== */
function initRoleManagement() {
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

        roleDropdown.querySelectorAll(".role-option").forEach(btn => {
            btn.addEventListener("click", () => {
                if (btn.id === "logoutBtn") return;
                const role = btn.dataset.role;
                const user = btn.dataset.user;
                if (role && user) {
                    setUserRole(role, user);
                }
                roleMenuBtn.setAttribute("aria-expanded", "false");
                roleDropdown.hidden = true;
            });
        });

        const logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", () => {
                localStorage.removeItem("docuflow_role");
                localStorage.removeItem("docuflow_user");
                window.location.href = "login.html";
            });
        }
    }
}

function setUserRole(role, user) {
    currentRole = role;
    currentUsername = user;
    localStorage.setItem("docuflow_role", role);
    localStorage.setItem("docuflow_user", user);
    updateRoleUI();

    if (window.DocuFlowModal && typeof window.DocuFlowModal.refreshWorkflowUI === "function") {
        window.DocuFlowModal.refreshWorkflowUI();
    }
}

// Expose ให้โมดูลอื่นเรียกใช้ได้
window.setUserRole = setUserRole;

function updateRoleUI() {
    if (!userRoleDisplay || !userRoleDot) return;

    userRoleDot.className = "profile-icon";
    if (currentRole === "staff") {
        userRoleDot.classList.add("role-staff");
        userRoleDisplay.textContent = `เจ้าหน้าที่ (${currentUsername})`;
    } else if (currentRole === "admin") {
        userRoleDot.classList.add("role-admin");
        userRoleDisplay.textContent = `ผู้ดูแลระบบ (${currentUsername})`;
    } else {
        userRoleDot.classList.add("role-guest");
        userRoleDisplay.textContent = "ผู้ใช้ทั่วไป (Guest - ไม่มีสิทธิ์)";
    }

    if (roleDropdown) {
        roleDropdown.querySelectorAll(".role-option").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.role === currentRole);
        });
    }
}

/* =====================================================
   FETCH DOCUMENTS
===================================================== */
async function fetchDocuments() {
    const keyword = globalSearch ? globalSearch.value.trim() : "";
    const params = new URLSearchParams();

    if (keyword) {
        params.append("search", keyword);
    }

    if (!currentFilters.has("all")) {
        currentFilters.forEach(filter => {
            let statusParam = filter;
            const lower = filter.toLowerCase();
            if (lower === "received" || filter === "waiting") statusParam = "Received";
            else if (lower === "assigned" || filter === "approval") statusParam = "Assigned";
            else if (lower === "processing") statusParam = "Processing";
            else if (lower === "completed") statusParam = "Completed";

            if (statusParam && statusParam !== "all") {
                params.append("status", statusParam);
            }
        });
    }

    const apiBase = getApiBaseUrl();

    try {
        let response = await fetch(`${apiBase}/documents?${params.toString()}`);

        // Fallback ไปยัง AWS API Gateway หาก local server ไม่ตอบสนอง
        if (!response.ok && apiBase.includes("localhost")) {
            response = await fetch(`https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents?${params.toString()}`);
        }

        if (!response.ok) {
            throw new Error("ไม่สามารถโหลดข้อมูลเอกสารได้");
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
            const rawStatus = row.status || "Received";
            const cfg = V3_STATUS_CONFIG[rawStatus] || {
                key: rawStatus.toLowerCase(),
                label: rawStatus,
                color: "gray",
                step: 1
            };

            const dateValue = row.received_at || row.created_at || row.updated_at;
            let receivedDate = "-";
            let receivedTime = "-";

            if (dateValue) {
                const date = new Date(dateValue);
                if (!isNaN(date.getTime())) {
                    receivedDate = date.toLocaleDateString("th-TH");
                    receivedTime = date.toLocaleTimeString("th-TH", {
                        hour: "2-digit",
                        minute: "2-digit"
                    });
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
                send_date: safeFormatDate(row.sent_date),
                receive_date: safeFormatDate(row.receive_date),
                deadline: safeFormatDate(row.deadline),
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
            doc.receiver.toLowerCase().includes(keyword)
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

    if (sortKey) {
        result.sort((a, b) => {
            const valueA = String(a[sortKey] || "").toLowerCase();
            const valueB = String(b[sortKey] || "").toLowerCase();
            return valueA.localeCompare(valueB) * sortDirection;
        });
    }

    renderTable(result);
    renderMobile(result);

    if (shownCount) {
        shownCount.textContent = result.length;
    }
}

/* =====================================================
   RENDER TABLE (ปุ่มหลักเพียงปุ่มเดียว: เรียกดูเอกสาร)
===================================================== */
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
        const actionButtonHtml = hasFile
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
        const actionButtonHtml = hasFile
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
}

// Helper เรียกเปิด Modal ผ่านโมดูล document-modal.js
function triggerOpenModal(id) {
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

document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
        setFilter(button.dataset.filter);
    });
});

/* =====================================================
   ESCAPE HTML HELPER
===================================================== */
function escapeHtml(value) {
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
initRoleManagement();
syncFilterButtons();
setupSorting();
fetchDocuments();

// Expose fetchDocuments for external trigger and listen to status change events
window.fetchDocuments = fetchDocuments;
window.addEventListener("docuflow:statusChanged", () => {
    fetchDocuments();
});