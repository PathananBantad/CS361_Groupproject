require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env")
});
require("dotenv").config({
    path: require("path").resolve(__dirname, ".env")
});

const express = require("express");
const cors = require("cors");
const pool = require("./db");
const path = require("path");

const sessionMiddleware = require("./session");
const authRouter = require("./auth");
const { requireCognitoAuth } = require("./cognito-auth");
const {
    AUDIT_EVENTS,
    AUDIT_EVENT_METADATA,
    sanitizeAuditData,
    extractServerActor,
    recordAuditEvent,
    getAuditTrailByDocumentId,
    queryAuditTrails,
    verifyAuditTrailAccess
} = require("./auditTrail");

async function loadUserRole(req, res, next) {
    if (req.session?.user?.roles?.length) {
        req.userRole = req.session.user.roles[0];
        return next();
    }
    if (req.auth?.groups?.length) {
        req.userRole = req.auth.groups[0];
        return next();
    }
    try {
        if (!req.auth?.sub) {
            req.userRole = "staff";
            return next();
        }
        const [rows] = await pool.execute(
            "SELECT role FROM user_roles WHERE cognito_sub = ? LIMIT 1",
            [req.auth.sub]
        );

        if (rows.length > 0) {
            req.userRole = rows[0].role;
            return next();
        }

        req.userRole = "staff";
        return next();
    } catch (error) {
        console.error("Failed to load user role:", error);
        req.userRole = "staff";
        return next();
    }
}

const {
    createUploadUrl,
    createDownloadUrl,
    getS3Object,
    getPublicUrl,
    getMimeTypeByExtension,
    getObjectBuffer,
    uploadObjectBuffer
} = require("./s3");

const app = express();

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json({ limit: "1mb" }));
app.use(sessionMiddleware);
app.use("/api/auth", authRouter);

const PORT = Number(process.env.PORT || 3000);

// Helper เธเธฑเธเธเนเธเธฑเธเธเนเธญเธเธเธฑเธ XSS
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
}

// Helper เธเธฑเธเธเนเธเธฑเธเธ•เธฃเธงเธเธฃเธนเธเนเธเธเธงเธฑเธเธ—เธตเน YYYY-MM-DD
function isValidDate(dateString) {
    if (!dateString) return true;
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regEx)) return false;
    const d = new Date(dateString);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateString;
}

// Helper เนเธขเธเธเธทเนเธญเนเธเธฅเนเธเธฒเธ fileKey เธ–เนเธฒเนเธกเนเธกเธตเนเธเธ•เธฒเธฃเธฒเธ document_files
function extractFileNameFromKey(fileKey) {
    if (!fileKey) return null;
    const parts = fileKey.split("/");
    const lastPart = parts[parts.length - 1];
    const dashIdx = lastPart.indexOf("-");
    return dashIdx !== -1 ? lastPart.substring(dashIdx + 1) : lastPart;
}

// เธ•เธฃเธงเธเธชเธญเธเธเธฒเธกเธชเธเธธเธฅเธ—เธตเนเธชเธฒเธกเธฒเธฃเธ–เนเธชเธ”เธเธ•เธฑเธงเธญเธขเนเธฒเธ (Preview) เนเธ”เน
const PREVIEWABLE_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

function isPreviewable(fileNameOrKey) {
    if (!fileNameOrKey) return false;
    const ext = path.extname(fileNameOrKey).toLowerCase();
    return PREVIEWABLE_EXTENSIONS.includes(ext);
}

// Helper เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเธฒเธฃเน€เธเนเธฒเธ–เธถเธ Preview เนเธฅเธฐ Download เนเธเธฅเน
const DOCUMENT_ROLES = [
    "document_officer",
    "faculty_staff",
    "case_owner",
    "admin",
    "executive",
    "staff"
];

function checkDocumentAccess(req, document) {
    // 1. เธฃเธญเธเธฃเธฑเธ Session Login
    const user = req.session?.user;
    if (user && user.id && Array.isArray(user.roles)) {
        const roles = user.roles.map(r => String(r).trim().toLowerCase());
        return {
            allowed: true,
            role: roles.includes("admin") ? "admin" : "staff",
            userId: String(user.id),
            isAdmin: roles.includes("admin"),
            isStaff: roles.includes("staff")
        };
    }

    // 2. เธ•เธฃเธงเธเธชเธญเธ Authentication เธเนเธฒเธ req.auth
    if (!req.auth || !req.auth.sub) {
        return {
            allowed: false,
            reason: "Authentication required"
        };
    }

    const userId = req.auth.sub;

    // Role เธ•เนเธญเธเธกเธฒเธเธฒเธเธเนเธญเธกเธนเธฅเธ—เธตเนเธเนเธฒเธเธเธฒเธฃเธ•เธฃเธงเธเธชเธญเธเนเธฅเนเธงเน€เธ—เนเธฒเธเธฑเนเธ
    const groups = Array.isArray(req.auth.groups)
        ? req.auth.groups
        : [];

    const role = groups.find(group =>
        DOCUMENT_ROLES.includes(
            String(group).trim().toLowerCase()
        )
    ) || (req.userRole && DOCUMENT_ROLES.includes(String(req.userRole).trim().toLowerCase()) ? String(req.userRole).trim().toLowerCase() : null) || "staff";

    if (["admin", "executive", "staff", "document_officer", "faculty_staff"].includes(role)) {
        return {
            allowed: true,
            role,
            userId
        };
    }

    if (
        role === "case_owner" &&
        (!document || !document.owner_id || String(document.owner_id) === String(userId))
    ) {
        return {
            allowed: true,
            role,
            userId
        };
    }

    return {
        allowed: false,
        role,
        reason: "Access denied by role policy"
    };
}

// Redirect root to html/index.html before static middleware catches it
app.get('/', (req, res) => {
    res.redirect('/html/index.html');
});

// เน€เธเธฅเธตเนเธขเธเธเธฒเธ path.join(__dirname, '../') เน€เธเนเธ:
app.use(express.static(path.join(__dirname, '../frontend')));

// Test API + Database
app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            ok: true,
            database: "connected"
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            database: "disconnected"
        });
    }
});

// เธ”เธถเธเธฃเธฒเธขเธเธฒเธฃเน€เธญเธเธชเธฒเธฃเธเธฃเนเธญเธก Metadata เธเธญเธเนเธเธฅเน
app.get("/api/documents", async (req, res) => {
    try {
        const userId = req.session?.user?.id || req.auth?.sub || req.query.userId || req.headers["x-user-id"] || null;
        const groups = req.session?.user?.roles || (req.auth && Array.isArray(req.auth.groups) ? req.auth.groups : []) || [req.query.role || req.headers["x-user-role"] || "staff"];
        const role = groups.find(group => DOCUMENT_ROLES.includes(String(group).trim().toLowerCase())) || "staff";
        
        const {
            reference_no,
            subject,
            document_type,
            sender_name,
            receiver_name,
            status,
            from_date,
            to_date,
            search,
            type,
            month
        } = req.query;

        let sql = `
            SELECT 
                d.*,
                f.file_name,
                f.file_size,
                f.mime_type,
                f.uploaded_at AS file_uploaded_at
            FROM documents d
            LEFT JOIN document_files f ON d.id = f.document_id
            WHERE 1 = 1
        `;

        const params = [];

        if (role === "case_owner") {
            sql += " AND d.owner_id = ?";
            params.push(userId);
        }

        // Search by reference number
        if (reference_no) {
            sql += " AND d.reference_no LIKE ?";
            params.push(`%${reference_no}%`);
        }

        // Search by subject
        if (subject) {
            sql += " AND d.subject LIKE ?";
            params.push(`%${subject}%`);
        }

        // Search by document type
        if (document_type) {
            sql += " AND d.document_type = ?";
            params.push(document_type);
        }

        // Search by sender
        if (sender_name) {
            sql += " AND d.sender_name LIKE ?";
            params.push(`%${sender_name}%`);
        }

        // Search by receiver
        if (receiver_name) {
            sql += " AND d.receiver_name LIKE ?";
            params.push(`%${receiver_name}%`);
        }

        // Search by status
        if (status) {
            const statuses = Array.isArray(status) ? status : [status];
            if (statuses.length > 0) {
                const placeholders = statuses.map(() => '?').join(',');
                sql += ` AND d.status IN (${placeholders})`;
                params.push(...statuses);
            }
        }

        // Search from date
        if (from_date) {
            sql += " AND d.receive_date >= ?";
            params.push(from_date);
        }

        // Search to date
        if (to_date) {
            sql += " AND d.receive_date <= ?";
            params.push(to_date);
        }

        if (search) {
            sql += `
                AND (
                    d.sender_name LIKE ?
                    OR d.receiver_name LIKE ?
                    OR d.document_number LIKE ?
                    OR d.reference_no LIKE ?
                    OR d.subject LIKE ?
                )
            `;
            const keyword = `%${search}%`;
            params.push(keyword, keyword, keyword, keyword, keyword);
        }

        if (type) {
            sql += " AND d.document_type = ?";
            params.push(type);
        }

        if (month) {
            sql += " AND MONTH(d.receive_date) = ?";
            params.push(month);
        }

        sql += " ORDER BY d.created_at DESC";

        const [rows] = await pool.query(sql, params);

        // Enrich เธเนเธญเธกเธนเธฅเนเธเธฅเนเธชเธณเธซเธฃเธฑเธ frontend
        const enrichedRows = rows.map(doc => {
            const finalFileName = doc.file_name || extractFileNameFromKey(doc.file_key);
            const ext = finalFileName ? path.extname(finalFileName).toLowerCase() : "";
            const canPreview = isPreviewable(finalFileName || doc.file_key);

            return {
                ...doc,
                display_file_name: finalFileName,
                file_extension: ext,
                can_preview: canPreview,
                mime_type: doc.mime_type || getMimeTypeByExtension(finalFileName || doc.file_key)
            };
        });

        res.json({
            data: enrichedRows,
            total: enrichedRows.length
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to search documents"
        });
    }
});

