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

    // แคชรายชื่อผู้ใช้เพื่อลดการเรียก API ซ้ำ
    let usersCache = null;

    async function fetchUsersList() {
        if (usersCache) return usersCache;
        try {
            let res = await window.apiFetch(apiBase() + "/forward-recipients");
            if (!res.ok) {
                res = await window.apiFetch(apiBase() + "/assignees");
            }
            if (res.ok) {
                const data = await res.json();
                usersCache = data.data || data.assignees || [];
                return usersCache;
            }
        } catch (e) {
            console.warn("Could not fetch users list:", e);
        }
        return [];
    }

    async function resolveUserName(userId) {
        if (!userId) return null;
        const users = await fetchUsersList();
        const found = users.find((u) => String(u.id) === String(userId));
        if (found) {
            return found.full_name || found.username;
        }
        return null;
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

        // กรณีที่ชื่อยังเป็น "ผู้ใช้ #..." หรือมีข้อมูล userId ให้ลองดึงชื่อจริงภาษาไทยจากระบบมาอัปเดตอัตโนมัติ
        if (info.userId) {
            const assignCurrentEl = section.querySelector("#assignCurrent");
            resolveUserName(info.userId).then((resolved) => {
                if (resolved && assignCurrentEl && !resolved.includes("@")) {
                    assignCurrentEl.innerHTML = esc(resolved) +
                        (info.isCreator ? ' <small style="font-size:12px;font-weight:normal;color:#6b7280;">(ผู้เพิ่มเอกสาร)</small>' : '');
                }
            }).catch(() => {});
        }
    }

    window.DocuFlowAssignment = { mount };
})();
