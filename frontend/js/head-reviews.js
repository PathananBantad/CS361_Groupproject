(() => {
    "use strict";

    const byId = id => document.getElementById(id);
    const page = byId("headReviewPage");
    const dialog = byId("headReviewDialog");
    const list = byId("headReviewList");
    const recipient = byId("headRecipient");
    const directForm = byId("headDirectForm");
    const returnForm = byId("headReturnForm");
    const filters = page.querySelectorAll("[data-review-filter]");
    const demo = window.IS_LOCAL && new URLSearchParams(location.search).get("mock") === "1";
    const mockRecipients = [{ id: 11, full_name: "อาจารย์ตัวอย่าง ก" }, { id: 12, full_name: "อาจารย์ตัวอย่าง ข" }];
    const mockDocuments = [
        { id: 1, reference_no: "DEMO-001", subject: "ขออนุมัติโครงการอบรม", description: "คำขอพิจารณาโครงการอบรมสำหรับนักศึกษา", review_state: "PENDING" },
        { id: 2, reference_no: "DEMO-002", subject: "เอกสารประกอบการประชุม", description: "เอกสารประกอบการประชุมประจำเดือน", review_state: "PENDING" },
        { id: 3, reference_no: "DEMO-003", subject: "แจ้งผลการดำเนินงาน", review_state: "DIRECTED", head_review: { decision: "DIRECTED", note: "แจ้งผู้รับผิดชอบเพื่อดำเนินการต่อ" } }
    ];
    const role = localStorage.getItem("docuflow_role");
    const canSubmit = demo || role === "branch_head";
    const reviewedStates = ["RETURNED", "DIRECTED", "DONE"];
    let filter = "pending";
    let loadRequest = 0;
    let activeDocument;
    let submitting = false;

    async function request(path, options) {
        const response = await window.apiFetch(`${window.resolveApiBaseUrl()}${path}`, options);
        if (response.status === 401) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง");
        if (response.status === 403) throw new Error("บัญชีนี้ไม่มีสิทธิ์ดำเนินการ");
        if (response.status === 400) throw new Error("ข้อมูลพิจารณาไม่ถูกต้อง กรุณาตรวจผู้รับหรือเหตุผลแล้วลองอีกครั้ง");
        if (response.status === 404 || response.status === 409) {
            const error = new Error(response.status === 404
                ? "ไม่พบเอกสารนี้แล้ว กรุณากลับไปตรวจรายการ"
                : "สถานะเอกสารเปลี่ยนแล้ว กรุณากลับไปตรวจรายการ");
            error.status = response.status;
            throw error;
        }
        if (!response.ok) throw new Error("ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง");
        return response.status === 204 ? null : response.json();
    }

    function openDocument(doc, recipients) {
        activeDocument = doc;
        byId("headReviewSubject").textContent = doc.subject || "รายละเอียดเอกสาร";
        byId("headReviewDetails").textContent = [doc.reference_no, doc.document_type, doc.sender_name, doc.description,
            doc.receive_date && `วันที่รับ ${doc.receive_date}`, doc.deadline && `ครบกำหนด ${doc.deadline}`].filter(Boolean).join("\n");
        const review = doc.head_review;
        let decisionDetails = [];
        if (review?.decision === "RETURNED") {
            decisionDetails = ["ส่งกลับเพื่อขอข้อมูลเพิ่ม", review.reason];
        } else if (review?.decision === "DIRECTED") {
            decisionDetails = [
                doc.review_state === "DONE" ? "สารบรรณแจกจ่ายแล้ว" : "ส่งให้สารบรรณแจกจ่ายแล้ว",
                review.assignee_name && `ผู้รับ ${review.assignee_name}`,
                review.note
            ];
        }
        byId("headReviewDecision").textContent = decisionDetails.filter(Boolean).join("\n");
        byId("headActionStatus").textContent = "";
        directForm.reset();
        returnForm.reset();
        recipient.replaceChildren(new Option("เลือกผู้รับหนึ่งคน", ""));
        for (const person of recipients) {
            if (person.id != null) recipient.add(new Option(person.full_name || person.username || String(person.id), person.id));
        }
        const canReview = canSubmit && doc.review_state === "PENDING";
        byId("headRecipientStatus").textContent = canReview && !recipients.length ? "ยังไม่มีรายชื่อผู้รับจากระบบ" : "";
        directForm.querySelector('button[type="submit"]').disabled = !recipients.length;
        directForm.hidden = !canReview;
        returnForm.hidden = !canReview;
        dialog.showModal();
    }

    async function load() {
        const requestId = ++loadRequest;
        const status = byId("headListStatus");
        status.textContent = "กำลังโหลดเอกสาร…";
        list.replaceChildren();
        try {
            const states = filter === "pending" ? ["PENDING"] : reviewedStates;
            const [queues, counts] = demo
                ? [states.map(state => ({
                    data: mockDocuments.filter(doc => doc.review_state === state),
                    recipients: mockRecipients
                })), { head_pending: mockDocuments.filter(doc => doc.review_state === "PENDING").length }]
                : await Promise.all([
                    Promise.all(states.map(state => request(`/head/reviews?state=${state}`))),
                    request("/me/pending-counts").catch(() => null)
                ]);
            if (requestId !== loadRequest) return;
            if (queues.some(queue => !Array.isArray(queue?.data))) throw new Error("ไม่สามารถอ่านรายการเอกสารได้");
            const count = counts?.head_pending;
            byId("headPendingCount").textContent = Number.isInteger(count) && count >= 0 ? `รอพิจารณา ${count}` : "";
            // #79 does not yet specify a recipient directory for this role.
            const recipients = Array.isArray(queues[0].recipients) ? queues[0].recipients : [];
            const documents = Array.from(new Map(queues.flatMap(queue => queue.data).map(doc => [doc.id, doc])).values());
            for (const doc of documents) {
                const item = document.createElement("li");
                const title = document.createElement("h2");
                title.textContent = doc.subject || "เอกสาร";
                const reference = document.createElement("p");
                reference.textContent = doc.reference_no || "";
                const open = document.createElement("button");
                open.type = "button";
                open.textContent = "ดูรายละเอียด";
                open.addEventListener("click", () => openDocument(doc, recipients));
                item.append(title, reference, open);
                list.append(item);
            }
            status.textContent = documents.length ? "" : "ไม่มีเอกสารในรายการนี้";
        } catch (error) {
            if (requestId === loadRequest) status.textContent = error.message;
        }
    }

    async function submitReview(decision) {
        if (submitting || !canSubmit || activeDocument?.review_state !== "PENDING") return;
        const status = byId("headActionStatus");
        const reason = byId("headReason").value.trim();
        const assigneeId = Number(recipient.value);
        if (decision === "RETURNED" && !reason) {
            status.textContent = "กรุณาระบุเหตุผลที่ส่งกลับ";
            byId("headReason").focus();
            return;
        }
        if (decision === "DIRECTED" && (!Number.isSafeInteger(assigneeId) || assigneeId <= 0 ||
            !Array.from(recipient.options).some(option => option.value === recipient.value))) {
            status.textContent = "กรุณาเลือกผู้รับหนึ่งคน";
            recipient.focus();
            return;
        }

        const payload = decision === "RETURNED" ? { decision, reason } : {
            decision, assignee_id: assigneeId, note: byId("headNote").value.trim()
        };
        const controls = dialog.querySelectorAll("button, select, textarea");
        const enabledControls = Array.from(controls).filter(control => !control.disabled);
        submitting = true;
        enabledControls.forEach(control => { control.disabled = true; });
        status.textContent = "กำลังส่ง…";
        try {
            if (demo) {
                activeDocument.head_review = {
                    ...payload,
                    assignee_name: decision === "DIRECTED" ? recipient.selectedOptions[0].text : null
                };
                activeDocument.review_state = decision;
            } else await request(`/documents/${encodeURIComponent(activeDocument.id)}/head-review`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            dialog.close();
            await load();
            byId("headReviewResult").textContent = decision === "DIRECTED"
                ? "ส่งให้สารบรรณแจกจ่ายแล้ว"
                : "ส่งกลับเพื่อขอข้อมูลเพิ่มแล้ว";
        } catch (error) {
            status.textContent = error.message;
            if ([404, 409].includes(error.status)) {
                activeDocument = null;
                directForm.hidden = true;
                returnForm.hidden = true;
                await load();
            }
        } finally {
            submitting = false;
            enabledControls.forEach(control => { control.disabled = false; });
        }
    }

    if (!demo && (!window.getDocuFlowAuthToken() || !["branch_head", "admin"].includes(role))) {
        location.replace(window.getDocuFlowAuthToken() ? "dashboard.html" : "login.html");
        return;
    }

    byId("headDemo").hidden = !demo;
    if (demo) byId("roleMenuBtn").disabled = true;
    page.hidden = false;
    filters.forEach(button => button.addEventListener("click", () => {
        byId("headReviewResult").textContent = "";
        filter = button.dataset.reviewFilter;
        filters.forEach(option => option.setAttribute("aria-pressed", String(option === button)));
        void load();
    }));
    directForm.addEventListener("submit", event => { event.preventDefault(); void submitReview("DIRECTED"); });
    returnForm.addEventListener("submit", event => { event.preventDefault(); void submitReview("RETURNED"); });
    byId("headClose").addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", event => { if (submitting) event.preventDefault(); });
    void load();
})();