// Get document by ID เธเธฃเนเธญเธก Metadata เธเธญเธเนเธเธฅเน
app.get("/api/documents/:id", requireCognitoAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `
            SELECT 
                d.*,
                f.file_name,
                f.file_size,
                f.mime_type,
                f.uploaded_at AS file_uploaded_at
            FROM documents d
            LEFT JOIN document_files f ON d.id = f.document_id
            WHERE d.id = ?
            `,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "Document not found"
            });
        }

        const doc = rows[0];
        const access = checkDocumentAccess(req, doc);
        if (!access.allowed) {
            return res.status(403).json({ error: access.reason || "Permission Denied" });
        }

        const finalFileName = doc.file_name || extractFileNameFromKey(doc.file_key);
        const ext = finalFileName ? path.extname(finalFileName).toLowerCase() : "";
        const canPreview = isPreviewable(finalFileName || doc.file_key);

        res.json({
            ...doc,
            display_file_name: finalFileName,
            file_extension: ext,
            can_preview: canPreview,
            mime_type: doc.mime_type || getMimeTypeByExtension(finalFileName || doc.file_key)
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to fetch document"
        });
    }
});

// Create document
app.post("/api/documents", async (req, res) => {
    try {
        let {
            reference_no,
            document_number,
            subject,
            document_type,
            sender_name,
            sender_department,
            sender_contact,
            receiver_name,
            sent_date,
            receive_date,
            deadline,
            remarks,
            receiving_channel,
            status = "Received",
            file_key = null
        } = req.body;

        // 1. เธ•เธฃเธงเธเธชเธญเธเธเนเธญเธเธ—เธฒเธเธฃเธฑเธเน€เธญเธเธชเธฒเธฃ
        const allowedChannels = ["EMAIL", "PAPER"];

        if (!allowedChannels.includes(receiving_channel)) {
            return res.status(400).json({
                error: "receiving_channel must be EMAIL or PAPER"
            });
        }

        // 2. เธ•เธฃเธงเธเธชเธญเธเธเธดเธฅเธ”เนเธเธณเน€เธเนเธ (Required fields)
        if (!subject || !document_type || !sender_name) {
            return res.status(400).json({
                error: "subject, document_type and sender_name are required"
            });
        }

        // 2. เธ•เธฃเธงเธเธชเธญเธเธเธงเธฒเธกเธขเธฒเธงเธ•เธฑเธงเธญเธฑเธเธฉเธฃ (Length Checks)
        if (subject.length > 255) return res.status(400).json({ error: "subject must not exceed 255 characters" });
        if (document_number && document_number.length > 100) return res.status(400).json({ error: "document_number must not exceed 100 characters" });
        if (sender_name.length > 200) return res.status(400).json({ error: "sender_name must not exceed 200 characters" });
        if (sender_department && sender_department.length > 200) return res.status(400).json({ error: "sender_department must not exceed 200 characters" });
        if (receiver_name && receiver_name.length > 200) return res.status(400).json({ error: "receiver_name must not exceed 200 characters" });

        // 3. เธ•เธฃเธงเธเธชเธญเธเธฃเธนเธเนเธเธเธงเธฑเธเธ—เธตเน (YYYY-MM-DD)
        if (sent_date && !isValidDate(sent_date)) return res.status(400).json({ error: "sent_date must be in YYYY-MM-DD format" });
        if (receive_date && !isValidDate(receive_date)) return res.status(400).json({ error: "receive_date must be in YYYY-MM-DD format" });
        if (deadline && !isValidDate(deadline)) return res.status(400).json({ error: "deadline must be in YYYY-MM-DD format" });

        // 4. เธฅเนเธฒเธเธเนเธญเธกเธนเธฅเธเนเธญเธเธเธฑเธ XSS (Sanitize HTML tags)
        const sanitizedSubject = sanitizeInput(subject);
        const sanitizedSenderName = sanitizeInput(sender_name);
        const sanitizedSenderDepartment = sanitizeInput(sender_department);
        const sanitizedReceiverName = sanitizeInput(receiver_name);
        const sanitizedRemarks = sanitizeInput(remarks);

        // เธ•เธฃเธงเธเธชเธญเธ Status เธ•เธฒเธก Workflow V3
        const allowedStatuses = ["Received", "Assigned", "Processing", "Completed"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                error: "status must be one of: Received, Assigned, Processing, Completed"
            });
        }

        // Logic เธชเธฃเนเธฒเธ reference_no
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const datePrefix = `DOC-${yyyy}${mm}${dd}-`;

        const [refRows] = await pool.query(
            "SELECT reference_no FROM documents WHERE reference_no LIKE ? ORDER BY reference_no DESC LIMIT 1",
            [`${datePrefix}%`]
        );

        let newRefNo = "";
        if (refRows.length > 0) {
            const lastRef = refRows[0].reference_no;
            const lastNum = parseInt(lastRef.split('-')[2], 10);
            if (!isNaN(lastNum)) {
                newRefNo = `${datePrefix}${String(lastNum + 1).padStart(4, '0')}`;
            } else {
                newRefNo = `${datePrefix}${(Math.floor(Math.random() * 9000) + 1000)}`;
            }
        } else {
            newRefNo = `${datePrefix}0001`;
        }

        const actor = extractServerActor(req);
        const connection = await pool.getConnection();
        let createdDoc = null;

        try {
            await connection.beginTransaction();

            const [result] = await connection.query(
                `
                INSERT INTO documents (
                    reference_no, document_number, subject, document_type,
                    sender_name, sender_department, sender_contact, receiver_name,
                    sent_date, receive_date, deadline, remarks,
                    receiving_channel, status, file_key, owner_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    reference_no || newRefNo,
                    document_number || null,
                    sanitizedSubject,
                    document_type,
                    sanitizedSenderName,
                    sanitizedSenderDepartment || null,
                    sender_contact || null,
                    sanitizedReceiverName || null,
                    sent_date || null,
                    receive_date || null,
                    deadline || null,
                    sanitizedRemarks || null,
                    receiving_channel,
                    status,
                    file_key,
                    null
                ]
            );

            const newDocId = result.insertId;

            // เธเธฑเธเธ—เธถเธ Audit Trail เธชเธณเธซเธฃเธฑเธเธเธฒเธฃเธชเธฃเนเธฒเธเน€เธญเธเธชเธฒเธฃเนเธซเธกเน (Task 4, 5, 6, 7)
            await recordAuditEvent({
                documentId: newDocId,
                actorUserId: actor.actorUserId,
                actorUsername: actor.actorUsername,
                actorRole: actor.actorRole,
                eventType: AUDIT_EVENTS.DOCUMENT_CREATE,
                beforeState: null,
                afterState: {
                    reference_no: reference_no || newRefNo,
                    document_number: document_number || null,
                    subject: sanitizedSubject,
                    document_type: document_type,
                    sender_name: sanitizedSenderName,
                    receiving_channel: receiving_channel,
                    status: status
                },
                details: {
                    remarks: sanitizedRemarks || null
                },
                ipAddress: actor.ipAddress,
                connection
            });

            await connection.commit();

            const [rows] = await pool.query("SELECT * FROM documents WHERE id = ?", [newDocId]);
            createdDoc = rows[0];
        } catch (txError) {
            await connection.rollback();
            throw txError;
        } finally {
            connection.release();
        }

        res.status(201).json(createdDoc);

    } catch (error) {
        console.error(error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "reference_no already exists"
            });
        }

        res.status(500).json({
            error: "Failed to create document"
        });
    }
});

// ============================================================================
// [V3] WORKFLOW STATUS MANAGEMENT APIS
// ============================================================================

// V3 Workflow Constants
const V3_STATUSES = ["Received", "Assigned", "Processing", "Completed"];

const V3_STATUS_LABELS = {
    Received: "เนเธ”เนเธฃเธฑเธเน€เธญเธเธชเธฒเธฃเนเธฅเนเธง",
    Assigned: "เธกเธญเธเธซเธกเธฒเธขเนเธฅเนเธง",
    Processing: "เธเธณเธฅเธฑเธเธ”เธณเน€เธเธดเธเธเธฒเธฃ",
    Completed: "เธ”เธณเน€เธเธดเธเธเธฒเธฃเน€เธชเธฃเนเธเธชเธดเนเธเนเธฅเนเธง"
};

const V3_WORKFLOW_TRANSITIONS = {
    Received: ["Assigned"],
    Assigned: ["Processing"],
    Processing: ["Completed"],
    Completed: [] // Terminal state
};

// GET /api/workflow/config - เน€เธฃเธตเธขเธเธ”เธนเธเธฒเธฃเธ•เธฑเนเธเธเนเธฒ Workflow เธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃ V3
app.get("/api/workflow/config", (req, res) => {
    res.json({
        version: "V3",
        statuses: [
            { key: "Received", label: "เนเธ”เนเธฃเธฑเธเน€เธญเธเธชเธฒเธฃเนเธฅเนเธง", step: 1, color: "teal", description: "เนเธ”เนเธฃเธฑเธเน€เธญเธเธชเธฒเธฃเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง" },
            { key: "Assigned", label: "เธกเธญเธเธซเธกเธฒเธขเนเธฅเนเธง", step: 2, color: "orange", description: "เธกเธญเธเธซเธกเธฒเธขเน€เธญเธเธชเธฒเธฃเนเธซเนเธเธนเนเธฃเธฑเธเธเธดเธ”เธเธญเธเธ”เธณเน€เธเธดเธเธเธฒเธฃ" },
            { key: "Processing", label: "เธเธณเธฅเธฑเธเธ”เธณเน€เธเธดเธเธเธฒเธฃ", step: 3, color: "blue", description: "เธเธนเนเธฃเธฑเธเธเธดเธ”เธเธญเธเธเธณเธฅเธฑเธเธ”เธณเน€เธเธดเธเธเธฒเธฃเธเธฑเธเน€เธญเธเธชเธฒเธฃ" },
            { key: "Completed", label: "เธ”เธณเน€เธเธดเธเธเธฒเธฃเน€เธชเธฃเนเธเธชเธดเนเธเนเธฅเนเธง", step: 4, color: "green", description: "เธ”เธณเน€เธเธดเธเธเธฒเธฃเธ•เธฒเธกเน€เธญเธเธชเธฒเธฃเน€เธชเธฃเนเธเธชเธดเนเธเธชเธกเธเธนเธฃเธ“เนเนเธฅเนเธง" }
        ],
        transitions: V3_WORKFLOW_TRANSITIONS,
        permissions: {
            staff: { can_change_status: true, rule: "เน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเธ•เธฒเธกเธฅเธณเธ”เธฑเธ Workflow เธ—เธตเธฅเธฐเธเธฑเนเธเธ•เธญเธ" },
            admin: { can_change_status: true, rule: "เน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเธ•เธฒเธก Workflow เธซเธฃเธทเธญเธเธฃเธฑเธเธเธฃเธธเธเนเธเนเนเธเธ•เธฒเธกเธเธงเธฒเธกเน€เธซเธกเธฒเธฐเธชเธก" },
            guest: { can_change_status: false, rule: "เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃ (Read-only)" }
        }
    });
});

// GET /api/documents/:id/status-history - เธ”เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเธเธญเธเน€เธญเธเธชเธฒเธฃ (Audit Log)
app.get("/api/documents/:id/status-history", async (req, res) => {
    try {
        const { id } = req.params;

        const [docRows] = await pool.query("SELECT id, reference_no, subject, status FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "เนเธกเนเธเธเธเนเธญเธกเธนเธฅเน€เธญเธเธชเธฒเธฃเนเธเธฃเธฐเธเธ" });
        }

        const [logs] = await pool.query(
            `SELECT id, document_id, old_status, new_status, changed_by, changed_by_user_id, remarks, changed_at
             FROM document_status_logs
             WHERE document_id = ?
             ORDER BY changed_at ASC, id ASC`,
            [id]
        );

        res.json({
            document_id: id,
            reference_no: docRows[0].reference_no,
            current_status: docRows[0].status,
            history: logs
        });
    } catch (error) {
        console.error("Fetch status history error:", error);
        res.status(500).json({ error: "เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธ”เธถเธเธเนเธญเธกเธนเธฅเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃเนเธ”เน" });
    }
});

// PUT /api/documents/:id/status - เน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃเธ•เธฒเธก Workflow V3 เธเธฃเนเธญเธกเธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเนเธฅเธฐเน€เธเธทเนเธญเธเนเธ (เน€เธเธทเนเธญเธกเธ•เนเธญ Audit Trail)
app.put("/api/documents/:id/status", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const { id } = req.params;
        const { status: newStatus, remarks } = req.body;

        // 1. เธ”เธถเธเธเนเธญเธกเธนเธฅเธ•เธฑเธงเธ•เธเนเธฅเธฐเธชเธดเธ—เธเธดเนเธเธฒเธ Server Authentication เน€เธ—เนเธฒเธเธฑเนเธ (Task 5)
        const actor = extractServerActor(req);
        const userId = actor.actorUserId;
        const username = actor.actorUsername;
        const role = actor.actorRole;
        const sanitizedRemarks = sanitizeInput(remarks || "");

        // 2. เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเธนเนเนเธเน: เน€เธเธเธฒเธฐ staff, faculty_staff, document_officer, case_owner เนเธฅเธฐ admin
        if (!role || !["document_officer", "case_owner", "admin", "staff", "faculty_staff"].includes(role)) {
            return res.status(403).json({
                error: "เธเธธเธ“เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเนเธเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃ (เธ•เนเธญเธเธเธฒเธฃเธชเธดเธ—เธเธดเน Staff เธซเธฃเธทเธญ Admin เน€เธ—เนเธฒเธเธฑเนเธ)"
            });
        }

        // 3. เธ•เธฃเธงเธเธชเธญเธเธเนเธฒเธชเธ–เธฒเธเธฐเนเธซเธกเนเธ—เธตเนเธชเนเธเธกเธฒ
        if (!newStatus) {
            return res.status(400).json({
                error: "เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเธชเธ–เธฒเธเธฐเนเธซเธกเนเธ—เธตเนเธ•เนเธญเธเธเธฒเธฃเน€เธเธฅเธตเนเธขเธ (status is required)"
            });
        }

        if (!V3_STATUSES.includes(newStatus)) {
            return res.status(400).json({
                error: `เธชเธ–เธฒเธเธฐ "${newStatus}" เนเธกเนเธ–เธนเธเธ•เนเธญเธ เธชเธ–เธฒเธเธฐเธ—เธตเนเธญเธเธธเธเธฒเธ•เนเธ V3 เนเธ”เนเนเธเน: ${V3_STATUSES.join(", ")}`
            });
        }

        // 4. เธ•เธฃเธงเธเธชเธญเธเธงเนเธฒเน€เธญเธเธชเธฒเธฃเธกเธตเธญเธขเธนเนเธเธฃเธดเธเนเธเธฃเธฐเธเธเธซเธฃเธทเธญเนเธกเน
        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({
                error: "เนเธกเนเธเธเน€เธญเธเธชเธฒเธฃเธ—เธตเนเธฃเธฐเธเธธเนเธเธฃเธฐเธเธ (Document not found)"
            });
        }

        const doc = docRows[0];
        const oldStatus = doc.status || "Received";

        // 5. เธเนเธญเธเธเธฑเธเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเน€เธเนเธเธชเธ–เธฒเธเธฐเน€เธ”เธดเธก
        if (oldStatus === newStatus) {
            const label = V3_STATUS_LABELS[oldStatus] || oldStatus;
            return res.status(400).json({
                error: `เน€เธญเธเธชเธฒเธฃเธญเธขเธนเนเนเธเธชเธ–เธฒเธเธฐ "${label}" (${oldStatus}) เธญเธขเธนเนเนเธฅเนเธง เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เน€เธเธฅเธตเนเธขเธเน€เธเนเธเธชเธ–เธฒเธเธฐเน€เธ”เธดเธกเนเธ”เน`
            });
        }

        // 6. เธ•เธฃเธงเธเธชเธญเธเน€เธเธทเนเธญเธเนเธเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเธ•เธฒเธก Workflow
        const isAdmin = role === "admin";
        const allowedNextStatuses = V3_WORKFLOW_TRANSITIONS[oldStatus] || [];
        const isStandardWorkflowStep = allowedNextStatuses.includes(newStatus);

        if (!isAdmin && !isStandardWorkflowStep) {
            if (oldStatus === "Completed") {
                return res.status(400).json({
                    error: `เน€เธญเธเธชเธฒเธฃเธเธตเนเธญเธขเธนเนเนเธเธชเธ–เธฒเธเธฐ "เธ”เธณเน€เธเธดเธเธเธฒเธฃเน€เธชเธฃเนเธเธชเธดเนเธเนเธฅเนเธง" (Completed) เธเธถเนเธเน€เธเนเธเธชเธ–เธฒเธเธฐเธชเธดเนเธเธชเธธเธ”เธเธญเธ Workflow เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเธ•เนเธญเนเธเนเธ”เนเธญเธตเธ`
                });
            }

            const allowedLabels = allowedNextStatuses.map(s => `"${V3_STATUS_LABELS[s] || s}" (${s})`).join(", ") || "เนเธกเนเธกเธต";
            return res.status(400).json({
                error: `เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเธเธฒเธ "${V3_STATUS_LABELS[oldStatus] || oldStatus}" เนเธเน€เธเนเธ "${V3_STATUS_LABELS[newStatus] || newStatus}" เนเธ”เน เธ•เธฒเธกเน€เธเธทเนเธญเธเนเธ Workflow V3 (เธชเธ–เธฒเธเธฐเธ–เธฑเธ”เนเธเธ—เธตเนเธญเธเธธเธเธฒเธ•เธเธทเธญ: ${allowedLabels})`
            });
        }

        // 7. เนเธเน Database Transaction เน€เธเธทเนเธญเธเนเธญเธเธเธฑเธเธเนเธญเธกเธนเธฅเน€เธญเธเธชเธฒเธฃเนเธฅเธฐเธเธฃเธฐเธงเธฑเธ•เธดเนเธกเนเธชเธญเธ”เธเธฅเนเธญเธเธเธฑเธ (Task 7)
        const connection = await pool.getConnection();
        let auditRecord = null;
        try {
            await connection.beginTransaction();

            const [updateResult] = await connection.query(
                `UPDATE documents SET status = ? WHERE id = ?`,
                [newStatus, id]
            );

            if (updateResult.affectedRows === 0) {
                throw new Error("เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธญเธฑเธเน€เธ”เธ•เธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃเนเธเธเธฒเธเธเนเธญเธกเธนเธฅ");
            }

            // เธเธฑเธเธ—เธถเธ document_status_logs เธชเธณเธซเธฃเธฑเธเธเธงเธฒเธกเน€เธเนเธฒเธเธฑเธเนเธ”เนเธขเนเธญเธเธซเธฅเธฑเธเธเธฑเธ V3
            await connection.query(
                `INSERT INTO document_status_logs (document_id, old_status, new_status, changed_by, changed_by_user_id, remarks, changed_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [id, oldStatus, newStatus, username, userId, sanitizedRemarks || null]
            );

            // เธเธฑเธเธ—เธถเธ Audit Trail เธชเนเธงเธเธเธฅเธฒเธ (Task 3, 4, 6)
            auditRecord = await recordAuditEvent({
                documentId: id,
                actorUserId: actor.actorUserId,
                actorUsername: actor.actorUsername,
                actorRole: actor.actorRole,
                eventType: AUDIT_EVENTS.STATUS_CHANGE,
                beforeState: { status: oldStatus },
                afterState: { status: newStatus },
                details: {
                    remarks: sanitizedRemarks || null,
                    old_status_label: V3_STATUS_LABELS[oldStatus] || oldStatus,
                    new_status_label: V3_STATUS_LABELS[newStatus] || newStatus,
                    is_admin_override: isAdmin && !isStandardWorkflowStep
                },
                ipAddress: actor.ipAddress,
                connection
            });

            await connection.commit();
        } catch (txError) {
            await connection.rollback();
            throw txError;
        } finally {
            connection.release();
        }

        // 8. เธ”เธถเธเธเนเธญเธกเธนเธฅเน€เธญเธเธชเธฒเธฃเนเธฅเธฐเธเธฃเธฐเธงเธฑเธ•เธดเธฅเนเธฒเธชเธธเธ”เธชเนเธเธเธฅเธฑเธเนเธเนเธซเน Frontend
        const [updatedRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        const [historyRows] = await pool.query(
            `SELECT id, old_status, new_status, changed_by, remarks, changed_at
             FROM document_status_logs
             WHERE document_id = ?
             ORDER BY changed_at DESC LIMIT 1`,
            [id]
        );

        res.json({
            ok: true,
            message: `เน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃเน€เธเนเธ "${V3_STATUS_LABELS[newStatus] || newStatus}" เธชเธณเน€เธฃเนเธเน€เธฃเธตเธขเธเธฃเนเธญเธข`,
            data: updatedRows[0],
            status_log: historyRows[0] || null,
            audit: auditRecord
        });

    } catch (error) {
        console.error("Update document status error:", error);
        res.status(500).json({
            error: "เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เธเธญเธเน€เธเธดเธฃเนเธเน€เธงเธญเธฃเนเนเธเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเน€เธญเธเธชเธฒเธฃ: " + error.message
        });
    }
});

