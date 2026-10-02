/* =====================================================
   REGISTER DOCUMENT
===================================================== */

const registerForm = document.getElementById("registerForm");
const fileInput = document.getElementById("file");
const fileText = document.getElementById("fileText");
const uploadBox = document.querySelector(".upload-box");


/* =====================================================
   FILE NAME
===================================================== */

fileInput.addEventListener("change", () => {

    if (fileInput.files.length > 0) {

        fileText.textContent =
            fileInput.files[0].name;

    } else {

        fileText.textContent =
            "Choose file or drag here...";

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
   REGISTER
===================================================== */

registerForm.addEventListener("submit", (event) => {

    event.preventDefault();

    const documentName =
        document.getElementById("documentName").value.trim();

    const documentType =
        document.getElementById("documentType").value;

    const recipient =
        document.getElementById("recipient").value.trim();

    if (!documentName || !documentType || !recipient) {

        alert("กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน");

        return;

    }

    /*
     * ตอนนี้เป็น Frontend Demo
     * สามารถเปลี่ยนส่วนนี้เป็น API ของ Backend ได้ภายหลัง
     */

    alert("ลงทะเบียนเอกสารเรียบร้อยแล้ว");

    registerForm.reset();

    fileText.textContent =
        "Choose file or drag here...";

});
