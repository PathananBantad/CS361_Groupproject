/* =====================================================
   REGISTER DOCUMENT
   Electronic Mailbox & Document Flow System
===================================================== */

const registerForm = document.getElementById("registerForm");
const fileInput = document.getElementById("file");
const fileText = document.getElementById("fileText");
const uploadBox = document.querySelector(".upload-box");
const submitBtn = document.getElementById("submitBtn");
const submitText = document.getElementById("submitText");

// รายการนามสกุลไฟล์ที่ระบบรองรับ (PDF, DOCX, JPG/JPEG, PNG, XLSX, PPTX)
const ALLOWED_EXTENSIONS = [
    ".pdf",
    ".docx",
    ".jpg",
    ".jpeg",
    ".png",
    ".xlsx",
    ".pptx"
];

// รายการ MIME Types ที่รองรับ
const MIME_TYPE_MAP = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Helper เพื่อหา API URL ที่เหมาะสม
function getApiBaseUrl() {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        return `${window.location.protocol}//${window.location.hostname}:3000/api`;
    }
    return "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api";
}

/* =====================================================
   VALIDATE FILE
===================================================== */
function validateSelectedFile(file) {
    if (!file) {
        return { valid: false, message: "กรุณาแนบไฟล์เอกสาร" };
    }

    const fileName = (file.name || "").trim();
    if (!fileName) {
        return { valid: false, message: "ไม่พบชื่อไฟล์ กรุณาเลือกไฟล์ใหม่" };
    }

    const ext = fileName.substring(fileName.lastIndexOf(".")).toLowerCase();

    // 1. ตรวจสอบนามสกุลไฟล์
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return {
            valid: false,
            message: "ไม่รองรับประเภทไฟล์นี้\n\nระบบรองรับเฉพาะไฟล์ PDF, DOCX, JPG/JPEG, PNG, XLSX และ PPTX เท่านั้น"
        };
    }

    // 2. ตรวจสอบขนาดไฟล์
    if (file.size > MAX_FILE_SIZE) {
        return {
            valid: false,
            message: `ไฟล์มีขนาดเกินกำหนด (${(file.size / (1024 * 1024)).toFixed(2)} MB)\nระบบจำกัดขนาดไฟล์ไม่เกิน 10 MB`
        };
    }

    return { valid: true, extension: ext, resolvedMime: MIME_TYPE_MAP[ext] || file.type || "application/octet-stream" };
}

/* =====================================================
   FILE INPUT CHANGE
===================================================== */
fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const validation = validateSelectedFile(file);

        if (!validation.valid) {
            alert(validation.message);
            fileInput.value = "";
            fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
            return;
        }

        const sizeInMb = (file.size / (1024 * 1024)).toFixed(2);
        fileText.textContent = `📎 ${file.name} (${sizeInMb} MB)`;
    } else {
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
    }
});