// POST /api/documents/:id/assign - เธกเธญเธเธซเธกเธฒเธขเน€เธญเธเธชเธฒเธฃเนเธซเนเธเธนเนเธฃเธฑเธเธเธดเธ”เธเธญเธ (Task 1, 4, 5, 6, 7)
app.post("/api/documents/:id/assign", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const { id } = req.params;
        const { assignee_id, assignee_name, remarks } = req.body || {};

        const actor = extractServerActor(req);
        const role = actor.actorRole;

        // เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเธนเนเธกเธตเธญเธณเธเธฒเธเธกเธญเธเธซเธกเธฒเธข
        if (!role || !["document_officer", "case_owner", "admin", "staff", "faculty_staff"].includes(role)) {
            return res.status(403).json({
                error: "เธเธธเธ“เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเนเธเธเธฒเธฃเธกเธญเธเธซเธกเธฒเธขเน€เธญเธเธชเธฒเธฃ (เธ•เนเธญเธเธเธฒเธฃเธชเธดเธ—เธเธดเน Staff เธซเธฃเธทเธญ Admin)"
            });
        }

        if (!assignee_id) {
            return res.status(400).json({
                error: "เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเธเธนเนเธฃเธฑเธเธกเธญเธเธซเธกเธฒเธข (assignee_id is required)"
            });
        }

        const sanitizedAssigneeId = String(assignee_id).trim();
        const sanitizedAssigneeName = sanitizeInput(assignee_name || "");
        const sanitizedRemarks = sanitizeInput(remarks || "");

        const connection = await pool.getConnection();
        let auditRecord = null;
        let updatedDoc = null;

        try {
            await connection.beginTransaction();

            const [docRows] = await connection.query("SELECT * FROM documents WHERE id = ? FOR UPDATE", [id]);
            if (docRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: "เนเธกเนเธเธเน€เธญเธเธชเธฒเธฃเธ—เธตเนเธฃเธฐเธเธธเนเธเธฃเธฐเธเธ" });
            }

            const doc = docRows[0];
            const oldStatus = doc.status || "Received";
            // เธซเธฒเธเน€เธญเธเธชเธฒเธฃเธขเธฑเธเธญเธขเธนเนเนเธเธชเธ–เธฒเธเธฐ Received เธเธฒเธฃเธกเธญเธเธซเธกเธฒเธขเธเธฐเธเธฃเธฑเธเธชเธ–เธฒเธเธฐเน€เธเนเธ Assigned เนเธ”เธขเธญเธฑเธ•เนเธเธกเธฑเธ•เธด
            const newStatus = oldStatus === "Received" ? "Assigned" : oldStatus;

            // เธ•เธฃเธงเธเธชเธญเธเธงเนเธฒ assignee_id เธกเธตเธญเธขเธนเนเนเธ users เธซเธฃเธทเธญเนเธกเน เน€เธเธทเนเธญเธญเธฑเธเน€เธ”เธ• owner_id / assignee_id เนเธ”เธขเนเธกเนเธเธดเธ” FK constraint
            const numericAssigneeId = parseInt(sanitizedAssigneeId, 10);
            let validUserId = null;
            if (!isNaN(numericAssigneeId)) {
                const [uRows] = await connection.query("SELECT id FROM users WHERE id = ?", [numericAssigneeId]);
                if (uRows.length > 0) {
                    validUserId = uRows[0].id;
                }
            }

            // เธญเธฑเธเน€เธ”เธ•เธเนเธญเธกเธนเธฅเธเธนเนเธฃเธฑเธเธกเธญเธเธซเธกเธฒเธขเนเธฅเธฐเธชเธ–เธฒเธเธฐเนเธเธ•เธฒเธฃเธฒเธ documents
            await connection.query(
                `UPDATE documents 
                 SET assignee_id = ?, owner_id = COALESCE(owner_id, ?), status = ? 
                 WHERE id = ?`,
                [validUserId, validUserId, newStatus, id]
            );

            // เธเธฑเธเธ—เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธฅเธเนเธ document_assignments
            await connection.query(
                `INSERT INTO document_assignments 
                    (document_id, assigned_by_user_id, assigned_by_username, previous_assignee_id, new_assignee_id, action_type, remarks)
                 VALUES (?, ?, ?, ?, ?, 'ASSIGN', ?)`,
                [
                    id,
                    actor.actorUserId,
                    actor.actorUsername,
                    doc.assignee_id ? String(doc.assignee_id) : null,
                    sanitizedAssigneeId,
                    sanitizedRemarks || null
                ]
            );

            // เธซเธฒเธเธกเธตเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐ เธเธฑเธเธ—เธถเธเนเธ document_status_logs เธ”เนเธงเธข
            if (newStatus !== oldStatus) {
                await connection.query(
                    `INSERT INTO document_status_logs (document_id, old_status, new_status, changed_by, changed_by_user_id, remarks, changed_at)
                     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [id, oldStatus, newStatus, actor.actorUsername, actor.actorUserId, sanitizedRemarks || "เธกเธญเธเธซเธกเธฒเธขเน€เธญเธเธชเธฒเธฃ"]
                );
            }

            // เธเธฑเธเธ—เธถเธ Audit Trail เธเธฅเธฒเธ (Task 2, 3, 4, 6)
            auditRecord = await recordAuditEvent({
                documentId: id,
                actorUserId: actor.actorUserId,
                actorUsername: actor.actorUsername,
                actorRole: actor.actorRole,
                eventType: AUDIT_EVENTS.ASSIGN,
                beforeState: {
                    owner_id: doc.owner_id,
                    assignee_id: doc.assignee_id,
                    status: oldStatus
                },
                afterState: {
                    owner_id: doc.owner_id || sanitizedAssigneeId,
                    assignee_id: sanitizedAssigneeId,
                    status: newStatus
                },
                details: {
                    assignee_name: sanitizedAssigneeName || null,
                    previous_assignee_id: doc.assignee_id || null,
                    new_assignee_id: sanitizedAssigneeId,
                    remarks: sanitizedRemarks || null
                },
                ipAddress: actor.ipAddress,
                connection
            });

            await connection.commit();

            const [rows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
            updatedDoc = rows[0];

        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }

        res.json({
            ok: true,
            message: `เธกเธญเธเธซเธกเธฒเธขเน€เธญเธเธชเธฒเธฃเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง`,
            data: updatedDoc,
            audit: auditRecord
        });

    } catch (error) {
        console.error("Assign document error:", error);
        res.status(500).json({ error: "เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธกเธญเธเธซเธกเธฒเธขเน€เธญเธเธชเธฒเธฃ: " + error.message });
    }
});

// POST /api/documents/:id/forward - เธชเนเธเธ•เนเธญเน€เธญเธเธชเธฒเธฃ (Task 1, 4, 5, 6, 7)
app.post("/api/documents/:id/forward", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const { id } = req.params;
        const { new_assignee_id, new_assignee_name, receiver_name, remarks, reason } = req.body || {};

        const actor = extractServerActor(req);
        const role = actor.actorRole;

        // เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเธนเนเธกเธตเธญเธณเธเธฒเธเธชเนเธเธ•เนเธญ
        if (!role || !["document_officer", "case_owner", "admin", "staff", "faculty_staff"].includes(role)) {
            return res.status(403).json({
                error: "เธเธธเธ“เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเนเธเธเธฒเธฃเธชเนเธเธ•เนเธญเน€เธญเธเธชเธฒเธฃ (เธ•เนเธญเธเธเธฒเธฃเธชเธดเธ—เธเธดเน Staff เธซเธฃเธทเธญ Admin)"
            });
        }

        if (!new_assignee_id && !receiver_name) {
            return res.status(400).json({
                error: "เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเธเธนเนเธฃเธฑเธเธชเนเธเธ•เนเธญ (new_assignee_id เธซเธฃเธทเธญ receiver_name is required)"
            });
        }

        const sanitizedNewAssigneeId = new_assignee_id ? String(new_assignee_id).trim() : null;
        const sanitizedAssigneeName = sanitizeInput(new_assignee_name || "");
        const sanitizedReceiverName = sanitizeInput(receiver_name || "");
        const sanitizedRemarks = sanitizeInput(remarks || "");
        const sanitizedReason = sanitizeInput(reason || "");

        const connection = await pool.getConnection();
        let auditRecord = null;
        let updatedDoc = null;

        try {
            await connection.beginTransaction();

            const [docRows] = await connection.query("SELECT * FROM documents WHERE id = ? FOR UPDATE", [id]);
            if (docRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: "เนเธกเนเธเธเน€เธญเธเธชเธฒเธฃเธ—เธตเนเธฃเธฐเธเธธเนเธเธฃเธฐเธเธ" });
            }

            const doc = docRows[0];

            // เธญเธฑเธเน€เธ”เธ•เน€เธญเธเธชเธฒเธฃ
            await connection.query(
                `UPDATE documents 
                 SET assignee_id = COALESCE(?, assignee_id),
                     receiver_name = COALESCE(?, receiver_name)
                 WHERE id = ?`,
                [sanitizedNewAssigneeId, sanitizedReceiverName || null, id]
            );

            // เธเธฑเธเธ—เธถเธเธฅเธเธ•เธฒเธฃเธฒเธ document_assignments
            await connection.query(
                `INSERT INTO document_assignments 
                    (document_id, assigned_by_user_id, assigned_by_username, previous_assignee_id, new_assignee_id, action_type, remarks)
                 VALUES (?, ?, ?, ?, ?, 'FORWARD', ?)`,
                [
                    id,
                    actor.actorUserId,
                    actor.actorUsername,
                    doc.assignee_id ? String(doc.assignee_id) : null,
                    sanitizedNewAssigneeId || sanitizedReceiverName,
                    sanitizedRemarks || sanitizedReason || null
                ]
            );

            // เธเธฑเธเธ—เธถเธ Audit Trail เธชเนเธงเธเธเธฅเธฒเธ (Task 2, 3, 4, 6)
            auditRecord = await recordAuditEvent({
                documentId: id,
                actorUserId: actor.actorUserId,
                actorUsername: actor.actorUsername,
                actorRole: actor.actorRole,
                eventType: AUDIT_EVENTS.FORWARD,
                beforeState: {
                    owner_id: doc.owner_id,
                    assignee_id: doc.assignee_id,
                    receiver_name: doc.receiver_name,
                    status: doc.status
                },
                afterState: {
                    owner_id: doc.owner_id,
                    assignee_id: sanitizedNewAssigneeId || doc.assignee_id,
                    receiver_name: sanitizedReceiverName || doc.receiver_name,
                    status: doc.status
                },
                details: {
                    new_assignee_name: sanitizedAssigneeName || null,
                    previous_assignee_id: doc.assignee_id || null,
                    new_assignee_id: sanitizedNewAssigneeId || null,
                    receiver_name: sanitizedReceiverName || null,
                    reason: sanitizedReason || null,
                    remarks: sanitizedRemarks || null
                },
                ipAddress: actor.ipAddress,
                connection
            });

            await connection.commit();

            const [rows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
            updatedDoc = rows[0];

        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }

        res.json({
            ok: true,
            message: `เธชเนเธเธ•เนเธญเน€เธญเธเธชเธฒเธฃเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง`,
            data: updatedDoc,
            audit: auditRecord
        });

    } catch (error) {
        console.error("Forward document error:", error);
        res.status(500).json({ error: "เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธชเนเธเธ•เนเธญเน€เธญเธเธชเธฒเธฃ: " + error.message });
    }
});

// GET /api/documents/:id/audit-trail - เธ•เธฃเธงเธเธชเธญเธเธเธฃเธฐเธงเธฑเธ•เธด Audit Trail เธเธญเธเน€เธญเธเธชเธฒเธฃเธ•เธฒเธก Role/Permission Matrix (Task 8)
app.get("/api/documents/:id/audit-trail", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const { id } = req.params;
        const actor = extractServerActor(req);

        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "เนเธกเนเธเธเน€เธญเธเธชเธฒเธฃเธ—เธตเนเธฃเธฐเธเธธเนเธเธฃเธฐเธเธ" });
        }

        const doc = docRows[0];

        // เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเธฒเธฃเน€เธเนเธฒเธ–เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธ•เธฒเธก Role/Permission Matrix (Task 8)
        const access = verifyAuditTrailAccess(
            { userId: actor.actorUserId, role: actor.actorRole },
            doc
        );

        if (!access.allowed) {
            return res.status(403).json({
                error: access.reason || "เธเธธเธ“เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเน€เธเนเธฒเธ–เธถเธเธเธฃเธฐเธงเธฑเธ•เธด Audit Trail เธเธญเธเน€เธญเธเธชเธฒเธฃเธเธตเน"
            });
        }

        const auditList = await getAuditTrailByDocumentId(id, {
            eventType: req.query.event_type,
            startDate: req.query.from_date,
            endDate: req.query.to_date
        });

        res.json({
            ok: true,
            document_id: id,
            reference_no: doc.reference_no,
            subject: doc.subject,
            current_status: doc.status,
            total: auditList.length,
            history: auditList
        });

    } catch (error) {
        console.error("Fetch audit trail error:", error);
        res.status(500).json({ error: "เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธ”เธถเธเธเนเธญเธกเธนเธฅ Audit Trail เนเธ”เน: " + error.message });
    }
});

// GET /api/audit-trails - เน€เธฃเธตเธขเธเธ”เธน Audit Trail เธฃเธงเธกเธ—เธฑเนเธเธฃเธฐเธเธ เธชเธณเธซเธฃเธฑเธเธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธ (Admin) เธซเธฃเธทเธญ เธเธนเนเธเธฃเธดเธซเธฒเธฃ (Executive) (Task 8)
app.get("/api/audit-trails", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const actor = extractServerActor(req);
        const role = String(actor.actorRole || "").toLowerCase();

        // เธเธณเธเธฑเธ”เน€เธเธเธฒเธฐ Admin เนเธฅเธฐ Executive
        if (!["admin", "executive"].includes(role)) {
            return res.status(403).json({
                error: "เธเธธเธ“เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเน€เธเนเธฒเธ–เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธฃเธ•เธฃเธงเธเธชเธญเธเธ—เธฑเนเธเธฃเธฐเธเธ (เธ•เนเธญเธเธเธฒเธฃเธชเธดเธ—เธเธดเน Admin เธซเธฃเธทเธญ Executive เน€เธ—เนเธฒเธเธฑเนเธ)"
            });
        }

        const result = await queryAuditTrails({
            page: req.query.page,
            limit: req.query.limit,
            documentId: req.query.document_id,
            eventType: req.query.event_type,
            actorUserId: req.query.actor_id,
            startDate: req.query.from_date,
            endDate: req.query.to_date
        });

        res.json({
            ok: true,
            ...result
        });

    } catch (error) {
        console.error("Query audit trails error:", error);
        res.status(500).json({ error: "เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธ”เธถเธเธเนเธญเธกเธนเธฅเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธฃเธ•เธฃเธงเธเธชเธญเธเธฃเธฐเธเธเนเธ”เน: " + error.message });
    }
});

// เธเนเธญเธเธเธฑเธเธเธนเนเนเธเนเธ—เธฑเนเธงเนเธเนเธเนเนเธเธซเธฃเธทเธญเธฅเธเธเธฃเธฐเธงเธฑเธ•เธด Audit Trail (Task 9 - Immutability & Tamper Protection)
app.all(["/api/documents/:id/audit-trail", "/api/audit-trails"], (req, res, next) => {
    if (["PUT", "PATCH", "DELETE", "POST"].includes(req.method)) {
        return res.status(405).json({
            error: "Method Not Allowed: เธเธฃเธฐเธงเธฑเธ•เธด Audit Trail เนเธ”เนเธฃเธฑเธเธเธฒเธฃเธเธธเนเธกเธเธฃเธญเธเธเธงเธฒเธกเธ–เธนเธเธ•เนเธญเธเนเธฅเธฐเนเธกเนเธชเธฒเธกเธฒเธฃเธ–เนเธเนเนเธเธซเธฃเธทเธญเธฅเธเนเธ”เน (Immutable & Append-Only Record)"
        });
    }
    next();
});

// Get document types
app.get("/api/document-types", async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT DISTINCT document_type
            FROM documents
            WHERE document_type IS NOT NULL
              AND document_type <> ''
            ORDER BY document_type
        `);

        const data = rows.map(row => row.document_type);

        res.json({
            data: data
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to fetch document types"
        });
    }
});

