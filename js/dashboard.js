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

let documents = [];
let currentFilter = "all";
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

async function init() {

    try {

        /*
         * ตอนนี้ใช้ data.json ก่อน
         *
         * ถ้า Backend พร้อมแล้ว
         * เปลี่ยน URL ตรงนี้เป็น API ของ Backend
         *
         * เช่น:
         * http://localhost:8080/api/documents
         */

        const response = await fetch("../json/data.json");

        if (!response.ok) {
            throw new Error("data.json not found");
        }

        const data = await response.json();

        documents = data.documents || [];

        render();

    } catch (error) {

        console.error(error);

        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-table">
                        ไม่สามารถโหลดข้อมูลเอกสารได้
                    </td>
                </tr>
            `;
        }

        if (mobileList) {
            mobileList.innerHTML = "";
        }

        if (shownCount) {
            shownCount.textContent = "0";
        }

    }

}


/* =====================================================
   FILTER + SEARCH + SORT
===================================================== */

function getFilteredDocuments() {

    const keyword = globalSearch
        ? globalSearch.value.trim().toLowerCase()
        : "";

    let result = documents.filter(doc => {

        const matchesStatus =
            currentFilter === "all" ||
            doc.statusKey === currentFilter;

        const searchable = [

            doc.number,
            doc.code,
            doc.type,
            doc.description,
            doc.sender,
            doc.receiver,
            doc.statusLabel

        ].join(" ").toLowerCase();

        return matchesStatus &&
               (!keyword || searchable.includes(keyword));

    });


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

function openDocument(id) {

    const doc =
        documents.find(item => item.id === id);

    if (!doc) return;


    if (doc.path) {

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
                button.dataset.filter === currentFilter
            );

        });

}


function setFilter(filter) {

    currentFilter = filter;

    selectedId = null;

    showEmptyDetail();

    render();

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

    globalSearch.addEventListener(
        "input",
        render
    );

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