/* =====================================================
   DRAG & DROP
===================================================== */
if (uploadBox) {
    ["dragenter", "dragover"].forEach(eventName => {
        uploadBox.addEventListener(eventName, (event) => {
            event.preventDefault();
            uploadBox.classList.add("dragging");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        uploadBox.addEventListener(eventName, (event) => {
            event.preventDefault();
            uploadBox.classList.remove("dragging");
        });
    });

    uploadBox.addEventListener("drop", (event) => {
        const files = event.dataTransfer.files;
        if (files.length === 0) return;

        const file = files[0];
        const validation = validateSelectedFile(file);

        if (!validation.valid) {
            alert(validation.message);
            fileInput.value = "";
            fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
            return;
        }

        fileInput.files = files;
        const sizeInMb = (file.size / (1024 * 1024)).toFixed(2);
        fileText.textContent = `📎 ${file.name} (${sizeInMb} MB)`;
    });
}

/* =====================================================
   REGISTER & VALIDATION
===================================================== */
registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (submitBtn.disabled) return;

    const receiveChannel = document.getElementById("receiveChannel").value;
    const documentType = document.getElementById("documentType").value;
    const docNo = document.getElementById("docNo").value.trim();
    const subject = document.getElementById("subject").value.trim();
    const senderDept = document.getElementById("senderDept").value.trim();
    const senderName = document.getElementById("senderName").value.trim();
    const senderContact = document.getElementById("senderContact").value.trim();
    const recipient = document.getElementById("recipient").value.trim();
    const sendDate = document.getElementById("sendDate").value;
    const receiveDate = document.getElementById("receiveDate").value;
    const deadline = document.getElementById("deadline").value;
    const remarks = document.getElementById("remarks").value.trim();

    // 1. ตรวจสอบไฟล์
    const file = fileInput.files[0];
    const fileValidation = validateSelectedFile(file);
    if (!fileValidation.valid) {
        alert(fileValidation.message);
        return;
    }

    // 2. ตรวจสอบช่องทางรับ
    const allowedChannels = ["EMAIL", "PAPER"];
    if (!allowedChannels.includes(receiveChannel)) {
        alert("กรุณาเลือกช่องทางรับเอกสารเป็น EMAIL หรือ PAPER");
        return;
    }

    // 3. ตรวจสอบฟิลด์จำเป็น
    if (
        !receiveChannel ||
        !documentType ||
        !docNo ||
        !subject ||
        !senderDept ||
        !senderName ||
        !senderContact ||
        !recipient ||
        !sendDate ||
        !receiveDate
    ) {
        alert("กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน");
        return;
    }

    // 4. แสดงสถานะกำลังบันทึก
    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.7";
    submitBtn.style.cursor = "not-allowed";
    submitText.textContent = "กำลังบันทึกข้อมูลและอัปโหลดไฟล์...";

    const apiBase = getApiBaseUrl();

    try {
        const payload = {
            document_number: docNo,
            subject: subject,
            document_type: documentType,
            sender_name: senderName,
            sender_department: senderDept,
            sender_contact: senderContact,
            receiver_name: recipient,
            sent_date: sendDate,
            receive_date: receiveDate,
            deadline: deadline || null,
            remarks: remarks || null,
            receiving_channel: receiveChannel
        };

        // 1. บันทึกเอกสารเข้าฐานข้อมูล
        let response = await fetch(`${apiBase}/documents`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        // หากเรียก local แล้วไม่ตอบสนอง ให้ลอง fallback ไปยัง AWS API Gateway
        if (!response.ok && apiBase.includes("localhost")) {
            console.warn("Local API failed, falling back to AWS API Gateway...");
            response = await fetch(`https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || "ไม่สามารถลงทะเบียนเอกสารได้");
        }

        const docData = await response.json();

        // 2. ดำเนินการอัปโหลดไฟล์ไปยัง S3
        if (file) {
            submitText.textContent = "กำลังอัปโหลดไฟล์เข้าสู่ระบบจัดเก็บ...";

            const contentType = fileValidation.resolvedMime;
            const uploadUrlEndpoint = `${apiBase}/documents/${docData.id}/upload-url?fileName=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(contentType)}&fileSize=${file.size}`;

            let s3UrlRes = await fetch(uploadUrlEndpoint);

            if (!s3UrlRes.ok && apiBase.includes("localhost")) {
                s3UrlRes = await fetch(`https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents/${docData.id}/upload-url?fileName=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(contentType)}&fileSize=${file.size}`);
            }

            if (!s3UrlRes.ok) {
                const errData = await s3UrlRes.json().catch(() => ({}));
                throw new Error(errData.error || "ไม่สามารถสร้างลิงก์สำหรับอัปโหลดไฟล์ได้");
            }

            const s3Data = await s3UrlRes.json();

            // PUT ไฟล์ไปยัง S3 Presigned URL
            const uploadRes = await fetch(s3Data.upload_url, {
                method: "PUT",
                headers: {
                    "Content-Type": contentType
                },
                body: file
            });

            if (!uploadRes.ok) {
                throw new Error("เกิดข้อผิดพลาดในการอัปโหลดไฟล์ไปยัง S3 Storage");
            }

            // 3. บันทึก Metadata ไฟล์ลงฐานข้อมูล (document_files)
            try {
                await fetch(`${apiBase}/documents/${docData.id}/file-metadata`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        fileName: file.name,
                        fileSize: file.size,
                        mimeType: contentType,
                        fileKey: s3Data.file_key
                    })
                });
            } catch (metaErr) {
                console.warn("Metadata confirmation notice:", metaErr);
            }
        }

        alert(`✓ ลงทะเบียนเอกสารสำเร็จ!\n\nเลขอ้างอิงระบบ: ${docData.reference_no}\nประเภทเอกสาร: ${docData.document_type}\nไฟล์แนบ: ${file ? file.name : '-'}`);

        // Reset แบบฟอร์ม
        registerForm.reset();
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";

    } catch (error) {
        console.error("Error saving document:", error);
        alert(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        submitBtn.style.cursor = "pointer";
        submitText.textContent = "ลงทะเบียนเอกสาร";
    }
});