// GET receiving channels
app.get("/api/receiving-channels", (req, res) => {
    res.json({
        data: [
            "EMAIL",
            "PAPER"
        ]
    });
});

// Create S3 upload URL เธเธฃเนเธญเธกเธเธฑเธเธ—เธถเธ Metadata
// เธฃเธญเธเธฃเธฑเธเนเธเธฅเน: PDF, DOCX, JPG/JPEG, PNG, XLSX, PPTX
app.get("/api/documents/:id/upload-url", async (req, res) => {
    try {
        const { id } = req.params;
        const { fileName, contentType, fileSize } = req.query;

        if (!fileName) {
            return res.status(400).json({
                error: "fileName is required"
            });
        }

        // เธ•เธฃเธงเธเธชเธญเธเน€เธญเธเธชเธฒเธฃเธงเนเธฒเธกเธตเธญเธขเธนเนเธเธฃเธดเธเนเธซเธกเธเนเธญเธ
        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "Document not found" });
        }

        const access = checkDocumentAccess(req, docRows[0]);
        if (!access.allowed) {
            return res.status(403).json({ error: access.reason || "Permission Denied: เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธญเธฑเธเนเธซเธฅเธ”เนเธเธฅเน" });
        }

        // เธฃเธฒเธขเธเธฒเธฃเธเธฃเธฐเน€เธ เธ—เนเธเธฅเนเธ—เธตเนเธฃเธฐเธเธเธฃเธญเธเธฃเธฑเธ (Upload: PDF, DOCX, JPG/JPEG, PNG, XLSX, PPTX)
        const allowedTypes = {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            // backwards compatibility
            ".doc": "application/msword",
            ".xls": "application/vnd.ms-excel",
            ".ppt": "application/vnd.ms-powerpoint"
        };

        const extension = path.extname(fileName).toLowerCase();

        if (!allowedTypes[extension]) {
            return res.status(400).json({
                error: "Unsupported file type. Allowed: PDF, DOCX, JPG/JPEG, PNG, XLSX, PPTX"
            });
        }

        // เธเธฑเธ”เธเธฒเธฃ Content Type เนเธซเนเธ–เธนเธเธ•เนเธญเธ (เธซเธฒเธเน€เธเธฃเธฒเธงเนเน€เธเธญเธฃเนเธชเนเธ generic เธกเธฒ เนเธซเนเนเธเนเธเนเธฒเธ—เธตเนเธ–เธนเธเธ•เนเธญเธเธ•เธฒเธก extension)
        const expectedType = allowedTypes[extension];
        const finalContentType = (contentType && contentType !== "application/octet-stream" && contentType !== "application/x-zip-compressed")
            ? contentType
            : expectedType;

        // Prevent path traversal
        if (fileName.includes("/") || fileName.includes("\\")) {
            return res.status(400).json({
                error: "Invalid file name"
            });
        }

        // Remove control characters but keep Thai characters
        const safeFileName = fileName
            .replace(/[\u0000-\u001F\u007F]/g, "")
            .trim();

        if (!safeFileName) {
            return res.status(400).json({
                error: "Invalid file name"
            });
        }

        // Check document exists
        const [rows] = await pool.query(
            "SELECT * FROM documents WHERE id = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "Document not found"
            });
        }

        // Create unique file key
        const fileKey = `documents/${id}/${Date.now()}-${safeFileName}`;

        // Generate presigned upload URL
        const uploadUrl = await createUploadUrl(
            fileKey,
            finalContentType
        );

        // เธเธฑเธเธ—เธถเธ file_key เนเธ documents
        await pool.query(
            `
            UPDATE documents
            SET file_key = ?
            WHERE id = ?
            `,
            [fileKey, id]
        );

        // เธเธฑเธเธ—เธถเธเธซเธฃเธทเธญเธญเธฑเธเน€เธ”เธ• Metadata เนเธเธ•เธฒเธฃเธฒเธ document_files
        const [existingFiles] = await pool.query(
            "SELECT id FROM document_files WHERE document_id = ?",
            [id]
        );

        const parsedSize = fileSize ? Number(fileSize) : null;

        if (existingFiles.length > 0) {
            await pool.query(
                `
                UPDATE document_files
                SET file_name = ?, file_path = ?, file_size = ?, mime_type = ?, uploaded_at = CURRENT_TIMESTAMP
                WHERE document_id = ?
                `,
                [safeFileName, fileKey, parsedSize, finalContentType, id]
            );
        } else {
            await pool.query(
                `
                INSERT INTO document_files (document_id, file_name, file_path, file_size, mime_type, uploaded_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `,
                [id, safeFileName, fileKey, parsedSize, finalContentType]
            );
        }

        res.json({
            document_id: id,
            file_name: finalFileName,
            file_size: doc.file_size,
            mime_type: resolvedMime,
            download_url: downloadUrl
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to create upload URL"
        });
    }
});

