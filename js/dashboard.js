/* =====================================================
   SIDEBAR
===================================================== */

function toggleMenu() {

    const sidebar = document.getElementById("sidebar");

    if (sidebar) {
        sidebar.classList.toggle("active");
    }

}


document.addEventListener("click", function (e) {

    const link = e.target.closest(".sidebar a");

    if (link) {
        window.location.href = link.href;
    }

});


/* =====================================================
   DOCUMENT DASHBOARD
===================================================== */

const tableBody = document.getElementById("documentTableBody");
const mobileList = document.getElementById("mobileList");
const globalSearch = document.getElementById("globalSearch");
const shownCount = document.getElementById("shownCount");
const detailContent = document.getElementById("detailContent");

// New advanced filters
const typeFilter = document.getElementById("typeFilter");
const dateFrom = document.getElementById("dateFrom");
const dateTo = document.getElementById("dateTo");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");

let documents = [];
let currentFilters = new Set(["all"]);
let selectedId = null;
let sortKey = null;
let sortDirection = 1;


/* =====================================================
   STATUS
===================================================== */

const statusMap = {

    waiting: {
        label: "Received",
        className: "status-waiting"
    },

    processing: {
        label: "Processing",
        className: "status-processing"
    },

    approval: {
        label: "Pending Approval",
        className: "status-approval"
    },

    completed: {
        label: "Completed",
        className: "status-completed"
    },

    archived: {
        label: "Archived",
        className: "status-archived"
    }

};


/* =====================================================
   TYPE ICON
===================================================== */

const typeIcons = {

    red: "⚑",
    orange: "▤",
    purple: "♟",
    green: "♟",
    blue: "▣"

};


/* =====================================================
   LOAD DATA
===================================================== */

async function fetchDocuments() {
    const keyword = globalSearch ? globalSearch.value.trim() : "";
    const selectedType = typeFilter ? typeFilter.value : "all";
    const dFrom = dateFrom ? dateFrom.value : "";
    const dTo = dateTo ? dateTo.value : "";

    const params = new URLSearchParams();
    if (keyword) params.append("search", keyword);
    if (selectedType !== "all") params.append("document_type", selectedType);

    if (!currentFilters.has("all")) {
        currentFilters.forEach(f => {
            let statusParam = "";
            if (f === "waiting") statusParam = "Received";
            else if (f === "processing") statusParam = "Processing";
            else if (f === "approval") statusParam = "Assigned";
            else if (f === "completed") statusParam = "Completed";
            else if (f === "archived") statusParam = "Archived";

            if (statusParam) params.append("status", statusParam);
        });
    }
    if (dFrom) params.append("from_date", dFrom);
    if (dTo) params.append("to_date", dTo);

    try {
        const url = `http://localhost:3000/api/documents?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response was not ok");

        const data = await response.json();

        documents = (data.data || []).map(row => {
            let statusKey = "waiting";
            if (row.status === "Processing") statusKey = "processing";
            if (row.status === "Assigned") statusKey = "approval";
            if (row.status === "Completed") statusKey = "completed";

            let rDate = "";
            let rTime = "";
            if (row.receive_date) {
                const d = new Date(row.receive_date);
                rDate = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
            }
            if (row.created_at) {
                const d = new Date(row.created_at);
                rTime = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            }

            const colors = {
                "ประชาสัมพันธ์": "red",
                "ขออนุมัติ": "orange",
                "มอบหมายงาน": "purple",
                "แจ้งเพื่อทราบ": "green",
                "รอการตอบกลับ": "blue",
                "กำหนดการ/การนัดหมาย": "purple",
                "รายงานผล": "green"
            };
            let color = "red";
            for (const [key, val] of Object.entries(colors)) {
                if (row.document_type && row.document_type.includes(key)) {
                    color = val;
                    break;
                }
            }

            return {
                id: String(row.id),
                number: row.document_number || "-",
                code: row.reference_no || "-",
                type: row.document_type || "-",
                description: row.subject || row.remarks || "-",
                sender: row.sender_name || "-",
                receiver: row.receiver_name || "-",
                statusKey: statusKey,
                statusLabel: row.status,
                receivedDate: rDate,
                receivedTime: rTime,
                color: color,
                file_key: row.file_key || null,
                path: null
            };
        });

        render();

    } catch (error) {
        console.error(error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" class="empty-table">ไม่สามารถโหลดข้อมูลเอกสารได้</td></tr>`;
        }
        if (mobileList) mobileList.innerHTML = "";
        if (shownCount) shownCount.textContent = "0";
    }
}

