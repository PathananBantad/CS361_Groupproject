(() => {
    "use strict";

    const api = window.DocuFlowShareLinks;
    const token = new URLSearchParams(window.location.search).get("token");
    const status = document.getElementById("sharedStatus");
    const details = document.getElementById("sharedDocument");
    const actions = document.getElementById("sharedActions");
    const preview = document.getElementById("sharedFilePreview");
    const previewFallback = document.getElementById("sharedPreviewFallback");
    const previewLink = document.getElementById("sharedPreviewLink");
    const previewButton = document.getElementById("sharedPreview");
    const downloadButton = document.getElementById("sharedDownload");

    const unavailableStatuses = [400, 401, 403, 404, 410];

    function showError(error) {
        status.textContent = unavailableStatuses.includes(error.status)
            ? "ลิงก์นี้ใช้งานไม่ได้ กรุณาขอลิงก์ใหม่จากผู้ส่ง"
            : api.message(error);
    }

    async function showFile(mode) {
        previewButton.disabled = true;
        downloadButton.disabled = true;
        status.textContent = "กำลังเตรียมไฟล์…";
        try {
            const data = await api.readResponse(await api.publicRequest(token));
            const url = fileUrl(mode === "preview" ? data.preview_url : data.download_url);
            if (!url) throw new Error("Invalid file URL");

            if (mode === "preview") {
                preview.src = url.href;
                preview.hidden = false;
                previewLink.href = url.href;
                previewFallback.hidden = false;
            } else {
                const link = document.createElement("a");
                link.href = url.href;
                link.rel = "noreferrer";
                link.click();
            }
            status.textContent = "";
        } catch (error) {
            if (unavailableStatuses.includes(error.status)) {
                details.hidden = true;
                preview.hidden = true;
                preview.removeAttribute("src");
                previewFallback.hidden = true;
                previewLink.removeAttribute("href");
            }
            showError(error);
        } finally {
            previewButton.disabled = false;
            downloadButton.disabled = false;
        }
    }

    // The share response supplies short-lived URLs. Field names await the API schema.
    function fileUrl(value) {
        try {
            const url = new URL(value);
            if (url.protocol === "https:" || (window.IS_LOCAL && url.origin === window.location.origin)) return url;
        } catch {
            return null;
        }
        return null;
    }

    async function loadDocument() {
        if (!token?.trim()) {
            status.textContent = "ลิงก์นี้ไม่มีรหัสเอกสาร กรุณาตรวจสอบลิงก์จากผู้ส่ง";
            return;
        }
        try {
            const { document: doc, preview_url, download_url } = await api.readResponse(await api.publicRequest(token));
            document.getElementById("sharedSubject").textContent = doc.subject || "เอกสารที่แชร์";
            document.getElementById("sharedReference").textContent = doc.reference_no || "–";
            document.getElementById("sharedType").textContent = doc.document_type || "–";
            document.getElementById("sharedFilename").textContent = doc.file_name || "–";
            previewButton.hidden = !fileUrl(preview_url);
            downloadButton.hidden = !fileUrl(download_url);
            actions.hidden = previewButton.hidden && downloadButton.hidden;
            details.hidden = false;
            status.textContent = "";
        } catch (error) {
            showError(error);
        }
    }

    previewButton.addEventListener("click", () => showFile("preview"));
    downloadButton.addEventListener("click", () => showFile("download"));
    void loadDocument();
})();