// Endpoint เธชเธณเธซเธฃเธฑเธ Direct Upload เนเธเธฅเนเธเธถเนเธ S3 เธเนเธฒเธ Backend เนเธ”เธขเธ•เธฃเธ (Bypass Browser CORS 100%)
app.post("/api/documents/:id/upload-direct", express.raw({ type: "*/*", limit: "25mb" }), async (req, res) => {
    try {
        const { id } = req.params;
        const fileName = req.query.fileName || req.headers["x-filename"] || `file-${Date.now()}`;
        const contentType = req.query.contentType || req.headers["content-type"] || "application/octet-stream";

        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "Document not found" });
        }

        const safeFileName = decodeURIComponent(fileName).replace(/[\u0000-\u001F\u007F]/g, "").trim();
        const fileKey = `documents/${id}/${Date.now()}-${safeFileName}`;

        await uploadObjectBuffer(fileKey, req.body, contentType);

        await pool.query("UPDATE documents SET file_key = ? WHERE id = ?", [fileKey, id]);

        const [existingFiles] = await pool.query("SELECT id FROM document_files WHERE document_id = ?", [id]);
        if (existingFiles.length > 0) {
            await pool.query(
                "UPDATE document_files SET file_name = ?, file_path = ?, file_size = ?, mime_type = ?, uploaded_at = CURRENT_TIMESTAMP WHERE document_id = ?",
                [safeFileName, fileKey, req.body.length, contentType, id]
            );
        } else {
            await pool.query(
                "INSERT INTO document_files (document_id, file_name, file_path, file_size, mime_type, uploaded_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                [id, safeFileName, fileKey, req.body.length, contentType]
            );
        }

        res.json({
            ok: true,
            document_id: id,
            file_key: fileKey,
            file_name: safeFileName,
            file_size: req.body.length
        });
    } catch (error) {
        console.error("Direct upload error:", error);
        res.status(500).json({ error: error.message || "Failed to upload file to S3" });
    }
});

