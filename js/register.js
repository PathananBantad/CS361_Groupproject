/* =====================================================
   REGISTER DOCUMENT
===================================================== */

const registerForm = document.getElementById("registerForm");
const fileInput = document.getElementById("file");
const fileText = document.getElementById("fileText");
const uploadBox = document.querySelector(".upload-box");
const submitBtn = document.getElementById("submitBtn");
const submitText = document.getElementById("submitText");

/* =====================================================
   FILE NAME
===================================================== */

fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
        fileText.textContent = fileInput.files[0].name;
    } else {
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
    }
});

/* =====================================================
   DRAG & DROP
===================================================== */

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
    if (files.length > 0) {
        fileInput.files = files;
        fileText.textContent = files[0].name;
    }
});

/* =====================================================
   REGISTER & VALIDATION
===================================================== */

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // 1. ป้องกันการกด Submit ซ้ำ
    if (submitBtn.disabled) return;

    // 2. ดึงค่าจากฟิลด์ต่างๆ (เฉพาะที่ Required)
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
    const fileAttached = fileInput.files.length > 0;

    // 3. ตรวจสอบข้อมูลก่อน Submit (Validation)
    if (!receiveChannel || !documentType || !docNo || !subject || !senderDept || !senderName || !senderContact || !recipient || !sendDate || !receiveDate || !fileAttached) {
        alert("กรุณากรอกข้อมูลที่จำเป็น (*) และแนบไฟล์ให้ครบถ้วน");
        return;
    }

    // 4. แสดงสถานะกำลังโหลด และ Disable ปุ่ม
    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.7";
    submitBtn.style.cursor = "not-allowed";
    submitText.textContent = "กำลังบันทึกข้อมูล...";

    try {
        const docRefInput = document.getElementById("documentReference") || document.getElementById("document_reference");
        const documentReference = (docRefInput && docRefInput.value) ? docRefInput.value : generateDocumentReference();
        console.log("สร้างเลขอ้างอิง:", documentReference);

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

        // 1. Save document to DB
        const response = await fetch("http://localhost:3000/api/documents", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || "Failed to register document");
        }

        const docData = await response.json();

        // 2. Upload file if attached
        if (fileAttached) {
            const file = fileInput.files[0];

            // Get presigned URL
            const s3UrlRes = await fetch(`http://localhost:3000/api/documents/${docData.id}/upload-url?fileName=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type || 'application/octet-stream')}`);
            if (!s3UrlRes.ok) {
                const errData = await s3UrlRes.json().catch(() => ({}));
                throw new Error(errData.error || "Failed to get upload URL");
            }
            const s3Data = await s3UrlRes.json();

            // Put file to S3
            const uploadRes = await fetch(s3Data.upload_url, {
                method: "PUT",
                headers: {
                    "Content-Type": file.type || 'application/octet-stream'
                },
                body: file
            });

            if (!uploadRes.ok) {
                throw new Error("Failed to upload file to S3");
            }
        }

        alert(`ลงทะเบียนเอกสารสำเร็จ!\nเลขอ้างอิงของคุณคือ: ${docData.reference_no}`);

        // Reset ฟอร์มหลังบันทึกสำเร็จ
        registerForm.reset();
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";

        const nextDocRefInput = document.getElementById("documentReference") || document.getElementById("document_reference");
        if (nextDocRefInput) {
            nextDocRefInput.value = generateDocumentReference();
        }

    } catch (error) {
        console.error("Error saving document:", error);
        alert(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
        // คืนค่าปุ่มกลับสู่สภาพเดิม
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        submitBtn.style.cursor = "pointer";
        submitText.textContent = "ลงทะเบียนเอกสาร";
    }
});

<<<<<<< HEAD
// สร้างเลขอ้างอิงเอกสารอัตโนมัติ (DOC-YYYYMMDD-XXXX)
function generateDocumentReference(existingDocs = []) {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    let isUnique = false;
    let newRef = '';

    while (!isUnique) {
        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        newRef = `DOC-${dateStr}-${randomDigits}`;

        // ตรวจสอบว่าเลขอ้างอิงไม่ซ้ำ
        const isDuplicate = existingDocs.some(
            doc => doc.documentReference === newRef || doc.docNo === newRef || doc.trackingNo === newRef
        );
        if (!isDuplicate) {
            isUnique = true;
        }
    }

    return newRef;
}

document.addEventListener("DOMContentLoaded", () => {
  const docRefInput = document.getElementById("documentReference") 
                   || document.getElementById("docNo")
                   || document.getElementById("reference_no")
                   || document.getElementById("document_reference");
  if (docRefInput) {
    // สร้างเลขอ้างอิงและใส่ลงใน input อัตโนมัติ พร้อมตั้ง readonly
    docRefInput.value = generateDocumentReference();
    docRefInput.readOnly = true;
  }
});

window.generateDocumentReference = generateDocumentReference;
=======
>>>>>>> 8fac1154bfe42b5f0cc6542c4c00acb83a7e6eb5
