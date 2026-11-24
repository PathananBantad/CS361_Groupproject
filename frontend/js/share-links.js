(() => {
    "use strict";

    // Keep the provisional Share Link API paths and response handling here.
    function managePath(documentId) {
        return `${window.resolveApiBaseUrl()}/documents/${encodeURIComponent(documentId)}/share-links`;
    }

    function publicRequest(token) {
        return fetch(`${window.resolveApiBaseUrl()}/shared/${encodeURIComponent(token)}`, {
            credentials: "omit",
            cache: "no-store",
            referrerPolicy: "no-referrer"
        });
    }

    async function readResponse(response) {
        const data = await response.json().catch(() => null);
        if (response.ok) return data;
        const error = new Error("ไม่สามารถดำเนินการเกี่ยวกับลิงก์แชร์ได้");
        error.status = response.status;
        throw error;
    }

    function message(error) {
        if (error.status === 410) return "ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว กรุณาขอลิงก์ใหม่จากผู้ส่ง";
        if (error.status === 404) return "ไม่พบลิงก์นี้ กรุณาตรวจสอบลิงก์หรือขอลิงก์ใหม่จากผู้ส่ง";
        if (error.status === 429) return "เปิดลิงก์ถี่เกินไป กรุณารอสักครู่แล้วลองใหม่";
        if (error.status === 401) return "กรุณาเข้าสู่ระบบอีกครั้ง";
        if (error.status === 403) return "คุณไม่มีสิทธิ์ดำเนินการนี้";
        return "ไม่สามารถดำเนินการเกี่ยวกับลิงก์แชร์ได้ กรุณาลองอีกครั้ง";
    }

    function button(label, handler) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "btn-workflow-primary";
        element.textContent = label;
        element.addEventListener("click", handler);
        return element;
    }

    function mount(host, doc) {
        if (!host) return;
        host.replaceChildren();
        // The document detail API grants this permission for the current viewer.
        if (doc.permissions?.share !== true) return;

        const section = document.createElement("section");
        section.className = "modal-workflow-card";
        const heading = document.createElement("h3");
        heading.textContent = "ลิงก์แชร์เอกสาร";
        const status = document.createElement("p");
        status.setAttribute("role", "status");
        const list = document.createElement("ul");
        const links = new Map();
        const path = managePath(doc.id);
        let busy = false;

        function render() {
            list.replaceChildren();
            for (const link of links.values()) {
                const item = document.createElement("li");
                const expiry = new Date(link.expires_at);
                item.textContent = Number.isFinite(expiry.getTime())
                    ? `หมดอายุ ${expiry.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} `
                    : "ลิงก์แชร์ ";
                if (link.token) {
                    const url = new URL("shared.html", window.location.href);
                    url.searchParams.set("token", link.token);
                    const input = document.createElement("input");
                    input.type = "url";
                    input.readOnly = true;
                    input.setAttribute("aria-label", "ลิงก์แชร์เอกสาร");
                    input.value = url.href;
                    item.append(input, button("คัดลอกลิงก์", () => run(async () => {
                        try {
                            await navigator.clipboard.writeText(input.value);
                            status.textContent = "คัดลอกลิงก์แล้ว";
                        } catch {
                            input.select();
                            status.textContent = "เลือกข้อความลิงก์แล้ว กรุณาคัดลอกด้วยแป้นพิมพ์";
                        }
                    })));
                }
                item.append(button("ยกเลิกลิงก์", () => run(async () => {
                    if (!window.confirm("ยกเลิกลิงก์แชร์นี้หรือไม่?")) return;
                    await readResponse(await window.apiFetch(`${window.resolveApiBaseUrl()}/share-links/${encodeURIComponent(link.id)}`, { method: "DELETE" }));
                    links.delete(String(link.id));
                    render();
                    status.textContent = "ยกเลิกลิงก์แล้ว";
                })));
                list.append(item);
            }
        }

        async function run(operation) {
            if (busy || !section.isConnected) return;
            busy = true;
            section.querySelectorAll("button").forEach(control => { control.disabled = true; });
            status.textContent = "";
            let denied = false;
            try {
                await operation();
            } catch (error) {
                denied = error.status === 401 || error.status === 403;
                if (denied) list.replaceChildren();
                status.textContent = message(error);
            } finally {
                busy = false;
                section.querySelectorAll("button").forEach(control => { control.disabled = denied; });
            }
        }

        const create = button("สร้างลิงก์", () => run(async () => {
            const link = await readResponse(await window.apiFetch(path, { method: "POST" }));
            if (link?.id == null || !link.token) throw new Error("Invalid share link");
            links.set(String(link.id), link);
            render();
            status.textContent = "สร้างลิงก์แล้ว";
        }));

        section.append(heading, create, status, list);
        host.append(section);
        void run(async () => {
            const data = await readResponse(await window.apiFetch(path, { cache: "no-store" }));
            if (!Array.isArray(data)) throw new Error("Invalid share link list");
            for (const link of data) {
                if (link?.id != null && !link.revoked_at) links.set(String(link.id), { id: link.id, expires_at: link.expires_at });
            }
            render();
        });
    }

    window.DocuFlowShareLinks = { mount, publicRequest, readResponse, message };
})();