// Endpoint เธชเธณเธซเธฃเธฑเธเธเธฑเธเธ—เธถเธ/เธขเธทเธเธขเธฑเธ Metadata เนเธเธฅเนเธซเธฅเธฑเธเธเธฒเธฃ Upload เธชเธณเน€เธฃเนเธ
app.post("/api/documents/:id/file-metadata", requireCognitoAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { fileName, fileSize, mimeType, fileKey } = req.body;

        if (!fileName) {
            return res.status(400).json({ error: "fileName is required" });
        }

        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "Document not found" });
        }

        // [เน€เธเธดเนเธกเนเธซเธกเน] เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเนเธญเธเธขเธญเธกเนเธซเนเธเธฑเธเธ—เธถเธ Metadata เนเธเธฅเน
        const access = checkDocumentAccess(req, docRows[0]);
        if (!access.allowed) {
            return res.status(403).json({ error: access.reason || "Permission Denied" });
        }

        const safeFileName = fileName.replace(/[\u0000-\u001F\u007F]/g, "").trim();
        const finalMime = mimeType || getMimeTypeByExtension(safeFileName);
        const parsedSize = fileSize ? Number(fileSize) : null;

        // เธ”เธถเธ file_key เธเธฑเธเธเธธเธเธฑเธเธ–เนเธฒเนเธกเนเนเธ”เนเธชเนเธเธกเธฒ
        let finalKey = fileKey;
        if (!finalKey) {
            const [docRows] = await pool.query("SELECT file_key FROM documents WHERE id = ?", [id]);
            if (docRows.length > 0 && docRows[0].file_key) {
                finalKey = docRows[0].file_key;
            } else {
                finalKey = `documents/${id}/${Date.now()}-${safeFileName}`;
            }
        }

        // Update documents table
        await pool.query(
            "UPDATE documents SET file_key = ? WHERE id = ?",
            [finalKey, id]
        );

        // Update or Insert into document_files
        const [existing] = await pool.query("SELECT id FROM document_files WHERE document_id = ?", [id]);
        if (existing.length > 0) {
            await pool.query(
                `
                UPDATE document_files
                SET file_name = ?, file_path = ?, file_size = ?, mime_type = ?, uploaded_at = CURRENT_TIMESTAMP
                WHERE document_id = ?
                `,
                [safeFileName, finalKey, parsedSize, finalMime, id]
            );
        } else {
            await pool.query(
                `
                INSERT INTO document_files (document_id, file_name, file_path, file_size, mime_type, uploaded_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `,
                [id, safeFileName, finalKey, parsedSize, finalMime]
            );
        }

        res.json({
            ok: true,
            document_id: id,
            file_name: safeFileName,
            file_key: finalKey,
            file_size: parsedSize,
            mime_type: finalMime
        });

    } catch (error) {
        console.error("Save metadata error:", error);
        res.status(500).json({ error: "Failed to save file metadata" });
    }
});

