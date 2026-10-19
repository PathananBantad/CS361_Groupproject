/* =====================================================
   DOCUMENT DETAILS & PREVIEW MODAL
   DocuFlow Electronic Mailbox & Document Flow System
   (โมดูลจัดการหน้าต่าง Popup แสดงรายละเอียดและตัวอย่างเอกสาร)
===================================================== */

(function (window) {
    // Modal DOM Elements (จะถูกผูกค่าเมื่อโหลดเทมเพลต document-modal.html เข้าสู่ DOM)
    let documentModal = null;
    let modalCloseBtn = null;
    let modalDocSubject = null;
    let modalTypeBadge = null;
    let modalRefNo = null;
    let modalStatusBadge = null;

    let modalDocNumber = null;
    let modalChannel = null;
    let modalSenderDept = null;
    let modalSenderName = null;
    let modalSenderContact = null;
    let modalReceiver = null;
    let modalSendDate = null;
    let modalReceiveDate = null;
    let modalDeadline = null;
    let modalRemarks = null;

    // V3 Workflow & Action Elements
    let workflowStepper = null;
    let stepperCurrentTag = null;
    let modalAlertBox = null;
    let modalAlertIcon = null;
    let modalAlertTitle = null;
    let modalAlertMessage = null;
    let modalAlertCloseBtn = null;

    let actionCurrentStatusBadge = null;
    let actionRoleHint = null;
    let actionCurrentRoleDisplay = null;
    let statusNextActionWrap = null;
    let statusRemarksInput = null;
    let btnNextStatus = null;
    let btnNextStatusText = null;
    let btnNextStatusSpinner = null;

    let adminOverrideWrap = null;
    let adminStatusSelect = null;
    let btnAdminApplyStatus = null;
    let statusDisabledMessage = null;
    let statusDisabledIcon = null;
    let statusDisabledText = null;
    let statusHistoryTimeline = null;

    let previewFileIcon = null;
    let previewFileName = null;
    let previewFileTypeTag = null;
    let previewFileSize = null;
    let previewViewport = null;
    let modalDownloadBtn = null;
    let modalOpenTabBtn = null;

    let currentActiveDoc = null;
    let modalLoadPromise = null;

    // ผูกตัวแปร DOM Elements กับเทมเพลต HTML
    function bindModalDOMElements() {
        documentModal = document.getElementById("documentModal");
        modalCloseBtn = document.getElementById("modalCloseBtn");
        modalDocSubject = document.getElementById("modalDocSubject");
        modalTypeBadge = document.getElementById("modalTypeBadge");
        modalRefNo = document.getElementById("modalRefNo");
        modalStatusBadge = document.getElementById("modalStatusBadge");

        modalDocNumber = document.getElementById("modalDocNumber");
        modalChannel = document.getElementById("modalChannel");
        modalSenderDept = document.getElementById("modalSenderDept");
        modalSenderName = document.getElementById("modalSenderName");
        modalSenderContact = document.getElementById("modalSenderContact");
        modalReceiver = document.getElementById("modalReceiver");
        modalSendDate = document.getElementById("modalSendDate");
        modalReceiveDate = document.getElementById("modalReceiveDate");
        modalDeadline = document.getElementById("modalDeadline");
        modalRemarks = document.getElementById("modalRemarks");

        // V3 Workflow DOM Elements
        workflowStepper = document.getElementById("workflowStepper");
        stepperCurrentTag = document.getElementById("stepperCurrentTag");
        modalAlertBox = document.getElementById("modalAlertBox");
        modalAlertIcon = document.getElementById("modalAlertIcon");
        modalAlertTitle = document.getElementById("modalAlertTitle");
        modalAlertMessage = document.getElementById("modalAlertMessage");
        modalAlertCloseBtn = document.getElementById("modalAlertCloseBtn");

        actionCurrentStatusBadge = document.getElementById("actionCurrentStatusBadge");
        actionRoleHint = document.getElementById("actionRoleHint");
        actionCurrentRoleDisplay = document.getElementById("actionCurrentRoleDisplay");
        statusNextActionWrap = document.getElementById("statusNextActionWrap");
        statusRemarksInput = document.getElementById("statusRemarksInput");
        btnNextStatus = document.getElementById("btnNextStatus");
        btnNextStatusText = document.getElementById("btnNextStatusText");
        btnNextStatusSpinner = document.getElementById("btnNextStatusSpinner");

        adminOverrideWrap = document.getElementById("adminOverrideWrap");
        adminStatusSelect = document.getElementById("adminStatusSelect");
        btnAdminApplyStatus = document.getElementById("btnAdminApplyStatus");
        statusDisabledMessage = document.getElementById("statusDisabledMessage");
        statusDisabledIcon = document.getElementById("statusDisabledIcon");
        statusDisabledText = document.getElementById("statusDisabledText");
        statusHistoryTimeline = document.getElementById("statusHistoryTimeline");

        previewFileIcon = document.getElementById("previewFileIcon");
        previewFileName = document.getElementById("previewFileName");
        previewFileTypeTag = document.getElementById("previewFileTypeTag");
        previewFileSize = document.getElementById("previewFileSize");
        previewViewport = document.getElementById("previewViewport");
        modalDownloadBtn = document.getElementById("modalDownloadBtn");
        modalOpenTabBtn = document.getElementById("modalOpenTabBtn");

        if (documentModal && !documentModal.dataset.eventsBound) {
            documentModal.dataset.eventsBound = "true";

            if (modalCloseBtn) {
                modalCloseBtn.addEventListener("click", () => {
                    documentModal.close();
                });
            }

            if (modalAlertCloseBtn) {
                modalAlertCloseBtn.addEventListener("click", () => {
                    hideAlert();
                });
            }

            // ปุ่มเปลี่ยนสถานะขั้นตอนถัดไป (Task 4)
            if (btnNextStatus) {
                btnNextStatus.addEventListener("click", () => {
                    const targetStatus = btnNextStatus.dataset.targetStatus;
                    const remarks = statusRemarksInput ? statusRemarksInput.value.trim() : "";
                    if (targetStatus) {
                        changeDocumentStatus(targetStatus, remarks);
                    }
                });
            }

            // ปุ่ม Admin ปรับสถานะ / Override
            if (btnAdminApplyStatus) {
                btnAdminApplyStatus.addEventListener("click", () => {
                    const targetStatus = adminStatusSelect ? adminStatusSelect.value : "";
                    const currentStatus = currentActiveDoc ? (currentActiveDoc.rawStatus || currentActiveDoc.status) : "";
                    if (targetStatus && targetStatus === currentStatus) {
                        showAlert(`เอกสารนี้อยู่ในสถานะ "${V3_STATUS_DETAILS[currentStatus] ? V3_STATUS_DETAILS[currentStatus].label : currentStatus}" อยู่แล้ว กรุณาเลือกสถานะใหม่ที่ต้องการเปลี่ยน`, "warning", "แจ้งเตือน");
                        return;
                    }
                    const remarks = statusRemarksInput ? statusRemarksInput.value.trim() : "";
                    if (targetStatus) {
                        changeDocumentStatus(targetStatus, remarks);
                    }
                });
            }

            // ปิดเมื่อคลิกที่ Backdrop
            documentModal.addEventListener("click", (e) => {
                const rect = documentModal.getBoundingClientRect();
                const isInDialog = (
                    rect.top <= e.clientY &&
                    e.clientY <= rect.top + rect.height &&
                    rect.left <= e.clientX &&
                    e.clientX <= rect.left + rect.width
                );
                if (!isInDialog) {
                    documentModal.close();
                }
            });

            documentModal.addEventListener("close", () => {
                if (previewViewport) previewViewport.innerHTML = "";
                hideAlert();
                currentActiveDoc = null;
            });
        }
    }

    // โหลดไฟล์ HTML เทมเพลตของ Modal (document-modal.html)
    async function ensureModalLoaded() {
        if (documentModal) return true;
        if (modalLoadPromise) return modalLoadPromise;

        modalLoadPromise = (async () => {
            // 1. ตรวจสอบว่ามี element ในหน้าอยู่แล้วหรือไม่
            if (document.getElementById("documentModal")) {
                bindModalDOMElements();
                return true;
            }

            // 2. ลองดึงข้อมูลจากไฟล์ document-modal.html
            try {
                const res = await fetch("document-modal.html");
                if (res.ok) {
                    const html = await res.text();
                    const container = document.getElementById("documentModalContainer") || document.body;
                    if (container.id === "documentModalContainer") {
                        container.innerHTML = html;
                    } else {
                        const div = document.createElement("div");
                        div.id = "documentModalContainer";
                        div.innerHTML = html;
                        document.body.appendChild(div);
                    }
                    bindModalDOMElements();
                    return true;
                }
            } catch (err) {
                console.warn("Notice: Fetching document-modal.html notice:", err);
            }

            // 3. Fallback: กรณีเรียกไฟล์ผ่าน file:// หรือ offline
            injectFallbackModalHTML();
            bindModalDOMElements();
            return true;
        })();

        return modalLoadPromise;
    }

    function injectFallbackModalHTML() {
        if (document.getElementById("documentModal")) return;
        const container = document.getElementById("documentModalContainer") || document.body;
        const temp = document.createElement("div");
        temp.innerHTML = `
        <dialog id="documentModal" class="document-modal" aria-labelledby="modalDocSubject">
            <div class="modal-card">
                <header class="modal-header">
                    <div class="modal-header-text">
                        <div class="modal-top-meta">
                            <span class="modal-type-badge" id="modalTypeBadge">ประเภทเอกสาร</span>
                            <span class="modal-ref-no" id="modalRefNo">DOC-XXXXXXXX</span>
                            <span class="status-badge" id="modalStatusBadge">สถานะ</span>
                        </div>
                        <h2 id="modalDocSubject" class="modal-title">ชื่อเรื่องเอกสาร</h2>
                    </div>
                    <button type="button" class="modal-close-btn" id="modalCloseBtn" aria-label="ปิดหน้าต่าง">✕</button>
                </header>

                <!-- แถบแสดงสถานะตาม Workflow V3 -->
                <section class="workflow-stepper-wrap" aria-label="ขั้นตอนการดำเนินงานตาม Workflow">
                    <div class="stepper-header">
                        <span class="stepper-title">ขั้นตอนการดำเนินงานตาม Workflow (V3)</span>
                        <span class="workflow-current-tag" id="stepperCurrentTag">สถานะ: ได้รับเอกสารแล้ว</span>
                    </div>
                    <div class="workflow-steps" id="workflowStepper">
                        <div class="workflow-step active" data-step="Received">
                            <div class="step-circle"><span class="step-icon">📥</span></div>
                            <div class="step-labels"><strong>ได้รับเอกสารแล้ว</strong><small>Received</small></div>
                        </div>
                        <div class="step-connector"></div>
                        <div class="workflow-step" data-step="Assigned">
                            <div class="step-circle"><span class="step-icon">👤</span></div>
                            <div class="step-labels"><strong>มอบหมายแล้ว</strong><small>Assigned</small></div>
                        </div>
                        <div class="step-connector"></div>
                        <div class="workflow-step" data-step="Processing">
                            <div class="step-circle"><span class="step-icon">⚙️</span></div>
                            <div class="step-labels"><strong>กำลังดำเนินการ</strong><small>Processing</small></div>
                        </div>
                        <div class="step-connector"></div>
                        <div class="workflow-step" data-step="Completed">
                            <div class="step-circle"><span class="step-icon">✅</span></div>
                            <div class="step-labels"><strong>ดำเนินการเสร็จสิ้น</strong><small>Completed</small></div>
                        </div>
                    </div>
                </section>

                <!-- กล่องแจ้งเตือน (Task 8) -->
                <div id="modalAlertBox" class="modal-alert-box" hidden role="alert">
                    <span class="alert-icon" id="modalAlertIcon">⚠️</span>
                    <div class="alert-content">
                        <strong id="modalAlertTitle">แจ้งเตือน</strong>
                        <p id="modalAlertMessage">ข้อความแจ้งเตือน</p>
                    </div>
                    <button type="button" class="alert-close-btn" id="modalAlertCloseBtn" aria-label="ปิดการแจ้งเตือน">✕</button>
                </div>

                <div class="modal-body">
                    <div class="modal-left-col">
                        <!-- ส่วนจัดการสถานะ Workflow -->
                        <section class="modal-workflow-card">
                            <div class="details-section-title"><span aria-hidden="true">🔄</span> จัดการสถานะเอกสาร</div>
                            <div class="workflow-action-body">
                                <div class="current-status-display">
                                    <div class="status-summary-line">
                                        <span class="status-indicator-label">สถานะปัจจุบัน:</span>
                                        <span class="status-badge" id="actionCurrentStatusBadge">ได้รับเอกสารแล้ว</span>
                                    </div>
                                    <span class="role-permission-hint" id="actionRoleHint">ผู้ดำเนินการ: <strong id="actionCurrentRoleDisplay">เจ้าหน้าที่ (Staff)</strong></span>
                                </div>
                                <div class="status-change-controls" id="statusChangeControls">
                                    <div class="status-next-action" id="statusNextActionWrap">
                                        <label for="statusRemarksInput" class="status-input-label">บันทึกหมายเหตุการเปลี่ยนสถานะ (ทางเลือก):</label>
                                        <input type="text" id="statusRemarksInput" class="status-remarks-input" placeholder="ระบุเหตุผลหรือบันทึกช่วยจำ...">
                                        <div class="action-buttons-group">
                                            <button type="button" class="btn-workflow-primary" id="btnNextStatus">
                                                <span class="btn-spinner" id="btnNextStatusSpinner" hidden></span>
                                                <span id="btnNextStatusText">➡️ ดำเนินการขั้นตอนถัดไป</span>
                                            </button>
                                            <div class="admin-override-wrap" id="adminOverrideWrap" hidden>
                                                <label class="admin-select-label">ผู้ดูแลระบบ (เลือกสถานะที่ต้องการเปลี่ยน):</label>
                                                <div class="admin-select-row">
                                                    <select id="adminStatusSelect" class="admin-status-dropdown">
                                                        <option value="Received">Received (ได้รับเอกสารแล้ว)</option>
                                                        <option value="Assigned">Assigned (มอบหมายแล้ว)</option>
                                                        <option value="Processing">Processing (กำลังดำเนินการ)</option>
                                                        <option value="Completed">Completed (ดำเนินการเสร็จสิ้น)</option>
                                                    </select>
                                                    <button type="button" class="btn-admin-apply" id="btnAdminApplyStatus">ปรับสถานะ</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="status-disabled-message" id="statusDisabledMessage" hidden>
                                        <span class="disabled-icon" id="statusDisabledIcon">🔒</span>
                                        <span id="statusDisabledText">คุณไม่มีสิทธิ์ในการเปลี่ยนสถานะเอกสารนี้</span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <!-- รายละเอียดเอกสาร -->
                        <section class="modal-details-card">
                            <div class="details-section-title"><span aria-hidden="true">📋</span> รายละเอียดเอกสาร</div>
                            <div class="modal-meta-grid">
                                <div class="meta-item"><span class="meta-label">เลขที่หนังสือ</span><span class="meta-value" id="modalDocNumber">-</span></div>
                                <div class="meta-item"><span class="meta-label">ช่องทางรับเอกสาร</span><span class="meta-value" id="modalChannel">-</span></div>
                                <div class="meta-item"><span class="meta-label">หน่วยงานผู้ส่ง</span><span class="meta-value" id="modalSenderDept">-</span></div>
                                <div class="meta-item"><span class="meta-label">ชื่อผู้ส่ง</span><span class="meta-value" id="modalSenderName">-</span></div>
                                <div class="meta-item"><span class="meta-label">ช่องทางติดต่อผู้ส่ง</span><span class="meta-value" id="modalSenderContact">-</span></div>
                                <div class="meta-item"><span class="meta-label">ผู้รับ</span><span class="meta-value" id="modalReceiver">-</span></div>
                                <div class="meta-item"><span class="meta-label">วันที่ส่ง (ในหนังสือ)</span><span class="meta-value" id="modalSendDate">-</span></div>
                                <div class="meta-item"><span class="meta-label">วันที่รับ (สารบรรณลงรับ)</span><span class="meta-value" id="modalReceiveDate">-</span></div>
                                <div class="meta-item"><span class="meta-label">วันครบกำหนด (Deadline)</span><span class="meta-value" id="modalDeadline">-</span></div>
                                <div class="meta-item full-width" id="modalRemarksWrap"><span class="meta-label">หมายเหตุ</span><p class="meta-value remarks-box" id="modalRemarks">-</p></div>
                            </div>
                        </section>

                        <!-- ประวัติการเปลี่ยนสถานะ (Task 6 & 7) -->
                        <section class="modal-history-card">
                            <div class="details-section-title"><span aria-hidden="true">⏱️</span> ประวัติการเปลี่ยนสถานะ (Workflow Audit Trail)</div>
                            <div class="history-timeline" id="statusHistoryTimeline"><div class="history-loading">กำลังโหลดประวัติการเปลี่ยนสถานะ...</div></div>
                        </section>
                        <div id="forwardSectionContainer"></div>
                    </div>

                    <!-- คอลัมน์ขวา: Preview & Download -->
                    <div class="modal-right-col">
                        <section class="modal-preview-card">
                            <div class="preview-header">
                                <div class="preview-file-summary">
                                    <div class="file-icon-box" id="previewFileIconBox"><span id="previewFileIcon">📄</span></div>
                                    <div class="preview-file-titles"><h3 id="previewFileName">ชื่อไฟล์เอกสาร</h3><div class="preview-file-sub"><span id="previewFileTypeTag" class="file-type-pill">PDF</span><span id="previewFileSize">-</span></div></div>
                                </div>
                                <div class="preview-actions">
                                    <button type="button" class="btn-preview-secondary" id="modalOpenTabBtn" title="เปิดดูเอกสารแบบเต็มหน้าต่างในแท็บใหม่" hidden><span>↗</span> เปิดแท็บใหม่</button>
                                    <button type="button" class="btn-download-primary" id="modalDownloadBtn"><span>↓</span> ดาวน์โหลดไฟล์</button>
                                </div>
                            </div>
                            <div class="preview-viewport" id="previewViewport"><div class="preview-loader" id="previewLoader"><div class="spinner"></div><p>กำลังเตรียมการแสดงตัวอย่างเอกสาร...</p></div></div>
                        </section>
                    </div>
                </div>
            </div>
        </dialog>`;
        if (container.id === "documentModalContainer") {
            container.appendChild(temp.firstElementChild);
        } else {
            container.appendChild(temp);
        }
    }

    // Helper หา API Base URL
    function getApiBaseUrl() {
        const base = window.API_BASE_URL || "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";
        if (window.location.port === "3000") {
            return "/api";
        }

        return base.endsWith("/api") ? base : `${base}/api`;
    }

    // Helper ดึงสิทธิ์ปัจจุบัน
    function getCurrentAuth() {
        const role = (localStorage.getItem("docuflow_role") || "guest").toLowerCase().trim();
        const user = localStorage.getItem("docuflow_user") || "";
        const internalRoles = [
            "admin",
            "document_officer",
            "officer",
            "faculty_staff",
            "staff",
            "case_owner",
            "executive"
        ];
        const hasPermission = internalRoles.includes(role);
        return {
            role,
            user,
            hasPermission,
            isAdmin: role === "admin",
            isOfficer: role === "document_officer" || role === "officer",
            isStaff: role === "faculty_staff" || role === "staff",
            isCaseOwner: role === "case_owner",
            isExecutive: role === "executive",
            isGuest: !hasPermission
        };
    }

    // Helper ป้องกัน XSS
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Helper แปลงขนาดไฟล์
    function formatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return "";
        const b = Number(bytes);
        if (b === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return parseFloat((b / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    // Helper จัดรูปแบบวันที่สำหรับแสดงผลอย่างปลอดภัย ป้องกัน Invalid Date
    function formatDisplayDate(val) {
        if (!val || val === "-" || val === "null" || val === "undefined") return "-";
        if (typeof val === "string") {
            const trimmed = val.trim();
            if (trimmed === "-" || trimmed.toLowerCase() === "invalid date") return "-";
            if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
                return trimmed;
            }
        }
        const d = new Date(val);
        if (isNaN(d.getTime())) return "-";
        return d.toLocaleDateString("th-TH");
    }

    /* =====================================================
       [V3] WORKFLOW STATUS CONSTANTS & UI HELPERS
    ===================================================== */
    const V3_STATUS_DETAILS = {
        Received: {
            step: 1,
            label: "ได้รับเอกสารแล้ว",
            nextStatus: "Assigned",
            nextActionText: "➡️ เปลี่ยนสถานะเป็น 'มอบหมายแล้ว' (ขั้นตอนถัดไป)",
            color: "teal",
            badgeClass: "status-received"
        },
        Assigned: {
            step: 2,
            label: "มอบหมายแล้ว",
            nextStatus: "Processing",
            nextActionText: "➡️ เปลี่ยนสถานะเป็น 'กำลังดำเนินการ' (ขั้นตอนถัดไป)",
            color: "orange",
            badgeClass: "status-assigned"
        },
        Processing: {
            step: 3,
            label: "กำลังดำเนินการ",
            nextStatus: "Completed",
            nextActionText: "✅ เปลี่ยนสถานะเป็น 'ดำเนินการเสร็จสิ้น' (ขั้นตอนถัดไป)",
            color: "blue",
            badgeClass: "status-processing"
        },
        Completed: {
            step: 4,
            label: "ดำเนินการเสร็จสิ้นแล้ว",
            nextStatus: null,
            nextActionText: "ดำเนินการเสร็จสิ้นสมบูรณ์แล้ว",
            color: "green",
            badgeClass: "status-completed"
        }
    };

    // Alert notification helper (Task 8: แสดงข้อความแจ้งเตือนเมื่อไม่สามารถเปลี่ยนสถานะเอกสารได้)
    function showAlert(message, type = "error", title = "") {
        if (!modalAlertBox) return;
        modalAlertBox.hidden = false;
        modalAlertBox.className = `modal-alert-box alert-${type}`;
        if (modalAlertIcon) {
            modalAlertIcon.textContent = type === "success" ? "✅" : (type === "warning" ? "⚠️" : "⛔");
        }
        if (modalAlertTitle) {
            modalAlertTitle.textContent = title || (type === "success" ? "สำเร็จ" : "ข้อผิดพลาด");
        }
        if (modalAlertMessage) {
            modalAlertMessage.textContent = message;
        }
        if (documentModal) {
            documentModal.scrollTop = 0;
        }
    }

    function hideAlert() {
        if (modalAlertBox) {
            modalAlertBox.hidden = true;
        }
    }

    // Render Workflow Stepper, Current Status Badges, and Action Controls
    function renderWorkflowUI(status, auth) {
        const rawStatus = status || "Received";
        const details = V3_STATUS_DETAILS[rawStatus] || V3_STATUS_DETAILS["Received"];

        // 1. Update Header & Action Badges (Task 7)
        if (modalStatusBadge) {
            modalStatusBadge.textContent = details.label;
            modalStatusBadge.className = `status-badge ${details.badgeClass}`;
        }
        if (actionCurrentStatusBadge) {
            actionCurrentStatusBadge.textContent = details.label;
            actionCurrentStatusBadge.className = `status-badge ${details.badgeClass}`;
        }
        if (stepperCurrentTag) {
            stepperCurrentTag.textContent = `สถานะ: ${details.label}`;
        }

        // 2. Update Current Role Display (Task 3)
        if (actionCurrentRoleDisplay) {
            const roleLabels = {
                admin: "ผู้ดูแลระบบ",
                document_officer: "เจ้าหน้าที่สารบรรณ",
                officer: "เจ้าหน้าที่สารบรรณ",
                faculty_staff: "เจ้าหน้าที่คณะ",
                staff: "เจ้าหน้าที่คณะ",
                case_owner: "ผู้รับผิดชอบเอกสาร",
                executive: "ผู้บริหาร",
                guest: "ผู้ใช้ทั่วไป"
            };
            const roleLabel = roleLabels[auth.role] || auth.role || "ผู้ใช้ทั่วไป";
            if (auth.hasPermission) {
                actionCurrentRoleDisplay.textContent = `${roleLabel} (${auth.user || "-"})`;
            } else {
                actionCurrentRoleDisplay.textContent = `ผู้ใช้ทั่วไป (Guest - ไม่มีสิทธิ์)`;
            }
        }

        // 3. Update Stepper Circles & Connectors (Task 7)
        if (workflowStepper) {
            const stepItems = workflowStepper.querySelectorAll(".workflow-step");
            const connectors = workflowStepper.querySelectorAll(".step-connector");
            const currentStepNum = details.step;

            stepItems.forEach(item => {
                const stepName = item.dataset.step;
                const itemStepNum = V3_STATUS_DETAILS[stepName] ? V3_STATUS_DETAILS[stepName].step : 1;

                item.classList.remove("active", "completed", "pending");
                if (itemStepNum < currentStepNum) {
                    item.classList.add("completed");
                } else if (itemStepNum === currentStepNum) {
                    item.classList.add("active");
                } else {
                    item.classList.add("pending");
                }
            });

            connectors.forEach((conn, idx) => {
                conn.classList.toggle("completed", idx + 1 < currentStepNum);
            });
        }

        // 4. Update Status Change Controls based on Role & Workflow (Task 3, 5, 8 & 9)
        hideAlert();
        if (statusRemarksInput) statusRemarksInput.value = "";
        if (btnNextStatusSpinner) btnNextStatusSpinner.hidden = true;

        const isGuest = auth.isGuest || !auth.hasPermission;
        const isExecutive = auth.isExecutive;
        const isCompleted = rawStatus === "Completed";
        const isAdmin = auth.isAdmin;

        if (isGuest) {
            // Guest role cannot change status
            if (statusNextActionWrap) statusNextActionWrap.hidden = true;
            if (statusDisabledMessage) {
                statusDisabledMessage.hidden = false;
                if (statusDisabledIcon) statusDisabledIcon.textContent = "🔒";
                if (statusDisabledText) statusDisabledText.textContent = "คุณอยู่ในบทบาท Guest ไม่มีสิทธิ์เปลี่ยนสถานะเอกสาร กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่เพื่อดำเนินการ";
            }
        } else if (isExecutive) {
            // Executive role is monitoring / view-only
            if (statusNextActionWrap) statusNextActionWrap.hidden = true;
            if (statusDisabledMessage) {
                statusDisabledMessage.hidden = false;
                if (statusDisabledIcon) statusDisabledIcon.textContent = "👁️";
                if (statusDisabledText) statusDisabledText.textContent = "บทบาทผู้บริหาร (Executive): สำหรับติดตามและตรวจสอบการดำเนินงานของเอกสาร (View / Audit Only)";
            }
        } else if (isCompleted && !isAdmin) {
            // Completed is terminal state for staff
            if (statusNextActionWrap) statusNextActionWrap.hidden = true;
            if (statusDisabledMessage) {
                statusDisabledMessage.hidden = false;
                if (statusDisabledIcon) statusDisabledIcon.textContent = "✅";
                if (statusDisabledText) statusDisabledText.textContent = "เอกสารนี้ดำเนินการเสร็จสิ้นสมบูรณ์แล้ว (Workflow Completed)";
            }
        } else {
            // Staff, Officer, Case Owner, Admin can proceed with workflow
            if (statusNextActionWrap) statusNextActionWrap.hidden = false;
            if (statusDisabledMessage) statusDisabledMessage.hidden = true;

            if (btnNextStatus) {
                if (details.nextStatus) {
                    btnNextStatus.hidden = false;
                    btnNextStatus.disabled = false;
                    if (btnNextStatusText) btnNextStatusText.textContent = details.nextActionText;
                    btnNextStatus.dataset.targetStatus = details.nextStatus;
                } else {
                    btnNextStatus.hidden = true;
                    btnNextStatus.disabled = true;
                    if (btnNextStatusText) btnNextStatusText.textContent = "";
                    btnNextStatus.dataset.targetStatus = "";
                }
            }

            // เมนูเลือกสถานะสำหรับ Admin: ตั้งค่าให้ตรงกับสถานะปัจจุบันของเอกสารที่เปิดอยู่เสมอ (ไม่ใช่ขั้นตอนถัดไป)
            if (adminOverrideWrap) {
                adminOverrideWrap.hidden = !isAdmin;
                if (isAdmin && adminStatusSelect) {
                    adminStatusSelect.value = rawStatus;
                }
            }
        }
    }

    // Change Document Status via API (Task 4, 5, 6, 8, 9)
    async function changeDocumentStatus(targetStatus, remarks) {
        if (!currentActiveDoc) return;
        const auth = getCurrentAuth();
        const docId = currentActiveDoc.id;
        const apiBase = getApiBaseUrl();

        // Check permission client-side
        if (auth.isGuest || auth.isExecutive || !auth.hasPermission) {
            showAlert("คุณไม่มีสิทธิ์ในการเปลี่ยนสถานะเอกสาร", "error", "ไม่อนุญาต (Permission Denied)");
            return;
        }

        if (btnNextStatus) btnNextStatus.disabled = true;
        if (btnNextStatusSpinner) btnNextStatusSpinner.hidden = false;
        if (btnAdminApplyStatus) btnAdminApplyStatus.disabled = true;

        const token = localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token") || localStorage.getItem("docuflow_id_token") || localStorage.getItem("id_token") || "";
        const reqHeaders = { "Content-Type": "application/json" };
        if (token) {
            reqHeaders["Authorization"] = `Bearer ${token}`;
        }

        try {
            let response = await window.apiFetch(`${apiBase}/documents/${docId}/status`, {
                method: "PUT",
                headers: reqHeaders,
                body: JSON.stringify({
                    status: targetStatus,
                    remarks: remarks || "",
                    changed_by: auth.user
                })
            });

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                // Task 8: แสดงข้อความแจ้งเตือนเมื่อไม่สามารถเปลี่ยนสถานะเอกสารได้
                const errorMsg = result.error || "เกิดข้อผิดพลาดในการเปลี่ยนสถานะเอกสาร";
                showAlert(errorMsg, "error", "ไม่สามารถเปลี่ยนสถานะเอกสารได้");
                return;
            }

            // Success feedback
            showAlert(result.message || `เปลี่ยนสถานะเป็น "${targetStatus}" สำเร็จเรียบร้อย`, "success", "บันทึกสำเร็จ");

            // Update active doc state
            currentActiveDoc.status = targetStatus;
            currentActiveDoc.rawStatus = targetStatus;
            if (currentActiveDoc.raw) currentActiveDoc.raw.status = targetStatus;

            // Re-render workflow UI & reload history
            renderWorkflowUI(targetStatus, auth);
            await loadStatusHistory(docId);

            // Notify dashboard to re-fetch and update table / badges (Task 7)
            window.dispatchEvent(new CustomEvent("docuflow:statusChanged", {
                detail: { id: docId, status: targetStatus }
            }));

        } catch (err) {
            console.error("Change status error:", err);
            showAlert(`เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}`, "error", "การเชื่อมต่อล้มเหลว");
        } finally {
            if (btnNextStatus && btnNextStatus.dataset.targetStatus) {
                btnNextStatus.disabled = false;
            }
            if (btnNextStatusSpinner) btnNextStatusSpinner.hidden = true;
            if (btnAdminApplyStatus) btnAdminApplyStatus.disabled = false;
        }
    }

    // Load and render document status change history & Audit Trail (Task 6, 7 & 8)
    async function loadStatusHistory(docId) {
        if (!statusHistoryTimeline) return;
        statusHistoryTimeline.innerHTML = `<div class="history-loading">กำลังโหลดประวัติการดำเนินการ (Audit Trail)...</div>`;

        const apiBase = getApiBaseUrl();
        const role = localStorage.getItem("docflow_mock_role") || "staff";

        try {
            // ลองดึงจาก Audit Trail API ส่วนกลางก่อน (Task 8)
            let res = await window.apiFetch(`${apiBase}/documents/${docId}/audit-trail`);

            // Fallback ไปที่ status-history หาก audit-trail ไม่พร้อม
            if (!res.ok) {
                res = await window.apiFetch(`${apiBase}/documents/${docId}/status-history`);
            }

            if (!res.ok) {
                statusHistoryTimeline.innerHTML = `<div class="history-empty">ไม่มีประวัติการดำเนินการก่อนหน้านี้</div>`;
                return;
            }

            const data = await res.json();
            const logs = data.history || [];

            if (!logs.length) {
                statusHistoryTimeline.innerHTML = `
                    <div class="history-empty">
                        <span style="font-size: 20px;">📜</span>
                        <p>เอกสารนี้ยังไม่มีประวัติการดำเนินการ</p>
                    </div>
                `;
                return;
            }

            statusHistoryTimeline.innerHTML = logs.map((log) => {
                const timeStr = (log.timestamp || log.changed_at)
                    ? new Date(log.timestamp || log.changed_at).toLocaleString("th-TH")
                    : "-";
                const actorName = log.actor_username || log.changed_by || log.actor_user_id || "ระบบ";
                const eventType = log.event_type || (log.old_status && log.new_status ? "STATUS_CHANGE" : "EVENT");
                const details = log.details || {};
                const remarks = details.remarks || log.remarks || "";

                // จัดรูปแบบ Header ตามประเภท Event
                let headerHtml = "";
                if (eventType === "STATUS_CHANGE" || (log.old_status && log.new_status)) {
                    const oldStatus = log.before_state?.status || log.old_status;
                    const newStatus = log.after_state?.status || log.new_status;
                    const oldLabel = V3_STATUS_DETAILS[oldStatus] ? V3_STATUS_DETAILS[oldStatus].label : oldStatus;
                    const newLabel = V3_STATUS_DETAILS[newStatus] ? V3_STATUS_DETAILS[newStatus].label : newStatus;
                    const badgeClass = V3_STATUS_DETAILS[newStatus] ? V3_STATUS_DETAILS[newStatus].badgeClass : "status-received";

                    headerHtml = `
                        <span class="history-step-change">
                            <span class="old-status">${escapeHtml(oldLabel)}</span>
                            <span class="arrow">➔</span>
                            <span class="status-badge ${badgeClass} inline">${escapeHtml(newLabel)}</span>
                        </span>
                    `;
                } else if (eventType === "ASSIGN") {
                    const assignee = details.assignee_name || details.new_assignee_id || "ผู้รับมอบหมาย";
                    headerHtml = `
                        <span class="history-step-change">
                            <span class="status-badge status-assigned inline">👤 มอบหมายเอกสาร</span>
                            <span class="arrow">➔</span>
                            <strong>${escapeHtml(assignee)}</strong>
                        </span>
                    `;
                } else if (eventType === "FORWARD") {
                    const receiver = details.receiver_name || details.new_assignee_name || "หน่วยงานปลายทาง";
                    headerHtml = `
                        <span class="history-step-change">
                            <span class="status-badge inline" style="background:#f3e8ff; color:#7e22ce;">⏩ ส่งต่อเอกสาร</span>
                            <span class="arrow">➔</span>
                            <strong>${escapeHtml(receiver)}</strong>
                        </span>
                    `;
                } else if (eventType === "DOCUMENT_CREATE") {
                    headerHtml = `
                        <span class="history-step-change">
                            <span class="status-badge status-received inline">📄 ลงทะเบียนเอกสารใหม่</span>
                        </span>
                    `;
                } else {
                    headerHtml = `
                        <span class="history-step-change">
                            <span class="status-badge inline">${escapeHtml(eventType)}</span>
                        </span>
                    `;
                }

                // ข้อมูลเพิ่มเติม เช่น เหตุผลการส่งต่อ
                let extraHtml = "";
                if (details.reason) {
                    extraHtml += `<div class="history-reason" style="font-size:11.5px; color:#4338ca; margin-top:2px;">📌 เหตุผล: ${escapeHtml(details.reason)}</div>`;
                }

                return `
                    <div class="history-item">
                        <div class="history-marker"></div>
                        <div class="history-content">
                            <div class="history-header">
                                ${headerHtml}
                                <span class="history-time">${escapeHtml(timeStr)}</span>
                            </div>
                            <div class="history-meta">
                                <span class="history-actor">👤 ดำเนินการโดย: <strong>${escapeHtml(actorName)}</strong> ${log.actor_role ? `<small>(${escapeHtml(log.actor_role)})</small>` : ""}</span>
                                ${extraHtml}
                                ${remarks ? `<div class="history-remarks">💬 หมายเหตุ: ${escapeHtml(remarks)}</div>` : ""}
                            </div>
                        </div>
                    </div>
                `;
            }).join("");

        } catch (err) {
            console.error("Load status history error:", err);
            statusHistoryTimeline.innerHTML = `<div class="history-error">ไม่สามารถดึงประวัติการดำเนินการได้</div>`;
        }
    }

    /* =====================================================
       OPEN DOCUMENT MODAL
    ===================================================== */
    async function openDocumentModal(docOrId) {
        await ensureModalLoaded();
        let doc = docOrId;

        // หากส่งมาเป็น ID ให้ค้นหาจาก documents list หรือดึงจาก API
        if (typeof docOrId === "string" || typeof docOrId === "number") {
            if (Array.isArray(window.docuflowDocuments)) {
                doc = window.docuflowDocuments.find(item => String(item.id) === String(docOrId));
            }
            if (!doc) {
                try {
                    const apiBase = getApiBaseUrl();
                    const res = await window.apiFetch(`${apiBase}/documents/${docOrId}`);
                    if (res.ok) {
                        doc = await res.json();
                    }
                } catch (e) {
                    console.error("Fetch document by id error:", e);
                }
            }
        }

        if (!doc) {
            alert("ไม่พบข้อมูลเอกสาร");
            return;
        }

        currentActiveDoc = doc;
        if (window.DocuFlowAssignment) {
            window.DocuFlowAssignment.mount(doc, {
                onDone: () => { if (window.fetchDocuments) window.fetchDocuments(); }
            });
        }

        const auth = getCurrentAuth();

        // 1. เติมข้อมูลรายละเอียดเอกสาร (Details)
        if (modalDocSubject) modalDocSubject.textContent = doc.description || doc.subject || doc.number || "เอกสาร";
        if (modalTypeBadge) modalTypeBadge.textContent = doc.type || doc.document_type || "เอกสารทั่วไป";
        if (modalRefNo) modalRefNo.textContent = doc.code || doc.reference_no || "-";

        // Render Workflow UI & Load Audit History (Task 6 & 7)
        renderWorkflowUI(doc.rawStatus || doc.status || "Received", auth);
        loadStatusHistory(doc.id);

        if (modalDocNumber) modalDocNumber.textContent = doc.number || doc.document_number || "-";
        if (modalChannel) {
            const ch = doc.channel || doc.receiving_channel || "-";
            modalChannel.textContent = ch === "EMAIL" ? "อีเมล (EMAIL)" : (ch === "PAPER" ? "เอกสารกระดาษ (PAPER)" : ch);
        }
        if (modalSenderDept) modalSenderDept.textContent = doc.sender_dept || doc.sender_department || "-";
        if (modalSenderName) modalSenderName.textContent = doc.sender || doc.sender_name || "-";
        if (modalSenderContact) modalSenderContact.textContent = doc.sender_contact || "-";
        if (modalReceiver) modalReceiver.textContent = doc.receiver || doc.receiver_name || "-";
        if (modalSendDate) modalSendDate.textContent = formatDisplayDate(doc.send_date || doc.sent_date);
        if (modalReceiveDate) modalReceiveDate.textContent = formatDisplayDate(doc.receive_date);
        if (modalDeadline) modalDeadline.textContent = formatDisplayDate(doc.deadline);
        if (modalRemarks) {
            const rm = doc.remarks;
            modalRemarks.textContent = rm && rm !== "-" ? rm : "ไม่มีหมายเหตุเพิ่มเติม";
        }

        // 2. เคลียร์ viewport และแสดง loader
        if (previewViewport) {
            previewViewport.innerHTML = `
                <div class="preview-loader">
                    <div class="spinner"></div>
                    <p>กำลังเตรียมการแสดงตัวอย่างเอกสาร...</p>
                </div>
            `;
        }

        // 3. แสดง Modal
        if (documentModal && !documentModal.open) {
            documentModal.showModal();
        }

        const forwarderRoles = [
            "document_officer",
            "case_owner",
            "admin",
            "faculty_staff"
        ];

            const forwardHost = document.getElementById("forwardSectionContainer");

            if (forwardHost) {
                forwardHost.innerHTML = forwarderRoles.includes(auth.role)
                    ? renderForwardSection(doc.id)
                    : "";

                if (forwarderRoles.includes(auth.role)) {
                    const recipientSelect = document.getElementById("modalForwardAssigneeId");

                    try {
                        const response = await window.apiFetch(
                            `${getApiBaseUrl()}/forward-recipients`
                        );
                        const result = await response.json();

                        if (!response.ok) {
                            throw new Error(result.error || "โหลดรายชื่อผู้รับไม่สำเร็จ");
                        }

                    recipientSelect.replaceChildren(
                        new Option("เลือกผู้รับผิดชอบ", "")
                    );

                    for (const user of result.data || []) {
                        const displayName = user.full_name || user.username;
                        recipientSelect.add(
                            new Option(`${displayName} (${user.username})`, String(user.id))
                        );
                    }

                    if (!result.data?.length) {
                        recipientSelect.replaceChildren(
                            new Option("ไม่พบผู้รับที่ใช้งานได้", "")
                        );
                    }
                } catch (error) {
                    console.error("Load forwarding recipients error:", error);
                    recipientSelect.replaceChildren(
                        new Option("โหลดรายชื่อผู้รับไม่สำเร็จ", "")
                    );
                }
            }
        }

        // 4. กรณีไม่มีไฟล์แนบ
        if (!doc.file_key) {
            if (previewFileName) previewFileName.textContent = "ไม่มีไฟล์แนบในระบบ";
            if (previewFileSize) previewFileSize.textContent = "-";
            if (previewFileTypeTag) {
                previewFileTypeTag.textContent = "NONE";
                previewFileTypeTag.className = "file-type-pill";
            }
            if (modalDownloadBtn) modalDownloadBtn.disabled = true;
            if (modalOpenTabBtn) modalOpenTabBtn.hidden = true;

            if (previewViewport) {
                previewViewport.innerHTML = `
                    <div class="preview-empty-state">
                        <span style="font-size: 38px;">📭</span>
                        <h4>เอกสารนี้ไม่มีไฟล์แนบ</h4>
                        <p>เอกสารฉบับนี้ถูกลงทะเบียนโดยไม่มีไฟล์เอกสารอิเล็กทรอนิกส์แนบมาด้วย</p>
                    </div>
                `;
            }
            return;
        }

        // 5. ตรวจสอบสิทธิ์ (Permission Check)
        if (!auth.hasPermission) {
            const fileName = doc.file_name || doc.display_file_name || "ไฟล์เอกสารแนบ";
            if (previewFileName) previewFileName.textContent = fileName;
            if (previewFileSize) previewFileSize.textContent = "ถูกจำกัดสิทธิ์";
            if (previewFileTypeTag) {
                previewFileTypeTag.textContent = "LOCKED";
                previewFileTypeTag.className = "file-type-pill";
            }
            if (modalDownloadBtn) modalDownloadBtn.disabled = true;
            if (modalOpenTabBtn) modalOpenTabBtn.hidden = true;

            if (previewViewport) {
                previewViewport.innerHTML = `
                    <div class="permission-denied-box">
                        <div class="permission-icon">🔒</div>
                        <h4>ไม่อนุญาตให้เข้าถึง (Permission Denied)</h4>
                        <p>คุณไม่มีสิทธิ์ในการเรียกดูเนื้อหาหรือดาวน์โหลดไฟล์เอกสารนี้ เนื่องจากบทบาทปัจจุบันของคุณคือ <strong>ผู้ใช้ทั่วไป (Guest)</strong></p>
                        <p style="margin-top:10px; font-size:13px; color:#64748b;">กรุณาเข้าสู่ระบบด้วยบัญชีผู้ใช้ที่มีสิทธิ์เพื่อเปิดอ่านเอกสาร</p>
                    </div>
                `;
            }
            return;
        }

        // 6. มีสิทธิ์เข้าถึง: โหลดตัวอย่างเอกสาร
        if (modalDownloadBtn) {
            modalDownloadBtn.disabled = false;
            modalDownloadBtn.onclick = () => downloadDocumentFile(doc.id, doc.file_name || doc.display_file_name);
        }

        await loadFilePreviewContent(doc, auth);
    }

    /* =====================================================
       LOAD FILE PREVIEW CONTENT
       (PDF, JPG/JPEG, PNG -> แสดงเนื้อหา + ปุ่มดาวน์โหลด)
       (DOCX, XLSX, PPTX -> แสดงชื่อไฟล์ + ปุ่มดาวน์โหลด)
    ===================================================== */
    async function loadFilePreviewContent(doc, auth) {
        const apiBase = getApiBaseUrl();

        try {
            const token = localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token") || localStorage.getItem("docuflow_id_token") || localStorage.getItem("id_token") || "";
            const previewHeaders = {};
            if (token) previewHeaders["Authorization"] = `Bearer ${token}`;

            let previewRes = await window.apiFetch(`${apiBase}/documents/${doc.id}/preview-url`, {
                headers: previewHeaders
            });

            if (previewRes.status === 403) {
                const errData = await previewRes.json().catch(() => ({}));
                if (previewViewport) {
                    previewViewport.innerHTML = `
                        <div class="permission-denied-box">
                            <div class="permission-icon">⛔</div>
                            <h4>การเข้าถึงถูกปฏิเสธ</h4>
                            <p>${escapeHtml(errData.error || "คุณไม่มีสิทธิ์ในการเรียกดูหรือดาวน์โหลดเอกสารนี้")}</p>
                        </div>
                    `;
                }
                if (modalDownloadBtn) modalDownloadBtn.disabled = true;
                return;
            }

            if (!previewRes.ok) {
                const errData = await previewRes.json().catch(() => ({}));
                throw new Error(errData.error || `เซิร์ฟเวอร์ส่งสถานะผิดพลาด (${previewRes.status})`);
            }

            let previewData = await previewRes.json();

            const fileName = (previewData && previewData.file_name) || doc.file_name || doc.display_file_name || "เอกสารแนบ";
            const fileExt = (previewData && previewData.file_extension) || fileName.substring(fileName.lastIndexOf(".")).toLowerCase();
            let downloadUrl = (previewData && previewData.download_url) || null;
            let previewUrl = (previewData && previewData.preview_url) || null;
            const canPreview = (previewData && previewData.can_preview) !== undefined
                ? previewData.can_preview
                : [".pdf", ".jpg", ".jpeg", ".png"].includes(fileExt);

            // แปลง relative downloadUrl และ previewUrl เป็น full URL
            if (downloadUrl && downloadUrl.startsWith("/")) {
                downloadUrl = apiBase.replace(/\/api$/, "") + downloadUrl;
            }
            if (previewUrl && previewUrl.startsWith("/")) {
                previewUrl = apiBase.replace(/\/api$/, "") + previewUrl;
            }

            // Endpoint สตรีมไฟล์ตรงจากเซิร์ฟเวอร์ (รับประกันการดาวน์โหลด 100%)
            const streamUrl = `${apiBase}/documents/${doc.id}/preview-file`;
            const effectiveDownloadUrl = downloadUrl || streamUrl;

            if (previewFileName) previewFileName.textContent = fileName;
            if (previewFileSize) previewFileSize.textContent = formatBytes(previewData ? previewData.file_size : doc.file_size);

            configureFileTypeUI(fileExt);

            if (modalDownloadBtn) {
                modalDownloadBtn.onclick = () => triggerBrowserDownload(effectiveDownloadUrl, fileName);
            }

            // เงื่อนไขที่ 1: PDF, JPG/JPEG, PNG (เปิดดูเนื้อหา + ดาวน์โหลดจากหน้าตัวอย่าง)
            if (canPreview) {
                const protectedPreview = await window.apiFetch(streamUrl);
                if (!protectedPreview.ok) {
                    throw new Error("ไม่สามารถเปิดไฟล์ได้ (" + protectedPreview.status + ")");
                }
                const finalPreviewUrl = URL.createObjectURL(await protectedPreview.blob());
                if (modalOpenTabBtn) {
                    modalOpenTabBtn.hidden = false;
                    modalOpenTabBtn.onclick = () => window.open(finalPreviewUrl, "_blank");
                }

                if (fileExt === ".pdf") {
                    previewViewport.innerHTML = `
                        <iframe 
                            src="${escapeHtml(finalPreviewUrl)}#toolbar=1&navpanes=0" 
                            title="${escapeHtml(fileName)}"
                            loading="lazy"
                        ></iframe>
                    `;
                } else if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
                    previewViewport.innerHTML = `
                        <div class="preview-image-wrap">
                            <img 
                                src="${escapeHtml(finalPreviewUrl)}" 
                                alt="${escapeHtml(fileName)}" 
                                loading="lazy"
                                onerror="if(!this.dataset.fallbackTried){ this.dataset.fallbackTried='1'; this.src='${escapeHtml(streamUrl)}'; } else { this.parentElement.innerHTML='<div class=\\'preview-error\\' style=\\'text-align:center;padding:40px 20px;color:#856404;background:#fff3cd;border:1px solid #ffeeba;border-radius:8px;\\'><h4>⚠️ ไม่สามารถแสดงตัวอย่างไฟล์ได้</h4><p style=\\'margin-top:8px;font-size:13px;\\'>ไฟล์นี้ไม่มีอยู่ใน S3 Storage หรือถูกลบออกแล้ว</p></div>'; }"
                            >
                        </div>
                    `;
                }
                return;
            }

            // เงื่อนไขที่ 2: DOCX, XLSX, PPTX (แสดงชื่อไฟล์และปุ่มดาวน์โหลดไฟล์)
            if (modalOpenTabBtn) modalOpenTabBtn.hidden = true;
            let iconClass = "word";
            let iconEmoji = "📝";
            let typeName = "Microsoft Word Document (.docx)";

            if (fileExt === ".xlsx" || fileExt === ".xls") {
                iconClass = "excel";
                iconEmoji = "📊";
                typeName = "Microsoft Excel Spreadsheet (.xlsx)";
            } else if (fileExt === ".pptx" || fileExt === ".ppt") {
                iconClass = "ppt";
                iconEmoji = "📽️";
                typeName = "Microsoft PowerPoint Presentation (.pptx)";
            }

            previewViewport.innerHTML = `
                <div class="office-preview-card">
                    <div class="office-icon-large ${iconClass}">
                        <span>${iconEmoji}</span>
                    </div>
                    <h4 class="office-file-title">${escapeHtml(fileName)}</h4>
                    <p class="office-file-desc">
                        ไฟล์ประเภท <strong>${typeName}</strong><br>
                        เอกสารประเภทนี้ไม่รองรับการแสดงตัวอย่างเนื้อหาในเบราว์เซอร์โดยตรง<br>
                        สามารถตรวจสอบเนื้อหาฉบับเต็มได้โดยการกดปุ่มดาวน์โหลดไฟล์ด้านล่าง
                    </p>
                    <button type="button" class="btn-download-primary office-download-cta" id="officeDownloadBtn">
                        <span>↓</span> ดาวน์โหลดไฟล์ (${escapeHtml(previewFileSize ? previewFileSize.textContent : "ดาวน์โหลด")})
                    </button>
                </div>
            `;

            const officeDownloadBtn = document.getElementById("officeDownloadBtn");
            if (officeDownloadBtn) {
                officeDownloadBtn.onclick = () => triggerBrowserDownload(effectiveDownloadUrl, fileName);
            }

        } catch (error) {
            console.error("Preview loading error:", error);
            if (previewViewport) {
                previewViewport.innerHTML = `
                    <div class="preview-empty-state">
                        <span style="font-size: 32px;">⚠️</span>
                        <h4>ไม่สามารถโหลดตัวอย่างเอกสารได้</h4>
                        <p>${escapeHtml(error.message)}</p>
                        <button type="button" class="btn-download-primary" style="margin-top: 14px;" onclick="window.DocuFlowModal.download('${doc.id}', '${escapeHtml(doc.file_name)}')">
                            <span>↓</span> ลองดาวน์โหลดไฟล์แทน
                        </button>
                    </div>
                `;
            }
        }
    }

    function configureFileTypeUI(ext) {
        if (!previewFileIcon || !previewFileTypeTag) return;

        if (ext === ".pdf") {
            previewFileIcon.textContent = "📕";
            previewFileTypeTag.textContent = "PDF";
            previewFileTypeTag.className = "file-type-pill pdf";
        } else if ([".jpg", ".jpeg", ".png"].includes(ext)) {
            previewFileIcon.textContent = "🖼️";
            previewFileTypeTag.textContent = "IMAGE";
            previewFileTypeTag.className = "file-type-pill image";
        } else if (ext === ".docx" || ext === ".doc") {
            previewFileIcon.textContent = "📘";
            previewFileTypeTag.textContent = "DOCX";
            previewFileTypeTag.className = "file-type-pill word";
        } else if (ext === ".xlsx" || ext === ".xls") {
            previewFileIcon.textContent = "📗";
            previewFileTypeTag.textContent = "XLSX";
            previewFileTypeTag.className = "file-type-pill excel";
        } else if (ext === ".pptx" || ext === ".ppt") {
            previewFileIcon.textContent = "📙";
            previewFileTypeTag.textContent = "PPTX";
            previewFileTypeTag.className = "file-type-pill ppt";
        } else {
            previewFileIcon.textContent = "📄";
            previewFileTypeTag.textContent = "FILE";
            previewFileTypeTag.className = "file-type-pill";
        }
    }

    /* =====================================================
       DOWNLOAD FILE LOGIC
    ===================================================== */
    async function downloadDocumentFile(documentId, preferredFileName = "") {
        const auth = getCurrentAuth();
        if (!auth.hasPermission) {
            alert("⛔ ไม่อนุญาตให้เข้าถึง (Permission Denied)\n\nคุณไม่มีสิทธิ์ในการดาวน์โหลดเอกสารนี้ เนื่องจากบทบาทปัจจุบันของคุณไม่มีสิทธิ์เข้าถึง");
            return;
        }

        const apiBase = getApiBaseUrl();

        try {
            let response = await window.apiFetch(`${apiBase}/documents/${documentId}/download-url`);

            if (response.status === 403) {
                const errData = await response.json().catch(() => ({}));
                alert(`⛔ ไม่อนุญาตให้เข้าถึง: ${errData.error || "Permission Denied"}`);
                return;
            }

            if (response.ok) {
                const data = await response.json();
                if (data.download_url) {
                    let dl = data.download_url;
                    if (dl.startsWith("/")) {
                        dl = apiBase.replace(/\/api$/, "") + dl;
                    }
                    const fileName = data.file_name || preferredFileName || "document";
                    triggerBrowserDownload(dl, fileName);
                    return;
                }
            }
        } catch (error) {
            console.warn("download-url error, fallback to direct stream:", error);
        }

        // Direct stream download fallback
        const fallbackUrl = `${apiBase}/documents/${documentId}/download-file`;
        await triggerBrowserDownload(fallbackUrl, preferredFileName);
    }

    async function triggerBrowserDownload(url, fileName) {
        if (!url) return;
        let finalUrl = url;
        if (finalUrl.startsWith("/")) {
            const apiBase = getApiBaseUrl();
            finalUrl = apiBase.replace(/\/api$/, "") + finalUrl;
        }
        let downloadUrl = finalUrl;
        let objectUrl = null;
        if (new URL(finalUrl, window.location.href).origin === new URL(window.API_BASE_URL).origin &&
            new URL(finalUrl, window.location.href).pathname.includes("/api/")) {
            const response = await window.apiFetch(finalUrl);
            if (!response.ok) throw new Error("ดาวน์โหลดไฟล์ไม่สำเร็จ (" + response.status + ")");
            objectUrl = URL.createObjectURL(await response.blob());
            downloadUrl = objectUrl;
        }
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = fileName || "document";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            link.remove();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        }, 1000);
    }

    // Auto-load template upon DOM readiness
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            ensureModalLoaded();
        });
    } else {
        ensureModalLoaded();
    }

    function refreshWorkflowUI() {
        if (currentActiveDoc && documentModal && documentModal.open) {
            const auth = getCurrentAuth();
            renderWorkflowUI(currentActiveDoc.rawStatus || currentActiveDoc.status || "Received", auth);
        }
    }

    // Expose ไปยัง window object
    window.DocuFlowModal = {
        open: openDocumentModal,
        download: downloadDocumentFile,
        close: () => { if (documentModal && documentModal.open) documentModal.close(); },
        ensureLoaded: ensureModalLoaded,
        getApiBaseUrl: getApiBaseUrl,
        refreshWorkflowUI: refreshWorkflowUI,
        changeStatus: changeDocumentStatus
    };
    window.openDocumentModal = openDocumentModal;
    window.downloadDocumentFile = downloadDocumentFile;

})(window);

