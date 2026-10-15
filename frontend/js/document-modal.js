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

    let previewFileIcon = null;
    let previewFileName = null;
    let previewFileTypeTag = null;
    let previewFileSize = null;
    let previewViewport = null;
    let modalDownloadBtn = null;

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

        previewFileIcon = document.getElementById("previewFileIcon");
        previewFileName = document.getElementById("previewFileName");
        previewFileTypeTag = document.getElementById("previewFileTypeTag");
        previewFileSize = document.getElementById("previewFileSize");
        previewViewport = document.getElementById("previewViewport");
        modalDownloadBtn = document.getElementById("modalDownloadBtn");

        if (modalCloseBtn && documentModal && !documentModal.dataset.eventsBound) {
            documentModal.dataset.eventsBound = "true";

            modalCloseBtn.addEventListener("click", () => {
                documentModal.close();
            });

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
                <div class="modal-body">
                    <section class="modal-details-card">
                        <div class="details-section-title"><span aria-hidden="true">📋</span> รายละเอียดเอกสาร</div>
                        <div class="modal-meta-grid">
                            <div class="meta-item"><span class="meta-label">เลขที่หนังสือ</span><span class="meta-value" id="modalDocNumber">-</span></div>
                            <div class="meta-item"><span class="meta-label">ช่องทางรับเอกสาร</span><span class="meta-value" id="modalChannel">-</span></div>
                            <div class="meta-item"><span class="meta-label">หน่วยงานผู้ส่ง</span><span class="meta-value" id="modalSenderDept">-</span></div>
                            <div class="meta-item"><span class="meta-label">ชื่อผู้ส่ง</span><span class="meta-value" id="modalSenderName">-</span></div>
                            <div class="meta-item"><span class="meta-label">ช่องทางติดต่อผู้ส่ง</span><span class="meta-value" id="modalSenderContact">-</span></div>
                            <div class="meta-item"><span class="meta-label">ผู้รับ</span><span class="meta-value" id="modalReceiver">-</span></div>
                            <div class="meta-item"><span class="meta-label">วันที่ส่ง</span><span class="meta-value" id="modalSendDate">-</span></div>
                            <div class="meta-item"><span class="meta-label">วันที่รับ</span><span class="meta-value" id="modalReceiveDate">-</span></div>
                            <div class="meta-item"><span class="meta-label">วันครบกำหนด (DEADLINE)</span><span class="meta-value" id="modalDeadline">-</span></div>
                            <div class="meta-item full-width" id="modalRemarksWrap"><span class="meta-label">หมายเหตุ</span><p class="meta-value remarks-box" id="modalRemarks">-</p></div>
                        </div>
                    </section>
                    <section class="modal-preview-card">
                        <div class="preview-header">
                            <div class="preview-file-summary">
                                <div class="file-icon-box" id="previewFileIconBox"><span id="previewFileIcon">📄</span></div>
                                <div class="preview-file-titles"><h3 id="previewFileName">ชื่อไฟล์เอกสาร</h3><div class="preview-file-sub"><span id="previewFileTypeTag" class="file-type-pill">PDF</span><span id="previewFileSize">-</span></div></div>
                            </div>
                            <div class="preview-actions"><button type="button" class="btn-download-primary" id="modalDownloadBtn"><span>↓</span> ดาวน์โหลดไฟล์</button></div>
                        </div>
                        <div class="preview-viewport" id="previewViewport"><div class="preview-loader" id="previewLoader"><div class="spinner"></div><p>กำลังเตรียมการแสดงตัวอย่างเอกสาร...</p></div></div>
                    </section>
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
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            return `${window.location.protocol}//${window.location.hostname}:3000/api`;
        }
        return "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api";
    }

    // Helper ดึงสิทธิ์ปัจจุบัน
    function getCurrentAuth() {
        const role = localStorage.getItem("docuflow_role") || "staff";
        const user = localStorage.getItem("docuflow_user") || "staff01";
        return {
            role,
            user,
            hasPermission: role === "staff" || role === "admin"
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
                    const res = await fetch(`${apiBase}/documents/${docOrId}`);
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

        // 1. เติมข้อมูลรายละเอียดเอกสาร (Details)
        if (modalDocSubject) modalDocSubject.textContent = doc.description || doc.subject || doc.number || "เอกสาร";
        if (modalTypeBadge) modalTypeBadge.textContent = doc.type || doc.document_type || "เอกสารทั่วไป";
        if (modalRefNo) modalRefNo.textContent = doc.code || doc.reference_no || "-";
        if (modalStatusBadge) {
            modalStatusBadge.textContent = doc.statusLabel || doc.status || "-";
            modalStatusBadge.className = `status-badge status-${doc.statusKey || "waiting"}`;
        }

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

        // 4. กรณีไม่มีไฟล์แนบ
        if (!doc.file_key) {
            if (previewFileName) previewFileName.textContent = "ไม่มีไฟล์แนบในระบบ";
            if (previewFileSize) previewFileSize.textContent = "-";
            if (previewFileTypeTag) {
                previewFileTypeTag.textContent = "NONE";
                previewFileTypeTag.className = "file-type-pill";
            }
            if (modalDownloadBtn) modalDownloadBtn.disabled = true;

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
        const auth = getCurrentAuth();
        if (!auth.hasPermission) {
            const fileName = doc.file_name || doc.display_file_name || "ไฟล์เอกสารแนบ";
            if (previewFileName) previewFileName.textContent = fileName;
            if (previewFileSize) previewFileSize.textContent = "ถูกจำกัดสิทธิ์";
            if (previewFileTypeTag) {
                previewFileTypeTag.textContent = "LOCKED";
                previewFileTypeTag.className = "file-type-pill";
            }
            if (modalDownloadBtn) modalDownloadBtn.disabled = true;

            if (previewViewport) {
                previewViewport.innerHTML = `
                    <div class="permission-denied-box">
                        <div class="permission-icon">🔒</div>
                        <h4>ไม่อนุญาตให้เข้าถึง (Permission Denied)</h4>
                        <p>คุณไม่มีสิทธิ์ในการเรียกดูเนื้อหาหรือดาวน์โหลดไฟล์เอกสารนี้ เนื่องจากบทบาทปัจจุบันของคุณคือ <strong>ผู้ใช้ทั่วไป (Guest)</strong></p>
                        <button type="button" class="btn-switch-role" id="btnSwitchToStaffModal">
                            สลับเป็นบทบาท "เจ้าหน้าที่ (Staff)" เพื่อเปิดไฟล์
                        </button>
                    </div>
                `;

                const switchBtn = document.getElementById("btnSwitchToStaffModal");
                if (switchBtn) {
                    switchBtn.addEventListener("click", () => {
                        if (typeof window.setUserRole === "function") {
                            window.setUserRole("staff", "staff01");
                        } else {
                            localStorage.setItem("docuflow_role", "staff");
                            localStorage.setItem("docuflow_user", "staff01");
                        }
                        openDocumentModal(doc);
                    });
                }
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
            let previewRes = await fetch(`${apiBase}/documents/${doc.id}/preview-url?role=${auth.role}&userId=${auth.user}`);

            if (!previewRes.ok && apiBase.includes("localhost")) {
                previewRes = await fetch(`https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents/${doc.id}/preview-url?role=${auth.role}&userId=${auth.user}`);
            }

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

            let previewData = null;
            if (previewRes.ok) {
                previewData = await previewRes.json();
            }

            const fileName = (previewData && previewData.file_name) || doc.file_name || doc.display_file_name || "เอกสารแนบ";
            const fileExt = (previewData && previewData.file_extension) || fileName.substring(fileName.lastIndexOf(".")).toLowerCase();
            let downloadUrl = (previewData && previewData.download_url) || null;
            let previewUrl = (previewData && previewData.preview_url) || null;
            const canPreview = (previewData && previewData.can_preview) !== undefined
                ? previewData.can_preview
                : [".pdf", ".jpg", ".jpeg", ".png"].includes(fileExt);

            // แปลง relative downloadUrl เป็น full URL
            if (downloadUrl && downloadUrl.startsWith("/")) {
                downloadUrl = apiBase.replace(/\/api$/, "") + downloadUrl;
            }

            // Endpoint สตรีมไฟล์ตรงจากเซิร์ฟเวอร์ (รับประกันการดาวน์โหลด 100%)
            const streamUrl = `${apiBase}/documents/${doc.id}/download-file?role=${encodeURIComponent(auth.role)}&userId=${encodeURIComponent(auth.user)}`;
            const effectiveDownloadUrl = downloadUrl || streamUrl;

            if (previewFileName) previewFileName.textContent = fileName;
            if (previewFileSize) previewFileSize.textContent = formatBytes(previewData ? previewData.file_size : doc.file_size);

            configureFileTypeUI(fileExt);

            if (modalDownloadBtn) {
                modalDownloadBtn.onclick = () => triggerBrowserDownload(effectiveDownloadUrl, fileName);
            }

            // เงื่อนไขที่ 1: PDF, JPG/JPEG, PNG (เปิดดูเนื้อหา + ดาวน์โหลดจากหน้าตัวอย่าง)
            if (canPreview) {
                const finalPreviewUrl = previewUrl || streamUrl;

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
                                onerror="if(!this.dataset.fallbackTried){ this.dataset.fallbackTried='1'; this.src='${escapeHtml(streamUrl)}'; }"
                            >
                        </div>
                    `;
                }
                return;
            }

            // เงื่อนไขที่ 2: DOCX, XLSX, PPTX (แสดงชื่อไฟล์และปุ่มดาวน์โหลดไฟล์)
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
            alert("⛔ ไม่อนุญาตให้เข้าถึง (Permission Denied)\n\nคุณไม่มีสิทธิ์ในการดาวน์โหลดเอกสารนี้ กรุณาสลับเป็นบทบาท 'เจ้าหน้าที่' หรือ 'ผู้ดูแลระบบ'");
            return;
        }

        const apiBase = getApiBaseUrl();

        try {
            let response = await fetch(`${apiBase}/documents/${documentId}/download-url?role=${auth.role}&userId=${auth.user}`);

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
        const fallbackUrl = `${apiBase}/documents/${documentId}/download-file?role=${encodeURIComponent(auth.role)}&userId=${encodeURIComponent(auth.user)}`;
        triggerBrowserDownload(fallbackUrl, preferredFileName);
    }

    function triggerBrowserDownload(url, fileName) {
        if (!url) return;
        let finalUrl = url;
        if (finalUrl.startsWith("/")) {
            const apiBase = getApiBaseUrl();
            finalUrl = apiBase.replace(/\/api$/, "") + finalUrl;
        }
        const link = document.createElement("a");
        link.href = finalUrl;
        link.download = fileName || "document";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 200);
    }

    // Auto-load template upon DOM readiness
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            ensureModalLoaded();
        });
    } else {
        ensureModalLoaded();
    }

    // Expose ไปยัง window object
    window.DocuFlowModal = {
        open: openDocumentModal,
        download: downloadDocumentFile,
        close: () => { if (documentModal && documentModal.open) documentModal.close(); },
        ensureLoaded: ensureModalLoaded
    };
    window.openDocumentModal = openDocumentModal;
    window.downloadDocumentFile = downloadDocumentFile;

})(window);