async function init() {
    await fetchDocuments();
}


/* =====================================================
   FILTER + SEARCH + SORT
===================================================== */

function getFilteredDocuments() {

    let result = [...documents];

    if (sortKey) {

        result.sort((a, b) => {

            const av = String(a[sortKey] ?? "");
            const bv = String(b[sortKey] ?? "");

            return av.localeCompare(
                bv,
                "th",
                {
                    numeric: true
                }
            ) * sortDirection;

        });

    }


    return result;

}


/* =====================================================
   RENDER
===================================================== */

function render() {

    const result = getFilteredDocuments();

    if (shownCount) {
        shownCount.textContent = result.length;
    }


    if (
        selectedId &&
        !result.some(doc => doc.id === selectedId)
    ) {

        selectedId = null;
        showEmptyDetail();

    }


    renderTable(result);
    renderMobile(result);
    syncFilterButtons();

}


/* =====================================================
   TABLE
===================================================== */

function renderTable(result) {

    if (!tableBody) return;


    if (!result.length) {

        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-table">
                    ไม่พบเอกสารที่ตรงกับเงื่อนไข
                </td>
            </tr>
        `;

        return;

    }


    tableBody.innerHTML = result.map(doc => {

        const status =
            statusMap[doc.statusKey] ||
            statusMap.waiting;


        return `

            <tr
                class="${selectedId === doc.id ? "selected" : ""}"
                data-id="${doc.id}"
            >

                <td>

                    <div class="doc-number">
                        ${escapeHtml(doc.number)}
                    </div>

                    <span class="doc-code">
                        ${escapeHtml(doc.code)}
                    </span>

                </td>


                <td>

                    <div class="type-cell">

                        <span
                            class="type-icon ${doc.color || "red"}"
                        >
                            ${typeIcons[doc.color] || "▤"}
                        </span>

                        <div>

                            <div class="type-name">
                                ${escapeHtml(doc.type)}
                            </div>

                            <span class="type-desc">
                                ${escapeHtml(doc.description || "")}
                            </span>

                        </div>

                    </div>

                </td>


                <td class="person-cell">
                    ${escapeHtml(doc.sender)}
                </td>


                <td class="person-cell">
                    ${escapeHtml(doc.receiver)}
                </td>


                <td>

                    <span
                        class="status-badge ${status.className}"
                    >
                        ${status.label}
                    </span>

                </td>


                <td>

                    <div class="received">

                        <strong>
                            ${escapeHtml(doc.receivedDate)}
                        </strong>

                        <span>
                            ${escapeHtml(doc.receivedTime)}
                        </span>

                    </div>

                </td>


                <td>

                    <button
                        class="file-button"
                        data-open="${doc.id}"
                        type="button"
                    >
                        ▤ เปิดไฟล์
                    </button>

                </td>

            </tr>

        `;

    }).join("");


    tableBody
        .querySelectorAll("tr[data-id]")
        .forEach(row => {

            row.addEventListener("click", event => {

                if (event.target.closest("[data-open]")) {
                    return;
                }

                selectDocument(row.dataset.id);

            });

        });


    tableBody
        .querySelectorAll("[data-open]")
        .forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                openDocument(button.dataset.open);

            });

        });

}


/* =====================================================
   MOBILE
===================================================== */

function renderMobile(result) {

    if (!mobileList) return;


    if (!result.length) {

        mobileList.innerHTML = `
            <div class="empty-table">
                ไม่พบเอกสารที่ตรงกับเงื่อนไข
            </div>
        `;

        return;

    }


    mobileList.innerHTML = result.map(doc => {

        const status =
            statusMap[doc.statusKey] ||
            statusMap.waiting;


        return `

            <article
                class="mobile-document"
                data-id="${doc.id}"
            >

                <div class="mobile-top">

                    <span
                        class="type-icon ${doc.color || "red"}"
                    >
                        ${typeIcons[doc.color] || "▤"}
                    </span>


                    <div class="mobile-main">

                        <div class="mobile-number">
                            ${escapeHtml(doc.number)}
                        </div>

                        <div class="mobile-name">
                            ${escapeHtml(doc.type)}
                        </div>

                        <div class="doc-code">
                            ${escapeHtml(doc.code)}
                        </div>

                    </div>

                </div>


                <div class="mobile-meta">

                    <span
                        class="status-badge ${status.className}"
                    >
                        ${status.label}
                    </span>


                    <button
                        class="file-button"
                        data-open="${doc.id}"
                        type="button"
                    >
                        ▤ เปิดไฟล์
                    </button>

                </div>

            </article>

        `;

    }).join("");


    mobileList
        .querySelectorAll(".mobile-document")
        .forEach(card => {

            card.addEventListener("click", event => {

                if (event.target.closest("[data-open]")) {
                    return;
                }

                selectDocument(card.dataset.id);

            });

        });


    mobileList
        .querySelectorAll("[data-open]")
        .forEach(button => {

            button.addEventListener("click", event => {

                event.stopPropagation();

                openDocument(button.dataset.open);

            });

        });

}


/* =====================================================
   SELECT DOCUMENT
===================================================== */

function selectDocument(id) {

    selectedId = id;

    const doc =
        documents.find(item => item.id === id);

    if (!doc) return;

    render();

    renderDetail(doc);


    const detailCard =
        document.getElementById("detailCard");

    if (detailCard) {

        detailCard.scrollIntoView({
            behavior: "smooth",
            block: "nearest"
        });

    }

}


/* =====================================================
   DETAIL
===================================================== */

function renderDetail(doc) {

    if (!detailContent) return;


    const status =
        statusMap[doc.statusKey] ||
        statusMap.waiting;


    detailContent.className = "detail-content";


    detailContent.innerHTML = `

        <div class="detail-document-id">
            ${escapeHtml(doc.code)}
        </div>


        <h3 class="detail-document-title">
            ${escapeHtml(doc.type)}
        </h3>


        <div class="detail-grid">

            <div class="detail-field">

                <label>เลขที่เอกสาร</label>

                <strong>
                    ${escapeHtml(doc.number)}
                </strong>

            </div>


            <div class="detail-field">

                <label>สถานะ</label>

                <span
                    class="status-badge ${status.className}"
                >
                    ${status.label}
                </span>

            </div>


            <div class="detail-field">

                <label>ผู้ส่ง</label>

                <strong>
                    ${escapeHtml(doc.sender)}
                </strong>

            </div>


            <div class="detail-field">

                <label>ผู้รับ</label>

                <strong>
                    ${escapeHtml(doc.receiver)}
                </strong>

            </div>


            <div class="detail-field">

                <label>วันที่รับ</label>

                <strong>
                    ${escapeHtml(doc.receivedDate)}
                </strong>

            </div>


            <div class="detail-field">

                <label>เวลา</label>

                <strong>
                    ${escapeHtml(doc.receivedTime)}
                </strong>

            </div>


            <div class="detail-field detail-full">

                <label>รายละเอียด</label>

                <strong>
                    ${escapeHtml(
        doc.description ||
        "ไม่มีรายละเอียดเพิ่มเติม"
    )}
                </strong>

            </div>


            <div class="detail-field detail-full">

                <label>ไฟล์</label>

                <button
                    class="file-button"
                    type="button"
                    id="detailOpenButton"
                >
                    ▤ เปิดไฟล์
                </button>

            </div>

        </div>

    `;


    const detailOpenButton =
        document.getElementById("detailOpenButton");


    if (detailOpenButton) {

        detailOpenButton.addEventListener(
            "click",
            () => openDocument(doc.id)
        );

    }

}


/* =====================================================
   EMPTY DETAIL
===================================================== */

function showEmptyDetail() {

    if (!detailContent) return;


    detailContent.className = "detail-empty";


    detailContent.innerHTML = `

        <div
            class="empty-document-icon"
            aria-hidden="true"
        >
            ▤
        </div>

        <p>
            เลือกเอกสารจากรายการเพื่อดูรายละเอียด
        </p>

        <div class="skeleton-line wide"></div>
        <div class="skeleton-line medium"></div>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line short"></div>

    `;

}


/* =====================================================
   OPEN DOCUMENT
===================================================== */

async function openDocument(id) {

    const doc =
        documents.find(item => item.id === id);

    if (!doc) return;


    if (doc.file_key) {

        try {
            const res = await fetch(`http://localhost:3000/api/documents/${id}/download-url`);
            if (res.ok) {
                const data = await res.json();
                if (data.download_url) {
                    window.open(data.download_url, "_blank", "noopener,noreferrer");
                    return;
                }
            }
            alert("ไม่สามารถเปิดไฟล์ได้ หรือไม่พบไฟล์ในระบบ");
        } catch (error) {
            console.error("Error opening document:", error);
            alert("เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อดึงไฟล์");
        }

    } else if (doc.path) {
        
        window.open(
            doc.path,
            "_blank",
            "noopener,noreferrer"
        );

    } else {

        selectDocument(id);

    }

}


