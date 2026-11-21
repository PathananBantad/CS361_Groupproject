(() => {
    "use strict";

    const informationalTypes = [
        "ประชาสัมพันธ์", "แจ้งเพื่อทราบ", "กำหนดการ/การนัดหมาย",
        "แจ้งกำหนดการ/การนัดหมาย", "รายงานผล"
    ];

    function isFlagSet(value) {
        return value === true || value === 1;
    }

    function priority(doc) {
        if (doc.isPinned) return 0;
        const group = String(doc.actionGroup || "").trim().toLowerCase();
        if (["inform", "informational", "info", "เพื่อทราบ"].includes(group)) return 2;
        if (group) return 1;
        const type = String(doc.type || "").replace(/^เอกสาร/, "").trim();
        return informationalTypes.includes(type) ? 2 : 1;
    }

    function compareByDeadline(a, b) {
        return (a.deadlineDate || "9999-12-31").localeCompare(b.deadlineDate || "9999-12-31");
    }

    function compareByPriority(a, b) {
        return priority(a) - priority(b) ||
            compareByDeadline(a, b) ||
            Number(b.isNew) - Number(a.isNew) ||
            b.receivedDateKey.localeCompare(a.receivedDateKey);
    }

    function deadlineDays(doc, today) {
        if (!doc.deadlineDate || doc.rawStatus === "Completed") return null;
        const days = (Date.parse(doc.deadlineDate) - Date.parse(today)) / 86400000;
        return Number.isFinite(days) ? days : null;
    }

    function deadlineText(days) {
        if (days === null) return "";
        if (days < 0) return `เกินกำหนด ${-days} วัน`;
        if (days === 0) return "ครบกำหนดวันนี้";
        if (days === 1) return "ครบกำหนดพรุ่งนี้";
        return `ครบกำหนดอีก ${days} วัน`;
    }

    function headNote(doc) {
        const note = doc.head_review?.note ?? doc.head_review_note;
        return typeof note === "string" ? note.trim() : "";
    }

    window.DocuFlowInbox = { isFlagSet, compareByDeadline, compareByPriority, deadlineDays, deadlineText, headNote };
})();