// Create S3 preview URL เธเธฃเนเธญเธกเธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเน
// เน€เธเธเธฒเธฐ PDF, JPG/JPEG เนเธฅเธฐ PNG เธชเธฒเธกเธฒเธฃเธ–เนเธชเธ”เธเธ•เธฑเธงเธญเธขเนเธฒเธเนเธ”เน
// เธชเธณเธซเธฃเธฑเธ DOCX, XLSX, PPTX เธเธฐเธชเนเธ metadata เธเธฅเธฑเธเน€เธเธทเนเธญเนเธซเนเนเธชเธ”เธเธเธธเนเธกเธ”เธฒเธงเธเนเนเธซเธฅเธ”
app.get(
    "/api/documents/:id/preview-url",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
        try {
            const { id } = req.params;

            const [rows] = await pool.query(
                `
            SELECT 
                d.*,
                f.file_name,
                f.file_size,
                f.mime_type
            FROM documents d
            LEFT JOIN document_files f ON d.id = f.document_id
            WHERE d.id = ?
            `,
                [id]
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    error: "Document not found"
                });
            }

            const doc = rows[0];
            const fileKey = doc.file_key;

            if (!fileKey) {
                return res.status(404).json({
                    error: "Document file not found"
                });
            }

            // เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเธฒเธฃเน€เธเนเธฒเธ–เธถเธ
            const access = checkDocumentAccess(req, doc);
            if (!access.allowed) {
                return res.status(403).json({
                    error: access.reason || "เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเนเธเธเธฒเธฃเน€เธฃเธตเธขเธเธ”เธนเน€เธญเธเธชเธฒเธฃเธเธตเน (Permission Denied)"
                });
            }

            const finalFileName = doc.file_name || extractFileNameFromKey(fileKey);
            const ext = finalFileName ? path.extname(finalFileName).toLowerCase() : "";
            const canPreview = PREVIEWABLE_EXTENSIONS.includes(ext);
            const resolvedMime = doc.mime_type || getMimeTypeByExtension(finalFileName);

            let previewUrl = null;
            if (canPreview) {
                previewUrl = `/api/documents/${id}/preview-file`;
            }


            res.json({
                document_id: id,
                file_name: finalFileName,
                file_size: doc.file_size,
                mime_type: resolvedMime,
                file_extension: ext,
                can_preview: canPreview,
                preview_url: previewUrl,
                download_url: `/api/documents/${id}/download-file`
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                error: "Failed to generate preview URL"
            });
        }
    }
);

// Helper เธเธฑเธเธเนเธเธฑเธเธ”เธถเธ Buffer เธเธญเธเนเธเธฅเนเธเธฃเธดเธเธเธฒเธ S3 เนเธ”เธขเธ•เธฃเธ (เธฅเธ Fallback เธ—เธตเนเธเธณเธ เธฒเธเธซเธฃเธทเธญเนเธเธฅเนเธญเธทเนเธเธกเธฒเนเธชเธ”เธเนเธ—เธเธญเธญเธเธ—เธฑเนเธเธซเธกเธ”)
async function getDocumentFileBuffer(doc) {
    if (!doc.file_key) return null;
    const finalFileName = doc.file_name || extractFileNameFromKey(doc.file_key) || "document";

    try {
        const s3Data = await getObjectBuffer(doc.file_key);
        return {
            buffer: s3Data.buffer,
            mime: doc.mime_type || s3Data.contentType || getMimeTypeByExtension(finalFileName),
            fileName: finalFileName
        };
    } catch (error) {
        console.error(`S3 getObjectBuffer error for key "${doc.file_key}":`, error.name, error.message);
        return null;
    }
}

