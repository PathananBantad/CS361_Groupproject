// ส่วน "ผู้รับผิดชอบเอกสาร" ในหน้าต่างรายละเอียดเอกสาร
(function () {
    "use strict";

    function apiBase() {
        if (typeof window.resolveApiBaseUrl === "function") {
            return window.resolveApiBaseUrl();
        }
        const base = window.API_BASE_URL || "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";
        return base.endsWith("/api") ? base : `${base}/api`;
    }

    function esc(s) {
        const d = document.createElement("div");
        d.textContent = s == null ? "" : String(s);
        return d.innerHTML;
    }

    // สร้างกล่อง section ถ้ายังไม่มี (วางก่อนการ์ดประวัติ)
    function ensureSection() {
        let el = document.getElementById("assignSection");
        if (el) return el;
        const anchor = document.querySelector("#documentModal .modal-history-card");
        if (!anchor) return null;
        el = document.createElement("section");
        el.id = "assignSection";
        el.className = "modal-details-card";
        anchor.parentNode.insertBefore(el, anchor);
        return el;
    }

    function cleanPersonName(name) {
        if (!name) return "-";
        const str = String(name).trim();
        if (!str.includes("@")) return str;
        const usernamePart = str.split("@")[0];
        const segments = usernamePart.split(/[._-]/).filter(Boolean);
        if (segments.length > 0) {
            return segments.map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(" ");
        }
        return usernamePart;
    }

    function getResponsiblePersonInfo(doc) {
        if (!doc) return { name: "-", isCreator: false };

        // 1. ตรวจสอบว่ามีผู้รับมอบหมาย (Assignee) หรือไม่
        const rawAssigneeId = doc.assignee_id != null ? String(doc.assignee_id).trim() : "";
        const hasAssignee = rawAssigneeId && rawAssigneeId !== "null" && rawAssigneeId !== "undefined" && rawAssigneeId !== "0";

        if (hasAssignee) {
            const assigneeName = doc.assignee_full_name ||
                (doc.raw && doc.raw.assignee_full_name) ||
                doc.assignee_username ||
                (doc.raw && doc.raw.assignee_username);

            if (assigneeName) {
                return { name: cleanPersonName(assigneeName), isCreator: false, userId: rawAssigneeId, rawName: assigneeName };
            }
            // มี ID แต่ยังไม่ทราบชื่อ
            return { name: "ผู้ใช้ #" + rawAssigneeId, isCreator: false, userId: rawAssigneeId };
        }

        // 2. ถ้ายังไม่ถูกมอบหมาย ให้เป็นชื่อคนที่เพิ่มเอกสาร (Creator / Owner)
        const creatorName = doc.owner_full_name ||
            (doc.raw && doc.raw.owner_full_name) ||
            doc.owner_username ||
            doc.creator_username ||
            doc.created_by_name ||
            doc.created_by ||
            (doc.raw && (doc.raw.owner_username || doc.raw.creator_username));

        if (creatorName) {
            return { name: cleanPersonName(creatorName), isCreator: true, userId: doc.owner_id || (doc.raw && doc.raw.owner_id), rawName: creatorName };
        }

        const rawOwnerId = doc.owner_id != null ? String(doc.owner_id).trim() : "";
        if (rawOwnerId && rawOwnerId !== "null" && rawOwnerId !== "undefined" && rawOwnerId !== "0") {
            return { name: "ผู้ใช้ #" + rawOwnerId, isCreator: true, userId: rawOwnerId };
        }

        return { name: "ยังไม่มีการมอบหมาย", isCreator: false };
    }

    async function mount(doc, opts) {
        const section = ensureSection();
        if (!section || !doc) return;

        const info = getResponsiblePersonInfo(doc);

        section.innerHTML =
            '<div class="details-section-title"><span aria-hidden="true">👤</span> ผู้รับผิดชอบเอกสาร</div>' +
            '<div class="meta-item"><span class="meta-label">ผู้รับผิดชอบปัจจุบัน</span>' +
            '<span class="meta-value" id="assignCurrent">' +
            esc(info.name) +
            (info.isCreator ? ' <small style="font-size:12px;font-weight:normal;color:#6b7280;">(ผู้เพิ่มเอกสาร)</small>' : '') +
            '</span></div>';

        if (doc.permissions?.assign !== true) return;

        const label = doc.assignee_id == null ? "มอบหมายเอกสาร" : "มอบหมายใหม่";
        section.insertAdjacentHTML("beforeend", `
            <form>
                <label>ผู้รับมอบหมาย <select name="assignee" required disabled>
                    <option value="">กำลังโหลดรายชื่อผู้รับมอบหมาย</option>
                </select></label>
                <label>หมายเหตุ <input name="remarks" type="text"></label>
                <button type="submit" disabled>${label}</button>
            </form>
            <p data-assignment-message role="status" aria-live="polite"></p>
        `);

        const form = section.querySelector("form");
        const select = form.elements.assignee;
        const submit = form.querySelector("button");
        const message = section.querySelector("[data-assignment-message]");
        const documentUrl = `${apiBase()}/documents/${encodeURIComponent(doc.id)}`;
        const allowedRoles = ["faculty_staff", "responsible_person"];

        try {
            const res = await window.apiFetch(`${apiBase()}/assignees?document_id=${encodeURIComponent(doc.id)}`);
            const result = await res.json().catch(() => ({}));
            if (!form.isConnected) return;
            if (res.status === 401 || res.status === 403) opts.onDenied();
            if (!res.ok) throw new Error(result.error || "โหลดรายชื่อผู้รับมอบหมายไม่สำเร็จ");

            const recipients = new Map();
            for (const user of result.data || []) {
                if (allowedRoles.includes(user.role) && String(user.id) !== String(doc.assignee_id)) {
                    recipients.set(String(user.id), user.full_name || user.username);
                }
            }
            select.replaceChildren(new Option(recipients.size ? "เลือกผู้รับมอบหมาย" : "ไม่มีผู้รับมอบหมายที่เลือกได้", ""));
            for (const [id, name] of recipients) select.add(new Option(name, id));
            select.disabled = !recipients.size;
            select.addEventListener("change", () => { submit.disabled = !recipients.has(select.value); });

            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (submit.disabled || !recipients.has(select.value)) return;
                const assigneeId = select.value;
                submit.disabled = true;
                select.disabled = true;
                message.textContent = "กำลังบันทึกการมอบหมาย…";
                try {
                    const response = await window.apiFetch(`${documentUrl}/assign`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            assignee_id: assigneeId,
                            expected_assignee_id: doc.assignee_id ?? null,
                            remarks: form.elements.remarks.value
                        })
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        if ((response.status === 401 || response.status === 403) && form.isConnected) opts.onDenied();
                        throw new Error(data.error || "บันทึกการมอบหมายไม่สำเร็จ");
                    }
                    message.textContent = "บันทึกการมอบหมายสำเร็จ";
                    await opts.onDone();
                } catch (error) {
                    message.textContent = error.message;
                    select.disabled = false;
                    submit.disabled = false;
                }
            });
        } catch (error) {
            message.textContent = error.message;
        }
    }

    window.DocuFlowAssignment = { mount };
})();
