// ส่วน "มอบหมายเอกสาร" ในหน้าต่างรายละเอียดเอกสาร
(function () {
    "use strict";

    // มี 2 บทบาทที่มีสิทธิ์มอบหมายเอกสาร: เจ้าหน้าที่รับเอกสาร และ ผู้ดูแลระบบ
    const ASSIGNER_ROLES = ["document_officer", "admin"];

    function apiBase() {
        const base = window.API_BASE_URL || "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com";
        if (window.location.port === "3000") {
            return "/api";
        }
        return base.endsWith("/api") ? base : `${base}/api`;
    }


    // รวมการอ่าน token ไว้ที่เดียว (backend ตรวจ access token)
    function getAuthToken() {
        try {
            const directToken = localStorage.getItem("docuflow_access_token") ||
                localStorage.getItem("access_token") ||
                localStorage.getItem("docuflow_id_token") ||
                localStorage.getItem("id_token");
            if (directToken) return directToken;

            const prefix = "CognitoIdentityServiceProvider.";
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix) && key.endsWith(".LastAuthUser")) {
                    const clientId = key.split(".")[1];
                    const user = localStorage.getItem(key);
                    const token = localStorage.getItem(prefix + clientId + "." + user + ".accessToken");
                    if (token) return token;
                }
            }
            return "";
        } catch (e) {
            return "";
        }
    }

    async function api(path, options) {
        const res = await window.apiFetch(apiBase() + path, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options && options.headers ? options.headers : {}),
            },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "เกิดข้อผิดพลาด (" + res.status + ")");
        return data;
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

    async function mount(doc, opts) {
        const section = ensureSection();
        if (!section || !doc) return;
        const onDone = (opts && opts.onDone) || function () {};
        const role = (localStorage.getItem("docuflow_role") || "").toLowerCase().trim();
        const canAssign = ASSIGNER_ROLES.includes(role);

        section.innerHTML =
            '<div class="details-section-title"><span aria-hidden="true">👤</span> ผู้รับผิดชอบเอกสาร</div>' +
            '<div class="meta-item"><span class="meta-label">ผู้รับผิดชอบปัจจุบัน</span>' +
            '<span class="meta-value" id="assignCurrent">' +
            (doc.assignee_id
                ? esc(doc.assignee_full_name || doc.assignee_username || ("ผู้ใช้ #" + doc.assignee_id))
                : "ยังไม่มีการมอบหมาย") +
            "</span></div>" +
            (canAssign
                ? '<div id="assignForm" style="margin-top:12px;display:grid;gap:8px">' +
                  '<select id="assignSelect" disabled><option>กำลังโหลดรายชื่อ...</option></select>' +
                  '<input type="text" id="assignRemarks" maxlength="500" placeholder="หมายเหตุ (ไม่บังคับ)">' +
                  '<button type="button" id="assignBtn" class="btn-workflow-primary" disabled>มอบหมาย</button>' +
                  '<div id="assignMsg" role="status"></div></div>'
                : "");

        if (!canAssign) return;

        const select = section.querySelector("#assignSelect");
        const btn = section.querySelector("#assignBtn");
        const msg = section.querySelector("#assignMsg");
        const remarks = section.querySelector("#assignRemarks");
        const show = (text, ok) => {
            msg.textContent = text;
            msg.style.color = ok ? "#15803d" : "#b91c1c";
        };

        try {
            const list = await api("/assignees");
            const users = list.data || list.assignees || [];
            select.innerHTML =
                '<option value="">-- เลือกผู้รับผิดชอบ --</option>' +
                users
                    .map((u) => '<option value="' + esc(u.id) + '">' + esc(u.full_name || u.username) + " (" + esc(u.role) + ")</option>")
                    .join("");
            select.disabled = false;
            btn.disabled = false;
        } catch (err) {
            select.innerHTML = "<option>โหลดรายชื่อไม่สำเร็จ</option>";
            show(err.message, false);
            return;
        }

        btn.addEventListener("click", async () => {
            if (btn.disabled) return;
            if (!select.value) return show("กรุณาเลือกผู้รับผิดชอบ", false);
            btn.disabled = true; // กันกดซ้ำ
            btn.textContent = "กำลังบันทึก...";
            try {
                const result = await api("/documents/" + encodeURIComponent(doc.id) + "/assign", {
                    method: "POST",
                    body: JSON.stringify({ assignee_id: Number(select.value), remarks: remarks.value.trim() }),
                });
                show(result.message || "มอบหมายสำเร็จ", true);
                const selected = select.options[select.selectedIndex];
                section.querySelector("#assignCurrent").textContent = selected.textContent.replace(/\s*\([^)]*\)$/, "");
                onDone(result);
            } catch (err) {
                show(err.message, false);
            } finally {
                btn.disabled = false;
                btn.textContent = "มอบหมาย";
            }
        });
    }
    window.DocuFlowAssignment = { mount };
})();