// Endpoint เธชเธ•เธฃเธตเธกเนเธเธฅเนเธชเธณเธซเธฃเธฑเธ Preview (Inline)
app.get("/api/documents/:id/view-file", requireCognitoAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.query(
            `
            SELECT 
                d.*,
                f.file_name,
                f.file_size,
                f.mime_type
            FROM documents d
            LEFT JOIN document_files f ON d.id = f.document_id
            WHERE d.id = ?
            `,
            [id]
        );

        if (rows.length === 0 || !rows[0].file_key) {
            return res.status(404).send("Document or file not found");
        }

        const doc = rows[0];
        const access = checkDocumentAccess(req, doc);
        if (!access.allowed) {
            return res.status(403).send("Permission Denied: เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเนเธเธเธฒเธฃเน€เธฃเธตเธขเธเธ”เธนเน€เธญเธเธชเธฒเธฃเธเธตเน");
        }

        const fileData = await getDocumentFileBuffer(doc);
        if (!fileData) {
            return res.status(404).send("File content not found");
        }

        const safeAsciiName = fileData.fileName.replace(/[^\x20-\x7E]/g, "_");
        const encodedName = encodeURIComponent(fileData.fileName);

        res.setHeader("Content-Type", fileData.mime);
        res.setHeader("Content-Disposition", `inline; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`);
        res.setHeader("Content-Length", fileData.buffer.length);
        res.send(fileData.buffer);

    } catch (error) {
        console.error("View file error:", error);
        res.status(500).send("Error previewing file");
    }
});

// Direct Download File (Stream file with attachment Content-Disposition)
// เธเนเธงเธขเนเธซเนเน€เธเธฃเธฒเธงเนเน€เธเธญเธฃเนเธ”เธฒเธงเธเนเนเธซเธฅเธ”เนเธเธฅเนเธฅเธเน€เธเธฃเธทเนเธญเธเธ—เธฑเธเธ—เธต เนเธฅเธฐเนเธกเนเธ•เธดเธ” Quarantine Policy เธเธญเธ AWS

app.get(
    "/api/documents/:id/download-file",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {

        try {
            const { id } = req.params;

            const [rows] = await pool.query(
                `
            SELECT 
                d.*,
                f.file_name,
                f.file_size,
                f.mime_type
            FROM documents d
            LEFT JOIN document_files f ON d.id = f.document_id
            WHERE d.id = ?
            `,
                [id]
            );

            if (rows.length === 0 || !rows[0].file_key) {
                return res.status(404).send("Document or file not found");
            }

            const doc = rows[0];
            const access = checkDocumentAccess(req, doc);
            if (!access.allowed) {
                return res.status(403).send("Permission Denied: เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเนเธเธเธฒเธฃเธ”เธฒเธงเธเนเนเธซเธฅเธ”เน€เธญเธเธชเธฒเธฃเธเธตเน");
            }

            const finalFileName = doc.file_name || extractFileNameFromKey(doc.file_key) || "document";
            const resolvedMime = doc.mime_type || getMimeTypeByExtension(finalFileName);
            const safeAsciiName = finalFileName.replace(/[^\x20-\x7E]/g, "_");
            const encodedName = encodeURIComponent(finalFileName);

            const s3DownloadUrl = await createDownloadUrl(doc.file_key, {
                disposition: "attachment",
                fileName: finalFileName,
                contentType: resolvedMime
            });

            const s3Response = await fetch(s3DownloadUrl);

            if (!s3Response.ok) {
                return res.status(s3Response.status).send("Failed to retrieve file from storage");
            }

            res.setHeader("Content-Type", resolvedMime);
            res.setHeader("Content-Disposition", `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`);
            if (doc.file_size) {
                res.setHeader("Content-Length", doc.file_size);
            }

            const arrayBuffer = await s3Response.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));

        } catch (error) {
            console.error("Direct download file error:", error);
            res.status(500).send("Error downloading file");
        }
    });

    app.get(
    "/api/documents/:id/preview-file",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
        try {
            const { id } = req.params;

            const [rows] = await pool.query(
                `SELECT d.*, f.file_name, f.file_size, f.mime_type
                 FROM documents d
                 LEFT JOIN document_files f ON d.id = f.document_id
                 WHERE d.id = ?`,
                [id]
            );

            if (rows.length === 0 || !rows[0].file_key) {
                return res.status(404).json({
                    error: "Document or file not found"
                });
            }

            const doc = rows[0];

            const access = checkDocumentAccess(req, doc);
            if (!access.allowed) {
                return res.status(403).json({
                    error: access.reason || "Permission denied"
                });
            }

            const fileName =
                doc.file_name ||
                extractFileNameFromKey(doc.file_key) ||
                "document";

            const ext = path.extname(fileName).toLowerCase();

            if (!PREVIEWABLE_EXTENSIONS.includes(ext)) {
                return res.status(415).json({
                    error: "This file type cannot be previewed"
                });
            }

            const file = await getS3Object(doc.file_key);
            const mimeType =
                doc.mime_type || getMimeTypeByExtension(fileName);

            res.setHeader("Content-Type", mimeType);
            res.setHeader(
                "Content-Disposition",
                `inline; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"`
            );
            res.setHeader("X-Content-Type-Options", "nosniff");

            if (file.ContentLength != null) {
                res.setHeader("Content-Length", file.ContentLength);
            }

            if (!file.Body) {
                return res.status(502).json({
                    error: "File content is unavailable"
                });
            }

            file.Body.on("error", (error) => {
                console.error("Preview stream error:", error);
                if (!res.headersSent) {
                    res.status(500).end("Failed to stream preview");
                } else {
                    res.destroy(error);
                }
            });

            file.Body.pipe(res);
        } catch (error) {
            console.error("Preview file error:", error.name, error.message);

            if (!res.headersSent) {
                if (error.name === "NoSuchKey" || error.Code === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
                    return res.status(404).json({
                        error: "เนเธกเนเธเธเนเธเธฅเนเธเธตเนเนเธเธฃเธฐเธเธเธเธฑเธ”เน€เธเนเธ S3 Storage (NoSuchKey)"
                    });
                }
                res.status(500).json({
                    error: "Failed to preview document"
                });
            } else {
                res.destroy(error);
            }
        }
    }
);

// Create S3 download URL เธเธฃเนเธญเธกเธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเน
app.get(
    "/api/documents/:id/download-url",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {

        try {
            const { id } = req.params;

            // Get document
            const [rows] = await pool.query(
                `
            SELECT 
                d.*,
                f.file_name,
                f.file_size,
                f.mime_type
            FROM documents d
            LEFT JOIN document_files f ON d.id = f.document_id
            WHERE d.id = ?
            `,
                [id]
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    error: "Document not found"
                });
            }

            const doc = rows[0];
            const fileKey = doc.file_key;

            // Check file exists in database
            if (!fileKey) {
                return res.status(404).json({
                    error: "Document file not found"
                });
            }

            // เธ•เธฃเธงเธเธชเธญเธเธชเธดเธ—เธเธดเนเธเธฒเธฃเน€เธเนเธฒเธ–เธถเธ
            const access = checkDocumentAccess(req, doc);
            if (!access.allowed) {
                return res.status(403).json({
                    error: access.reason || "เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเนเธเธเธฒเธฃเธ”เธฒเธงเธเนเนเธซเธฅเธ”เน€เธญเธเธชเธฒเธฃเธเธตเน (Permission Denied)"
                });
            }

            const finalFileName = doc.file_name || extractFileNameFromKey(fileKey);
            const resolvedMime = doc.mime_type || getMimeTypeByExtension(finalFileName);

            const downloadUrl = `/api/documents/${id}/download-file`;
            res.json({
                document_id: id,
                file_key: fileKey,
                file_name: finalFileName,
                file_size: doc.file_size,
                mime_type: resolvedMime,
                download_url: downloadUrl,
                direct_s3_url: getPublicUrl(fileKey),
                expires_in: 300
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                error: "Failed to create download URL"
            });
        }
    });

// เธ”เธฑเธเธเธฑเธเธเธฃเธ“เธตเธชเนเธ Request เน€เธเธดเธ 1MB
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: "Payload too large. Maximum size is 1MB." });
    }
    console.error("Server error:", err.message);
    res.status(500).json({ error: "Internal server error" });
});

// Start local server if run directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`DocuFlow Server is running on port ${PORT}`);
    });
}

module.exports = app;