// 1. ฟังก์ชันสร้างกล่องฟอร์ม UI สำหรับการส่งต่อเอกสาร (Issue #32)
function renderForwardSection(documentId) {
    return `
        <div class="forward-container" style="margin-top: 15px; padding: 15px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
            <h4 style="margin-bottom: 10px; font-size: 15px; color: #166534;">ส่งต่อเอกสาร (Issue #32)</h4>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; font-size: 13px; margin-bottom: 4px; color: #374151;">รหัสผู้รับส่งต่อ (New Assignee ID):</label>
                <select id="modalForwardAssigneeId"
                        style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px;">
                    <option value="">กำลังโหลดรายชื่อผู้รับ...</option>
                </select>
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; font-size: 13px; margin-bottom: 4px; color: #374151;">ชื่อผู้รับ / หน่วยงานปลายทาง (Receiver Name):</label>
                <input type="text" id="modalForwardReceiverName" placeholder="ระบุชื่อหน่วยงานหรือผู้รับ..." style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; font-size: 13px; margin-bottom: 4px; color: #374151;">เหตุผลในการส่งต่อ (Reason):</label>
                <input type="text" id="modalForwardReason" placeholder="ระบุเหตุผลในการส่งต่อเอกสาร..." style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px;">
            </div>

            <button type="button" onclick="submitDocumentForward('${documentId}')" style="background: #16a34a; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500;">
                ยืนยันการส่งต่อเอกสาร
            </button>
        </div>
    `;
}