/* =====================================================
   FILTER
===================================================== */

function syncFilterButtons() {

    document
        .querySelectorAll("[data-filter]")
        .forEach(button => {

            button.classList.toggle(
                "active",
                currentFilters.has(button.dataset.filter)
            );

        });

}


function setFilter(filter) {

    if (filter === "all") {
        currentFilters.clear();
        currentFilters.add("all");
    } else {
        if (currentFilters.has("all")) {
            currentFilters.delete("all");
        }
        if (currentFilters.has(filter)) {
            currentFilters.delete(filter);
            if (currentFilters.size === 0) {
                currentFilters.add("all");
            }
        } else {
            currentFilters.add(filter);
        }
    }

    selectedId = null;

    showEmptyDetail();

    fetchDocuments();

}


/* =====================================================
   EVENT LISTENERS
===================================================== */

document
    .querySelectorAll(".status-filter, .legend-item")
    .forEach(button => {

        button.addEventListener("click", () => {

            setFilter(button.dataset.filter);

        });

    });


document
    .querySelectorAll(".nav-item")
    .forEach(button => {

        button.addEventListener("click", () => {

            document
                .querySelectorAll(".nav-item")
                .forEach(item =>
                    item.classList.remove("active")
                );

            button.classList.add("active");

        });

    });


if (globalSearch) {
    let searchTimeout;
    globalSearch.addEventListener("input", () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(fetchDocuments, 300);
    });
}

if (typeFilter) typeFilter.addEventListener("change", fetchDocuments);

if (dateFrom) dateFrom.addEventListener("change", fetchDocuments);
if (dateTo) dateTo.addEventListener("change", fetchDocuments);
if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
        if (globalSearch) globalSearch.value = "";
        if (typeFilter) typeFilter.value = "all";
        if (dateFrom) dateFrom.value = "";
        if (dateTo) dateTo.value = "";
        currentFilters.clear();
        currentFilters.add("all");
        syncFilterButtons();
        fetchDocuments();
    });
}


document
    .querySelectorAll(".document-table th[data-sort]")
    .forEach(header => {

        header.addEventListener("click", () => {

            const key =
                header.dataset.sort;


            if (sortKey === key) {

                sortDirection *= -1;

            } else {

                sortKey = key;
                sortDirection = 1;

            }


            render();

        });

    });


/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHtml(value) {

    return String(value ?? "")

        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


/* =====================================================
   START
===================================================== */

init();