const tableBody = document.getElementById("documentTableBody");
const mobileList = document.getElementById("mobileList");
const globalSearch = document.getElementById("globalSearch");
const shownCount = document.getElementById("shownCount");

let documents = [];
let currentFilters = new Set(["all"]);
let sortKey = null;
let sortDirection = 1;


/* =========================
   FETCH DOCUMENTS
========================= */

async function fetchDocuments() {
    const keyword = globalSearch
        ? globalSearch.value.trim()
        : "";

    const params = new URLSearchParams();

    if (keyword) {
        params.append("search", keyword);
    }

    // Status filters
    if (!currentFilters.has("all")) {
        currentFilters.forEach(filter => {
            let statusParam = "";

            if (filter === "waiting") {
                statusParam = "Received";
            } 
            else if (filter === "processing") {
                statusParam = "Processing";
            } 
            else if (filter === "approval") {
                statusParam = "Assigned";
            } 
            else if (filter === "completed") {
                statusParam = "Completed";
            } 
            else if (filter === "archived") {
                statusParam = "Archived";
            }

            if (statusParam) {
                params.append("status", statusParam);
            }
        });
    }

    try {
        const url =
            `https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents?${params.toString()}`;


        if (!response.ok) {
            throw new Error("ไม่สามารถโหลดข้อมูลเอกสารได้");
        }

        const data = await response.json();

        const rows = Array.isArray(data)
            ? data
            : (data.documents || data.data || []);

        documents = rows.map(row => {
            const status = row.status || "";

            let statusKey = "waiting";
            let color = "default";

            if (
                status === "Processing" ||
                status === "กำลังดำเนินการ"
            ) {
                statusKey = "processing";
                color = "blue";
            }
            else if (
                status === "Assigned" ||
                status === "รอการอนุมัติ"
            ) {
                statusKey = "approval";
                color = "orange";
            }
            else if (
                status === "Completed" ||
                status === "เสร็จสิ้น"
            ) {
                statusKey = "completed";
                color = "green";
            }
            else if (
                status === "Archived" ||
                status === "จัดเก็บแล้ว"
            ) {
                statusKey = "archived";
                color = "gray";
            }

            const dateValue =
                row.received_at ||
                row.created_at ||
                row.updated_at;

            let receivedDate = "-";
            let receivedTime = "-";

            if (dateValue) {
                const date = new Date(dateValue);

                if (!isNaN(date.getTime())) {
                    receivedDate = date.toLocaleDateString("th-TH");
                    receivedTime = date.toLocaleTimeString(
                        "th-TH",
                        {
                            hour: "2-digit",
                            minute: "2-digit"
                        }
                    );
                }
            }

            return {
                id: String(row.id),
                number: row.document_number || "-",
                code: row.reference_no || "-",
                type: row.document_type || "-",
                description:
                    row.subject ||
                    row.remarks ||
                    "-",
                sender: row.sender_name || "-",
                receiver: row.receiver_name || "-",
                statusKey: statusKey,
                statusLabel: row.status || "-",
                receivedDate: receivedDate,
                receivedTime: receivedTime,
                color: color,
                file_key: row.file_key || null,
                path: null
            };
        });

        render();

    } catch (error) {
        console.error("Fetch documents error:", error);

        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        ไม่สามารถโหลดข้อมูลเอกสารได้
                    </td>
                </tr>
            `;
        }

        if (mobileList) {
            mobileList.innerHTML = `
                <div class="empty-state">
                    ไม่สามารถโหลดข้อมูลเอกสารได้
                </div>
            `;
        }
    }
}


/* =========================
   RENDER
========================= */

function render() {
    let result = [...documents];

    // Search
    const keyword = globalSearch
        ? globalSearch.value.trim().toLowerCase()
        : "";

    if (keyword) {
        result = result.filter(doc => {
            return (
                doc.number.toLowerCase().includes(keyword) ||
                doc.code.toLowerCase().includes(keyword) ||
                doc.type.toLowerCase().includes(keyword) ||
                doc.description.toLowerCase().includes(keyword) ||
                doc.sender.toLowerCase().includes(keyword) ||
                doc.receiver.toLowerCase().includes(keyword)
            );
        });
    }

    // Local status filter
    if (!currentFilters.has("all")) {
        result = result.filter(doc =>
            currentFilters.has(doc.statusKey)
        );
    }

    // Sort
    if (sortKey) {
        result.sort((a, b) => {
            const valueA = String(a[sortKey] || "").toLowerCase();
            const valueB = String(b[sortKey] || "").toLowerCase();

            return valueA.localeCompare(valueB) * sortDirection;
        });
    }

    renderTable(result);
    renderMobile(result);

    if (shownCount) {
        shownCount.textContent = result.length;
    }
}


/* =========================
   TABLE
========================= */

function renderTable(list) {
    if (!tableBody) return;

    if (!list.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    ไม่พบข้อมูลเอกสาร
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = list.map(doc => `
        <tr data-id="${doc.id}">

            <td>
                <div class="document-number">
                    ${escapeHtml(doc.number)}
                </div>
            </td>

            <td>
                ${escapeHtml(doc.code)}
            </td>

            <td>
                ${escapeHtml(doc.type)}
            </td>

            <td>
                ${escapeHtml(doc.description)}
            </td>

            <td>
                ${escapeHtml(doc.sender)}
            </td>

            <td>
                <span class="status-badge ${doc.color}">
                    ${escapeHtml(doc.statusLabel)}
                </span>
            </td>

            <td>
                <div class="file-actions">

                    <button
                        class="file-button"
                        data-open="${doc.id}"
                        type="button"
                    >
                        ▤ เปิดไฟล์
                    </button>

                    <button
                        class="file-button download-button"
                        data-download="${doc.id}"
                        type="button"
                    >
                        ↓ ดาวน์โหลด
                    </button>

                </div>
            </td>

        </tr>
    `).join("");

    // Open file
    tableBody
        .querySelectorAll("[data-open]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                openDocument(
                    button.dataset.open
                );
            });
        });

    // Download file
    tableBody
        .querySelectorAll("[data-download]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                downloadDocumentFile(
                    button.dataset.download
                );
            });
        });
}


/* =========================
   MOBILE
========================= */

function renderMobile(list) {
    if (!mobileList) return;

    if (!list.length) {
        mobileList.innerHTML = `
            <div class="empty-state">
                ไม่พบข้อมูลเอกสาร
            </div>
        `;
        return;
    }

    mobileList.innerHTML = list.map(doc => `
        <div class="mobile-document-card">

            <div class="mobile-document-header">
                <strong>
                    ${escapeHtml(doc.number)}
                </strong>

                <span class="status-badge ${doc.color}">
                    ${escapeHtml(doc.statusLabel)}
                </span>
            </div>

            <div class="mobile-document-info">

                <div>
                    <small>เลขอ้างอิง</small>
                    <span>
                        ${escapeHtml(doc.code)}
                    </span>
                </div>

                <div>
                    <small>ประเภทเอกสาร</small>
                    <span>
                        ${escapeHtml(doc.type)}
                    </span>
                </div>

                <div>
                    <small>เรื่อง</small>
                    <span>
                        ${escapeHtml(doc.description)}
                    </span>
                </div>

                <div>
                    <small>ผู้ส่ง</small>
                    <span>
                        ${escapeHtml(doc.sender)}
                    </span>
                </div>

            </div>

            <div class="file-actions">

                <button
                    class="file-button"
                    data-open="${doc.id}"
                    type="button"
                >
                    ▤ เปิดไฟล์
                </button>

                <button
                    class="file-button download-button"
                    data-download="${doc.id}"
                    type="button"
                >
                    ↓ ดาวน์โหลด
                </button>

            </div>

        </div>
    `).join("");

    // Open file
    mobileList
        .querySelectorAll("[data-open]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                openDocument(
                    button.dataset.open
                );
            });
        });

    // Download file
    mobileList
        .querySelectorAll("[data-download]")
        .forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();

                downloadDocumentFile(
                    button.dataset.download
                );
            });
        });
}


/* =========================
   OPEN DOCUMENT
========================= */

async function openDocument(id) {
    const doc = documents.find(
        item => item.id === String(id)
    );

    if (!doc) {
        alert("ไม่พบข้อมูลเอกสาร");
        return;
    }

    if (doc.file_key) {
        try {
            const response = await fetch(
                `https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents/${id}/download-url`,
  
            );

            if (!response.ok) {
                throw new Error(
                    "ไม่สามารถสร้างลิงก์เปิดไฟล์ได้"
                );
            }

            const data = await response.json();

            if (!data.download_url) {
                throw new Error(
                    "ไม่พบลิงก์ไฟล์"
                );
            }

            window.open(
                data.download_url,
                "_blank",
                "noopener,noreferrer"
            );

        } catch (error) {
            console.error(
                "Open document error:",
                error
            );

            alert(
                "ไม่สามารถเปิดไฟล์ได้ หรือไม่พบไฟล์ในระบบ"
            );
        }

        return;
    }

    if (doc.path) {
        window.open(
            doc.path,
            "_blank",
            "noopener,noreferrer"
        );

        return;
    }

    alert("ไม่พบไฟล์ในระบบ");
}


/* =========================
   DOWNLOAD DOCUMENT
========================= */

async function downloadDocumentFile(documentId) {
    try {
        const response = await fetch(
            `https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api/documents/${documentId}/download-url`,

        );

        if (!response.ok) {
            throw new Error(
                "ไม่สามารถสร้างลิงก์ดาวน์โหลดได้"
            );
        }

        const data = await response.json();

        if (!data.download_url) {
            throw new Error(
                "ไม่พบลิงก์ดาวน์โหลด"
            );
        }

        const link = document.createElement("a");

        link.href = data.download_url;

        // ให้ browser ดาวน์โหลดไฟล์
        link.download = "";

        link.target = "_blank";
        link.rel = "noopener noreferrer";

        document.body.appendChild(link);

        link.click();

        link.remove();

    } catch (error) {
        console.error(
            "Download error:",
            error
        );

        alert(
            "ไม่สามารถดาวน์โหลดไฟล์ได้"
        );
    }
}


/* =========================
   STATUS FILTER
========================= */

function syncFilterButtons() {
    document
        .querySelectorAll("[data-filter]")
        .forEach(button => {

            const filter =
                button.dataset.filter;

            button.classList.toggle(
                "active",
                currentFilters.has(filter)
            );
        });
}


function setFilter(filter) {

    if (filter === "all") {

        currentFilters.clear();
        currentFilters.add("all");

    } else {

        currentFilters.delete("all");

        if (currentFilters.has(filter)) {
            currentFilters.delete(filter);
        } else {
            currentFilters.add(filter);
        }

        if (currentFilters.size === 0) {
            currentFilters.add("all");
        }
    }

    syncFilterButtons();
    render();
}


/* =========================
   SORT
========================= */

function setupSorting() {

    document
        .querySelectorAll("[data-sort]")
        .forEach(header => {

            header.addEventListener(
                "click",
                () => {

                    const key =
                        header.dataset.sort;

                    if (sortKey === key) {
                        sortDirection *= -1;
                    } else {
                        sortKey = key;
                        sortDirection = 1;
                    }

                    render();
                }
            );

        });
}


/* =========================
   SEARCH
========================= */

if (globalSearch) {

    globalSearch.addEventListener(
        "input",
        () => {
            render();
        }
    );

}


/* =========================
   FILTER BUTTONS
========================= */

document
    .querySelectorAll("[data-filter]")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                setFilter(
                    button.dataset.filter
                );

            }
        );

    });


/* =========================
   ESCAPE HTML
========================= */

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================
   INITIALIZE
========================= */

syncFilterButtons();
setupSorting();
fetchDocuments();