// 2. ฟังก์ชันยิง API ไปที่ Backend เพื่อบันทึกการส่งต่อเอกสาร
async function submitDocumentForward(documentId) {
    const newAssigneeId = document.getElementById("modalForwardAssigneeId").value.trim();
    const receiverName = document.getElementById("modalForwardReceiverName").value.trim();
    const reason = document.getElementById("modalForwardReason").value.trim();

    if (!newAssigneeId && !receiverName) {
        alert("กรุณาระบุรหัสผู้รับ (New Assignee ID) หรือชื่อผู้รับปลายทางอย่างน้อยหนึ่งอย่าง");
        return;
    }

    try {
        const apiBase = getApiBaseUrl();
        const authToken = localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token") || localStorage.getItem("docuflow_id_token") || localStorage.getItem("id_token") || "";
        const response = await window.apiFetch(`${apiBase}/documents/${documentId}/forward`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": authToken ? `Bearer ${authToken}` : ""
            },
            body: JSON.stringify({
                new_assignee_id: newAssigneeId || null,
                receiver_name: receiverName || null,
                reason: reason
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "ไม่สามารถส่งต่อเอกสารได้");
        }

        alert("ส่งต่อเอกสารสำเร็จเรียบร้อย!");
        location.reload(); // รีเฟรชหน้าจอเพื่ออัปเดตข้อมูลล่าสุด
    } catch (error) {
        console.error("Forward error:", error);
        alert("เกิดข้อผิดพลาด: " + error.message);
    }
}
