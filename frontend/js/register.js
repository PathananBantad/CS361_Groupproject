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

    if (files.length === 0) return;

    const file = files[0];

    const allowedExtensions = [
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png",
        ".doc",
        ".docx"
    ];

    const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    const extension = file.name
        .substring(file.name.lastIndexOf("."))
        .toLowerCase();

    const maxFileSize = 10 * 1024 * 1024;

    // ตรวจประเภทไฟล์
    if (
        !allowedExtensions.includes(extension) ||
        !allowedTypes.includes(file.type)
    ) {
        alert(
            "ไม่รองรับไฟล์ประเภทนี้\n\n" +
            "รองรับเฉพาะ PDF, JPG, JPEG, PNG, DOC และ DOCX เท่านั้น"
        );

        fileInput.value = "";
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
        return;
    }

    // ตรวจขนาด
    if (file.size > maxFileSize) {
        alert("ไฟล์มีขนาดเกิน 10 MB");

        fileInput.value = "";
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
        return;
    }

    // ผ่าน validation แล้วค่อยใส่ไฟล์
    fileInput.files = files;
    fileText.textContent = file.name;
});

/* =====================================================
   REGISTER & VALIDATION
===================================================== */

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // 1. ป้องกันการกด Submit ซ้ำ
    if (submitBtn.disabled) return;

    // 2. ดึงค่าจากฟิลด์ต่างๆ
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

    // =====================================================
    // FILE VALIDATION
    // =====================================================

    const file = fileInput.files[0];

    // ต้องแนบไฟล์ก่อน
    if (!file) {
        alert("กรุณาแนบไฟล์เอกสาร");
        return;
    }

    // ประเภทไฟล์ที่อนุญาต
    const allowedExtensions = [
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png",
        ".doc",
        ".docx"
    ];

    const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    const maxFileSize = 10 * 1024 * 1024; // 10 MB

    // เอานามสกุลไฟล์ออกมา
    const fileName = file.name.trim();
    const extension = fileName
        .substring(fileName.lastIndexOf("."))
        .toLowerCase();

    // ตรวจชื่อไฟล์
    if (!fileName) {
        alert("ไม่พบชื่อไฟล์ กรุณาเลือกไฟล์ใหม่");
        fileInput.value = "";
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
        return;
    }

    // ตรวจนามสกุลไฟล์
    if (!allowedExtensions.includes(extension)) {
        alert(
            "ไม่รองรับไฟล์ประเภทนี้\n\n" +
            "รองรับเฉพาะ PDF, JPG, JPEG, PNG, DOC และ DOCX เท่านั้น"
        );

        fileInput.value = "";
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
        return;
    }

    // ตรวจ MIME Type
    if (!allowedTypes.includes(file.type)) {
        alert(
            "ไฟล์นี้ไม่ใช่ประเภทไฟล์ที่ระบบรองรับ\n\n" +
            "กรุณาเลือก PDF, JPG, JPEG, PNG, DOC หรือ DOCX"
        );

        fileInput.value = "";
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
        return;
    }

    // ตรวจขนาดไฟล์
    if (file.size > maxFileSize) {
        alert("ไฟล์มีขนาดเกิน 10 MB");

        fileInput.value = "";
        fileText.textContent = "เลือกไฟล์ หรือลากไฟล์มาวางที่นี่...";
        return;
    }

    // =====================================================
    // OTHER VALIDATION
    // =====================================================

    const allowedChannels = ["EMAIL", "PAPER"];

    if (!allowedChannels.includes(receiveChannel)) {
        alert("กรุณาเลือกช่องทางรับเอกสารเป็น EMAIL หรือ PAPER");
        return;
    }

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

    // =====================================================
    // SUBMIT
    // =====================================================

    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.7";
    submitBtn.style.cursor = "not-allowed";
    submitText.textContent = "กำลังบันทึกข้อมูล...";

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
        const response = await fetch("https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents", {
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

            // Get presigned URL
            const s3UrlRes = await fetch(`https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents/${docData.id}/upload-url?fileName=${encodeURIComponent(file.name)}&contentType=${encodeURIComponent(file.type || 'application/octet-stream')}`, {
            });

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