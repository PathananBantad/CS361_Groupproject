const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontend = resolve(__dirname, "../../frontend/js");
const scripts = ["share-links.js", "shared.js"].map(file =>
    new vm.Script(readFileSync(resolve(frontend, file), "utf8"), { filename: file })
);

function element() {
    return {
        children: [],
        hidden: true,
        isConnected: true,
        append(...children) { this.children.push(...children); },
        replaceChildren() { this.children = []; },
        addEventListener(event, handler) { this[event] = handler; },
        setAttribute() {},
        removeAttribute(name) { delete this[name]; },
        querySelectorAll() { return []; }
    };
}

function loadFrontend({ search = "", fetch, apiFetch } = {}) {
    const elements = new Map();
    const copied = [];
    const window = {
        location: { search, href: "https://docuflow.test/html/dashboard.html" },
        resolveApiBaseUrl: () => "https://api.docuflow.test/api",
        confirm: () => true,
        apiFetch
    };
    const context = vm.createContext({
        window, fetch, URL, URLSearchParams,
        navigator: { clipboard: { writeText: async value => copied.push(value) } },
        document: {
            createElement: element,
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, element());
                return elements.get(id);
            }
        }
    });
    scripts[0].runInContext(context);
    return { context, window, elements, copied };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const publicDocument = {
    document: { subject: "เอกสารทดลอง" },
    preview_url: "https://files.docuflow.test/preview.pdf",
    download_url: "https://files.docuflow.test/download.pdf"
};

test("Share Link opens read-only, previews and downloads with a fresh token check", async () => {
    const requests = [];
    const { context, elements } = loadFrontend({
        search: "?token=demo",
        fetch: async (url, options) => {
            requests.push(url);
            assert.equal(options.credentials, "omit");
            return Response.json(publicDocument);
        }
    });
    scripts[1].runInContext(context);
    await settle();
    assert.equal(elements.get("sharedSubject").textContent, "เอกสารทดลอง");
    assert.equal(elements.get("sharedDocument").hidden, false);
    await elements.get("sharedPreview").click();
    assert.equal(elements.get("sharedFilePreview").src, publicDocument.preview_url);
    let downloaded;
    context.document.createElement = () => ({ click() { downloaded = this.href; } });
    await elements.get("sharedDownload").click();
    assert.equal(downloaded, publicDocument.download_url);
    assert.deepEqual(requests, Array(3).fill("https://api.docuflow.test/api/shared/demo"));
});

test("Expired or revoked links hide details and clear an already-loaded preview", async () => {
    let unavailable = false;
    const { context, elements } = loadFrontend({
        search: "?token=demo",
        fetch: async () => unavailable ? Response.json({ code: "SHARE_LINK_UNAVAILABLE" }, { status: 404 }) : Response.json(publicDocument)
    });
    scripts[1].runInContext(context);
    await settle();
    await elements.get("sharedPreview").click();
    unavailable = true;
    await elements.get("sharedDownload").click();
    assert.equal(elements.get("sharedDocument").hidden, true);
    assert.equal(elements.get("sharedFilePreview").src, undefined);
    assert.equal(elements.get("sharedStatus").textContent, "ลิงก์นี้ใช้งานไม่ได้ กรุณาขอลิงก์ใหม่จากผู้ส่ง");
});

test("Only permitted viewers can create, copy and revoke links in the modal", async () => {
    const requests = [];
    const { window, copied } = loadFrontend({
        apiFetch: async (path, options) => {
            const method = options.method || "GET";
            requests.push([method, new URL(path).pathname]);
            if (method === "POST") return Response.json({ id: 7, token: "demo" }, { status: 201 });
            if (method === "DELETE") return Response.json({ id: 7, status: "revoked" });
            return Response.json([]);
        }
    });
    const host = element();
    window.DocuFlowShareLinks.mount(host, { id: 42, permissions: { share: false } });
    assert.deepEqual(host.children, []);
    assert.deepEqual(requests, []);

    window.DocuFlowShareLinks.mount(host, { id: 42, permissions: { share: true } });
    await settle();
    const [, create, , list] = host.children[0].children;
    await create.click();
    const [, copy, revoke] = list.children[0].children;
    await copy.click();
    assert.deepEqual(copied, ["https://docuflow.test/html/shared.html?token=demo"]);
    await revoke.click();
    assert.deepEqual(list.children, []);
    assert.deepEqual(requests, [
        ["GET", "/api/documents/42/share-links"],
        ["POST", "/api/documents/42/share-links"],
        ["DELETE", "/api/share-links/7"]
    ]);
});
