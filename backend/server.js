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
const fs = require("fs");

const sessionMiddleware = require("./session");
const authRouter = require("./auth");
const { requireCognitoAuth } = require("./cognito-auth");
const { ROLES: DOCUMENT_ROLES, canAccessDocument } = require("./documentAuthorization");

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
    if (!req.auth?.sub) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    try {
        const username = req.auth.username;
        if (!username) return res.status(403).json({ error: "No authorized role found for this user" });
        const [rows] = await pool.execute(
            `SELECT u.id AS userId, u.username, r.name AS role
             FROM users u JOIN users_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE (u.username = ? OR u.cognito_sub = ?) AND u.is_active = TRUE`, [username, req.auth.sub]
        );
        const roles = [...new Set(rows.map((row) => String(row.role || "").trim().toLowerCase()).filter((role) => DOCUMENT_ROLES.includes(role)))];
        if (rows.length === 0 || !roles.length || !rows[0].userId) {
            return res.status(403).json({
                error: "No authorized role found for this user"
            });
        }

        req.userId = rows[0].userId;
        req.dbUsername = rows[0].username;
        req.userRoles = roles;
        req.userRole = ["admin", "executive", "document_officer", "case_owner", "faculty_staff"].find((role) => roles.includes(role));

        return next();
    } catch (error) {
        console.error("Failed to verify user role:", error);

        return res.status(500).json({
            error: "Unable to verify user authorization"
        });
    }
}

const {
    createUploadUrl,
    createDownloadUrl,
    getS3Object,
    getObjectMetadata,
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

// Helper ฟังก์ชันป้องกัน XSS
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
}

// Helper ฟังก์ชันตรวจรูปแบบวันที่ YYYY-MM-DD
function isValidDate(dateString) {
    if (!dateString) return true;
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regEx)) return false;
    const d = new Date(dateString);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateString;
}

// Helper แยกชื่อไฟล์จาก fileKey ถ้าไม่มีในตาราง document_files
function extractFileNameFromKey(fileKey) {
    if (!fileKey) return null;
    const parts = fileKey.split("/");
    const lastPart = parts[parts.length - 1];
    const dashIdx = lastPart.indexOf("-");
    return dashIdx !== -1 ? lastPart.substring(dashIdx + 1) : lastPart;
}

// ตรวจสอบนามสกุลที่สามารถแสดงตัวอย่าง (Preview) ได้
const PREVIEWABLE_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

function isPreviewable(fileNameOrKey) {
    if (!fileNameOrKey) return false;
    const ext = path.extname(fileNameOrKey).toLowerCase();
    return PREVIEWABLE_EXTENSIONS.includes(ext);
}

// Helper ตรวจสอบสิทธิ์การเข้าถึง Preview และ Download ไฟล์
function checkDocumentAccess(req, document, action = "read") {
    const roles = req.userRoles || (req.userRole ? [req.userRole] : []);
    return { allowed: canAccessDocument({ roles, userId: req.userId, document, action }), role: req.userRole, userId: req.userId };
}


// Redirect root to html/index.html before static middleware catches it
app.get('/', (req, res) => {
    res.redirect('/html/index.html');
});

// เปลี่ยนจาก path.join(__dirname, '../') เป็น:
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

// ดึงรายการเอกสารพร้อม Metadata ของไฟล์
app.get(
    "/api/documents",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
        try {
            const userId = req.userId;
            const role = String(req.userRole || "").trim().toLowerCase();

            if (!userId || !DOCUMENT_ROLES.includes(role)) {
                return res.status(403).json({
                    error: "Invalid or unauthorized user role"
                });
            }

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
                assignee.username AS assignee_username,
                assignee.full_name AS assignee_full_name,
                f.file_name,
                f.file_size,
                f.mime_type,
                f.uploaded_at AS file_uploaded_at
            FROM documents d
            LEFT JOIN document_files f ON d.id = f.document_id
            LEFT JOIN users assignee ON assignee.id = d.assignee_id
            WHERE 1 = 1
        `;

            const params = [];

            // Admin, Executive, and Document Officer roles can view all documents and their files across the system.
            // Faculty staff and Case owner roles are scoped to documents they own or are assigned to.
            const userRoles = (req.userRoles || (role ? [role] : [])).map((r) => String(r || "").trim().toLowerCase());
            const canViewAll = userRoles.some((r) => ["admin", "executive", "document_officer"].includes(r));
            if (!canViewAll) {
                sql += " AND (d.owner_id = ? OR d.assignee_id = ?)";
                params.push(userId, userId);
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

            // Enrich ข้อมูลไฟล์สำหรับ frontend
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

// Get document by ID พร้อม Metadata ของไฟล์
app.get(
    "/api/documents/:id",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
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
        const access = checkDocumentAccess(req, doc, "read");
        if (!access.allowed) {
            return res.status(403).json({ error: access.reason || "Permission Denied" });
        }

        const finalFileName = doc.file_name || extractFileNameFromKey(doc.file_key);
        const ext = finalFileName ? path.extname(finalFileName).toLowerCase() : "";
        const canPreview = isPreviewable(finalFileName || doc.file_key);
        const resolvedMime = doc.mime_type || getMimeTypeByExtension(finalFileName || doc.file_key);

        let previewUrl = null;
        let downloadUrl = null;
        if (doc.file_key) {
            try {
                if (canPreview) {
                    previewUrl = await createDownloadUrl(doc.file_key, {
                        disposition: "inline",
                        fileName: finalFileName,
                        contentType: resolvedMime
                    });
                }
                downloadUrl = await createDownloadUrl(doc.file_key, {
                    disposition: "attachment",
                    fileName: finalFileName,
                    contentType: resolvedMime
                });
            } catch (err) {
                console.warn("createDownloadUrl error in GET /api/documents/:id:", err.message);
            }
        }

        res.json({
            ...doc,
            display_file_name: finalFileName,
            file_extension: ext,
            can_preview: canPreview,
            mime_type: resolvedMime,
            preview_url: previewUrl,
            download_url: downloadUrl
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to fetch document"
        });
    }
});

// Create document
app.post("/api/documents", requireCognitoAuth, loadUserRole, async (req, res) => {    try {
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
            assignee_id = null
        } = req.body;
        if (req.body.file_key != null) return res.status(400).json({ error: "file_key is assigned by the server during upload" });

        // 1. ตรวจสอบช่องทางรับเอกสาร
        const allowedChannels = ["EMAIL", "PAPER"];

        if (!allowedChannels.includes(receiving_channel)) {
            return res.status(400).json({
                error: "receiving_channel must be EMAIL or PAPER"
            });
        }

        // 2. ตรวจสอบฟิลด์จำเป็น (Required fields)
        if (!subject || !document_type || !sender_name) {
            return res.status(400).json({
                error: "subject, document_type and sender_name are required"
            });
        }

        // 2. ตรวจสอบความยาวตัวอักษร (Length Checks)
        if (subject.length > 255) return res.status(400).json({ error: "subject must not exceed 255 characters" });
        if (document_number && document_number.length > 100) return res.status(400).json({ error: "document_number must not exceed 100 characters" });
        if (sender_name.length > 200) return res.status(400).json({ error: "sender_name must not exceed 200 characters" });
        if (sender_department && sender_department.length > 200) return res.status(400).json({ error: "sender_department must not exceed 200 characters" });
        if (receiver_name && receiver_name.length > 200) return res.status(400).json({ error: "receiver_name must not exceed 200 characters" });

        // 3. ตรวจสอบรูปแบบวันที่ (YYYY-MM-DD)
        if (sent_date && !isValidDate(sent_date)) return res.status(400).json({ error: "sent_date must be in YYYY-MM-DD format" });
        if (receive_date && !isValidDate(receive_date)) return res.status(400).json({ error: "receive_date must be in YYYY-MM-DD format" });
        if (deadline && !isValidDate(deadline)) return res.status(400).json({ error: "deadline must be in YYYY-MM-DD format" });

        // 4. ล้างข้อมูลป้องกัน XSS (Sanitize HTML tags)
        const sanitizedSubject = sanitizeInput(subject);
        const sanitizedSenderName = sanitizeInput(sender_name);
        const sanitizedSenderDepartment = sanitizeInput(sender_department);
        const sanitizedReceiverName = sanitizeInput(receiver_name);
        const sanitizedRemarks = sanitizeInput(remarks);

        // ตรวจสอบ Status ตาม Workflow V3
        const allowedStatuses = ["Received", "Assigned", "Processing", "Completed"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                error: "status must be one of: Received, Assigned, Processing, Completed"
            });
        }

        // 5. กำหนดและแปลงผู้รับผิดชอบเอกสาร (Assignee)
        let resolvedAssigneeId = (assignee_id && !isNaN(Number(assignee_id))) ? Number(assignee_id) : null;

        // หากยังไม่ได้ระบุ assignee_id ให้ค้นหาจาก receiver_name อัตโนมัติ
        if (!resolvedAssigneeId && sanitizedReceiverName) {
            const lowerRec = sanitizedReceiverName.toLowerCase();
            try {
                if (lowerRec.includes("fac-a") || lowerRec.includes("วรินทร์")) {
                    const [uRows] = await pool.query("SELECT id FROM users WHERE username = 'FAC-A' LIMIT 1");
                    if (uRows.length > 0) resolvedAssigneeId = uRows[0].id;
                } else if (lowerRec.includes("fac-b") || lowerRec.includes("ณัฐวุฒิ")) {
                    const [uRows] = await pool.query("SELECT id FROM users WHERE username = 'FAC-B' LIMIT 1");
                    if (uRows.length > 0) resolvedAssigneeId = uRows[0].id;
                } else if (lowerRec.includes("head-1") || lowerRec.includes("ปกรณ์") || lowerRec.includes("หัวหน้าสาขา")) {
                    const [uRows] = await pool.query("SELECT id FROM users WHERE username = 'HEAD-1' LIMIT 1");
                    if (uRows.length > 0) resolvedAssigneeId = uRows[0].id;
                } else if (lowerRec.includes("staff-1") || lowerRec.includes("ธารินี")) {
                    const [uRows] = await pool.query("SELECT id FROM users WHERE username = 'STAFF-1' LIMIT 1");
                    if (uRows.length > 0) resolvedAssigneeId = uRows[0].id;
                } else if (lowerRec.includes("อาจารย์") || lowerRec.includes("faculty") || lowerRec.includes("staff")) {
                    const [uRows] = await pool.query("SELECT id FROM users WHERE role = 'faculty_staff' ORDER BY id ASC LIMIT 1");
                    if (uRows.length > 0) resolvedAssigneeId = uRows[0].id;
                }
            } catch (errResolve) {
                console.warn("Auto-resolve assignee from receiver_name failed:", errResolve.message);
            }
        }

        // เมื่อ Admin หรือ Document Officer เป็นผู้เพิ่มเอกสาร และยังไม่มีผู้รับมอบหมาย
        // ให้กำหนดผู้รับมอบหมายไปยัง role อาจารย์ (faculty_staff เช่น FAC-A หรือ staff) โดยอัตโนมัติ
        // เพื่อให้เอกสารไปปรากฏบนหน้า Dashboard ของ role อาจารย์ทันที
        if (!resolvedAssigneeId && ["admin", "document_officer"].includes(req.userRole)) {
            try {
                const [facRows] = await pool.query("SELECT id FROM users WHERE role = 'faculty_staff' ORDER BY id ASC LIMIT 1");
                if (facRows.length > 0) {
                    resolvedAssigneeId = facRows[0].id;
                }
            } catch (errFac) {
                console.warn("Fallback faculty_staff assignment failed:", errFac.message);
            }
        }

        // Logic สร้าง reference_no
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
                    receiving_channel, status, file_key, owner_id, assignee_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    null,
                    req.userId,
                    resolvedAssigneeId
                ]
            );

            const newDocId = result.insertId;

            // หากมีการกำหนดผู้รับผิดชอบ (อาจารย์) ให้บันทึกประวัติการมอบหมายใน document_assignments
            if (resolvedAssigneeId) {
                await connection.query(
                    `INSERT INTO document_assignments
                        (document_id, assigned_by_user_id, assigned_by_username, previous_assignee_id, new_assignee_id, action_type, remarks)
                     VALUES (?, ?, ?, NULL, ?, 'ASSIGN', ?)`,
                    [
                        newDocId,
                        String(req.userId),
                        actor.actorUsername,
                        String(resolvedAssigneeId),
                        sanitizedRemarks || "มอบหมายให้อาจารย์เมื่อลงทะเบียนเอกสาร"
                    ]
                );
            }

            // บันทึก Audit Trail สำหรับการสร้างเอกสารใหม่ (Task 4, 5, 6, 7)
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
                    status: status,
                    assignee_id: resolvedAssigneeId
                },
                details: {
                    remarks: sanitizedRemarks || null,
                    assigned_to_user_id: resolvedAssigneeId
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
    Received: "ได้รับเอกสารแล้ว",
    Assigned: "มอบหมายแล้ว",
    Processing: "กำลังดำเนินการ",
    Completed: "ดำเนินการเสร็จสิ้นแล้ว"
};

const V3_WORKFLOW_TRANSITIONS = {
    Received: ["Assigned"],
    Assigned: ["Processing"],
    Processing: ["Completed"],
    Completed: [] // Terminal state
};

// GET /api/workflow/config - เรียกดูการตั้งค่า Workflow สถานะเอกสาร V3
app.get("/api/workflow/config", (req, res) => {
    res.json({
        version: "V3",
        statuses: [
            { key: "Received", label: "ได้รับเอกสารแล้ว", step: 1, color: "teal", description: "ได้รับเอกสารเข้าสู่ระบบเรียบร้อยแล้ว" },
            { key: "Assigned", label: "มอบหมายแล้ว", step: 2, color: "orange", description: "มอบหมายเอกสารให้ผู้รับผิดชอบดำเนินการ" },
            { key: "Processing", label: "กำลังดำเนินการ", step: 3, color: "blue", description: "ผู้รับผิดชอบกำลังดำเนินการกับเอกสาร" },
            { key: "Completed", label: "ดำเนินการเสร็จสิ้นแล้ว", step: 4, color: "green", description: "ดำเนินการตามเอกสารเสร็จสิ้นสมบูรณ์แล้ว" }
        ],
        transitions: V3_WORKFLOW_TRANSITIONS,
        permissions: {
            staff: { can_change_status: true, rule: "เปลี่ยนสถานะตามลำดับ Workflow ทีละขั้นตอน" },
            admin: { can_change_status: true, rule: "เปลี่ยนสถานะตาม Workflow หรือปรับปรุงแก้ไขตามความเหมาะสม" },
            guest: { can_change_status: false, rule: "ไม่มีสิทธิ์เปลี่ยนสถานะเอกสาร (Read-only)" }
        }
    });
});

// GET /api/documents/:id/status-history - ดึงประวัติการเปลี่ยนสถานะของเอกสาร (Audit Log)
app.get(
    "/api/documents/:id/status-history",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
            try {
        const { id } = req.params;

        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "ไม่พบข้อมูลเอกสารในระบบ" });
        }
        if (!checkDocumentAccess(req, docRows[0], "read").allowed) return res.status(403).json({ error: "Forbidden" });

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
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลประวัติการเปลี่ยนสถานะเอกสารได้" });
    }
});

// PUT /api/documents/:id/status - เปลี่ยนสถานะเอกสารตาม Workflow V3 พร้อมตรวจสอบสิทธิ์และเงื่อนไข (เชื่อมต่อ Audit Trail)
app.put("/api/documents/:id/status", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const { id } = req.params;
        const { status: newStatus, remarks } = req.body;

        // 1. ดึงข้อมูลตัวตนและสิทธิ์จาก Server Authentication เท่านั้น (Task 5)
        const actor = extractServerActor(req);
        const userId = actor.actorUserId;
        const username = actor.actorUsername;
        const role = actor.actorRole;
        const sanitizedRemarks = sanitizeInput(remarks || "");

        // 2. ตรวจสอบสิทธิ์ผู้ใช้: เฉพาะ staff, faculty_staff, document_officer, case_owner และ admin
        if (!role || !["document_officer", "case_owner", "admin", "faculty_staff"].includes(role)) {
            return res.status(403).json({
                error: "คุณไม่มีสิทธิ์ในการเปลี่ยนสถานะเอกสาร (ต้องการสิทธิ์ Staff หรือ Admin เท่านั้น)"
            });
        }

        // 3. ตรวจสอบค่าสถานะใหม่ที่ส่งมา
        if (!newStatus) {
            return res.status(400).json({
                error: "กรุณาระบุสถานะใหม่ที่ต้องการเปลี่ยน (status is required)"
            });
        }

        if (!V3_STATUSES.includes(newStatus)) {
            return res.status(400).json({
                error: `สถานะ "${newStatus}" ไม่ถูกต้อง สถานะที่อนุญาตใน V3 ได้แก่: ${V3_STATUSES.join(", ")}`
            });
        }

        // 4. ตรวจสอบว่าเอกสารมีอยู่จริงในระบบหรือไม่
        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({
                error: "ไม่พบเอกสารที่ระบุในระบบ (Document not found)"
            });
        }

        const doc = docRows[0];
        if (!checkDocumentAccess(req, doc, "status").allowed) return res.status(403).json({ error: "Forbidden" });
        const oldStatus = doc.status || "Received";

        // 5. ป้องกันการเปลี่ยนเป็นสถานะเดิม
        if (oldStatus === newStatus) {
            const label = V3_STATUS_LABELS[oldStatus] || oldStatus;
            return res.status(400).json({
                error: `เอกสารอยู่ในสถานะ "${label}" (${oldStatus}) อยู่แล้ว ไม่สามารถเปลี่ยนเป็นสถานะเดิมได้`
            });
        }

        // 6. ตรวจสอบเงื่อนไขการเปลี่ยนสถานะตาม Workflow
        const isAdmin = role === "admin";
        const allowedNextStatuses = V3_WORKFLOW_TRANSITIONS[oldStatus] || [];
        const isStandardWorkflowStep = allowedNextStatuses.includes(newStatus);

        if (!isAdmin && !isStandardWorkflowStep) {
            if (oldStatus === "Completed") {
                return res.status(400).json({
                    error: `เอกสารนี้อยู่ในสถานะ "ดำเนินการเสร็จสิ้นแล้ว" (Completed) ซึ่งเป็นสถานะสิ้นสุดของ Workflow ไม่สามารถเปลี่ยนสถานะต่อไปได้อีก`
                });
            }

            const allowedLabels = allowedNextStatuses.map(s => `"${V3_STATUS_LABELS[s] || s}" (${s})`).join(", ") || "ไม่มี";
            return res.status(400).json({
                error: `ไม่สามารถเปลี่ยนสถานะจาก "${V3_STATUS_LABELS[oldStatus] || oldStatus}" ไปเป็น "${V3_STATUS_LABELS[newStatus] || newStatus}" ได้ ตามเงื่อนไข Workflow V3 (สถานะถัดไปที่อนุญาตคือ: ${allowedLabels})`
            });
        }

        // 7. ใช้ Database Transaction เพื่อป้องกันข้อมูลเอกสารและประวัติไม่สอดคล้องกัน (Task 7)
        const connection = await pool.getConnection();
        let auditRecord = null;
        try {
            await connection.beginTransaction();

            const [updateResult] = await connection.query(
                `UPDATE documents SET status = ? WHERE id = ?`,
                [newStatus, id]
            );

            if (updateResult.affectedRows === 0) {
                throw new Error("เกิดข้อผิดพลาดในการอัปเดตสถานะเอกสารในฐานข้อมูล");
            }

            // บันทึก document_status_logs สำหรับความเข้ากันได้ย้อนหลังกับ V3
            await connection.query(
                `INSERT INTO document_status_logs (document_id, old_status, new_status, changed_by, changed_by_user_id, remarks, changed_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [id, oldStatus, newStatus, username, userId, sanitizedRemarks || null]
            );

            // บันทึก Audit Trail ส่วนกลาง (Task 3, 4, 6)
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

        // 8. ดึงข้อมูลเอกสารและประวัติล่าสุดส่งกลับไปให้ Frontend
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
            message: `เปลี่ยนสถานะเอกสารเป็น "${V3_STATUS_LABELS[newStatus] || newStatus}" สำเร็จเรียบร้อย`,
            data: updatedRows[0],
            status_log: historyRows[0] || null,
            audit: auditRecord
        });

    } catch (error) {
        console.error("Update document status error:", error);
        res.status(500).json({ error: "Unable to update document status" });
    }
});

// กติกาการมอบหมายเอกสาร (ปรับตาม Role Matrix)
const ASSIGNER_ROLES = ["document_officer", "faculty_staff", "case_owner", "admin"]; // ตาม Role Matrix
const ASSIGNEE_ROLES = ["case_owner", "faculty_staff"];   // รับมอบหมายได้

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// POST /api/documents/:id/assign - มอบหมายเอกสารให้ผู้รับผิดชอบ
app.post("/api/documents/:id/assign", requireCognitoAuth, loadUserRole, async (req, res) => {
    // ตัวตนและ role มาจาก token + ฐานข้อมูล (loadUserRole) เท่านั้น ไม่เชื่อค่าจาก Frontend
    const actorId = req.userId;
    const actorRole = req.userRole;
    const actorUsername = req.auth.username || String(req.auth.sub);

    if (!ASSIGNER_ROLES.includes(actorRole)) {
        return res.status(403).json({ error: "คุณไม่มีสิทธิ์มอบหมายเอกสาร" });
    }

    const documentId = Number(req.params.id);
    const assigneeId = Number(req.body?.assignee_id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return res.status(400).json({ error: "รหัสเอกสารไม่ถูกต้อง" });
    }
    if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
        return res.status(400).json({ error: "กรุณาเลือกผู้รับมอบหมาย" });
    }
    const remarks = sanitizeInput(req.body?.remarks || "");

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // ล็อกแถวเอกสาร กันสองคนมอบหมายพร้อมกัน
        const [docRows] = await connection.query(
            "SELECT * FROM documents WHERE id = ? FOR UPDATE", [documentId]
        );
        if (docRows.length === 0) throw new HttpError(404, "ไม่พบเอกสารที่ระบุในระบบ");

        const doc = docRows[0];
        if (!checkDocumentAccess(req, doc, "assign").allowed) {
            throw new HttpError(403, "คุณไม่มีสิทธิ์มอบหมายเอกสารนี้");
        }
        const oldStatus = doc.status || "Received";
        if (oldStatus === "Completed") {
            throw new HttpError(409, "เอกสารดำเนินการเสร็จสิ้นแล้ว ไม่สามารถมอบหมายได้");
        }
        if (doc.assignee_id != null && Number(doc.assignee_id) === assigneeId) {
            throw new HttpError(409, "เอกสารนี้มอบหมายให้ผู้รับคนนี้อยู่แล้ว");
        }

        // ตรวจผู้รับ: มีอยู่จริง + ใช้งานได้ + บทบาทเหมาะสม
        const [aRows] = await connection.query(
            `SELECT u.id, u.username, u.full_name, u.is_active, r.name AS role
             FROM users u
             JOIN users_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
             WHERE u.id = ? LIMIT 1`,
            [assigneeId]
        );
        if (aRows.length === 0) {
            throw new HttpError(404, "ไม่พบผู้รับมอบหมาย หรือผู้รับยังไม่มีบทบาทในระบบ");
        }
        const assignee = aRows[0];
        if (!assignee.is_active) {
            throw new HttpError(422, "บัญชีผู้รับมอบหมายถูกปิดใช้งาน");
        }
        if (!ASSIGNEE_ROLES.includes(String(assignee.role).trim().toLowerCase())) {
            throw new HttpError(422, "ผู้รับมอบหมายมีบทบาทไม่เหมาะสมกับการรับผิดชอบเอกสาร");
        }

        const newStatus = oldStatus === "Received" ? "Assigned" : oldStatus;

        // ไม่แตะ owner_id เพื่อไม่ให้ผู้รับได้สิทธิ์เกินกว่าที่กำหนด
        await connection.query(
            "UPDATE documents SET assignee_id = ?, status = ? WHERE id = ?",
            [assigneeId, newStatus, documentId]
        );

        await connection.query(
            `INSERT INTO document_assignments
                (document_id, assigned_by_user_id, assigned_by_username, previous_assignee_id, new_assignee_id, action_type, remarks)
             VALUES (?, ?, ?, ?, ?, 'ASSIGN', ?)`,
            [
                documentId,
                String(actorId),
                actorUsername,
                doc.assignee_id != null ? String(doc.assignee_id) : null,
                String(assigneeId),
                remarks || null
            ]
        );

        if (newStatus !== oldStatus) {
            await connection.query(
                `INSERT INTO document_status_logs (document_id, old_status, new_status, changed_by, changed_by_user_id, remarks, changed_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [documentId, oldStatus, newStatus, actorUsername, String(actorId), remarks || "มอบหมายเอกสาร"]
            );
        }

        const auditRecord = await recordAuditEvent({
            documentId,
            actorUserId: String(req.auth.sub),
            actorUsername,
            actorRole,
            eventType: AUDIT_EVENTS.ASSIGN,
            beforeState: { assignee_id: doc.assignee_id, status: oldStatus },
            afterState: { assignee_id: assigneeId, status: newStatus },
            details: {
                assignee_name: assignee.username,   // ชื่อจากฐานข้อมูล ไม่ใช่ที่ Frontend ส่งมา
                previous_assignee_id: doc.assignee_id || null,
                new_assignee_id: assigneeId,
                remarks: remarks || null
            },
            ipAddress: req.ip,
            connection
        });

        await connection.commit();

        const [rows] = await pool.query(
            `SELECT d.*, u.username AS assignee_username, u.full_name AS assignee_full_name
             FROM documents d
             LEFT JOIN users u ON u.id = d.assignee_id
             WHERE d.id = ?`,
            [documentId]
        );
        res.json({
            ok: true,
            message: `มอบหมายเอกสารให้ ${assignee.full_name || assignee.username} เรียบร้อยแล้ว`,
            data: rows[0],
            audit: auditRecord
        });
    } catch (error) {
        try { await connection.rollback(); } catch (rollbackError) {
            console.error("Assign rollback failed:", rollbackError);
        }
        if (error instanceof HttpError) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error("Assign document error:", error);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการมอบหมายเอกสาร" });
    } finally {
        connection.release();
    }
});

// GET /api/assignees - รายชื่อผู้ที่รับมอบหมายได้ (สำหรับ dropdown) เฉพาะผู้มีสิทธิ์มอบหมาย
app.get("/api/assignees", requireCognitoAuth, loadUserRole, async (req, res) => {
    if (!ASSIGNER_ROLES.includes(req.userRole)) {
        return res.status(403).json({ error: "คุณไม่มีสิทธิ์ดูรายชื่อผู้รับมอบหมาย" });
    }

    try {
        const [rows] = await pool.query(
            `SELECT u.id, u.username, u.full_name, r.name AS role
             FROM users u
             JOIN users_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
             WHERE u.is_active = 1 AND r.name COLLATE utf8mb4_general_ci IN (?)
             ORDER BY u.username`,
            [ASSIGNEE_ROLES]
        );
        res.json({ data: rows, total: rows.length });
    } catch (error) {
        console.error("Fetch assignees error:", error);
        res.status(500).json({ error: "ไม่สามารถดึงรายชื่อผู้รับมอบหมายได้" });
    }
});

// GET /api/forward-recipients - รายชื่อผู้ใช้ที่รับเอกสารส่งต่อได้
app.get(
    "/api/forward-recipients",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
        const forwarderRoles = [
            "document_officer",
            "case_owner",
            "admin",
            "faculty_staff"
        ];

        if (!forwarderRoles.includes(req.userRole)) {
            return res.status(403).json({
                error: "คุณไม่มีสิทธิ์ดูรายชื่อผู้รับส่งต่อ"
            });
        }

        try {
            const [rows] = await pool.query(
                `SELECT DISTINCT u.id, u.username, u.full_name
                 FROM users u
                 JOIN users_roles ur ON ur.user_id = u.id
                 JOIN roles r ON r.id = ur.role_id
                 WHERE u.is_active = 1
                   AND r.name COLLATE utf8mb4_general_ci IN (?)
                 ORDER BY u.username`,
                [ASSIGNEE_ROLES]
            );

            return res.json({ data: rows, total: rows.length });
        } catch (error) {
            console.error("Fetch forwarding recipients error:", error);
            return res.status(500).json({
                error: "ไม่สามารถดึงรายชื่อผู้รับส่งต่อได้"
            });
        }
    }
);

// GET /api/my-assignments - เอกสารที่ได้รับมอบหมายให้ "ฉัน" (ดูได้เฉพาะของตัวเอง)
app.get("/api/my-assignments", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, reference_no, subject, document_type, status, deadline, receive_date, created_at
             FROM documents
             WHERE assignee_id = ?
             ORDER BY created_at DESC`,
            [req.userId]
        );
        res.json({ data: rows, total: rows.length });
    } catch (error) {
        console.error("Fetch my assignments error:", error);
        res.status(500).json({ error: "ไม่สามารถดึงรายการเอกสารที่ได้รับมอบหมายได้" });
    }
});

// GET /api/documents/:id/assignments - ประวัติการมอบหมายของเอกสาร
app.get("/api/documents/:id/assignments", requireCognitoAuth, loadUserRole, async (req, res) => {
    const documentId = Number(req.params.id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
        return res.status(400).json({ error: "รหัสเอกสารไม่ถูกต้อง" });
    }

    try {
        const [docRows] = await pool.query(
            "SELECT * FROM documents WHERE id = ?",
            [documentId]
        );
        if (docRows.length === 0) {
            return res.status(404).json({ error: "ไม่พบเอกสารที่ระบุในระบบ" });
        }

        const doc = docRows[0];
        const canViewDocument = checkDocumentAccess(req, doc, "read").allowed;
        if (!canViewDocument) {
            return res.status(403).json({ error: "คุณไม่มีสิทธิ์ดูประวัติการมอบหมายของเอกสารนี้" });
        }

        const [rows] = await pool.query(
            `SELECT a.id, a.assigned_by_user_id, a.assigned_by_username,
                    a.previous_assignee_id, a.new_assignee_id, a.action_type, a.remarks, a.assigned_at,
                    pu.username AS previous_assignee_name,
                    nu.username AS new_assignee_name
             FROM document_assignments a
             LEFT JOIN users pu ON pu.id = CAST(a.previous_assignee_id AS UNSIGNED)
             LEFT JOIN users nu ON nu.id = CAST(a.new_assignee_id AS UNSIGNED)
             WHERE a.document_id = ?
             ORDER BY a.assigned_at ASC, a.id ASC`,
            [documentId]
        );

        res.json({
            ok: true,
            document_id: documentId,
            reference_no: doc.reference_no,
            current_assignee_id: doc.assignee_id,
            history: rows
        });
    } catch (error) {
        console.error("Fetch assignment history error:", error);
        res.status(500).json({ error: "ไม่สามารถดึงประวัติการมอบหมายได้" });
    }
});

// POST /api/documents/:id/forward - ส่งต่อเอกสาร (Task 1, 4, 5, 6, 7)
app.post("/api/documents/:id/forward", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const { id } = req.params;
        const { new_assignee_id, new_assignee_name, receiver_name, remarks, reason } = req.body || {};

        const actor = extractServerActor(req);
        const role = actor.actorRole;

        // ตรวจสอบสิทธิ์ผู้มีอำนาจส่งต่อ
        if (!role || !["document_officer", "case_owner", "admin", "faculty_staff"].includes(role)) {
            return res.status(403).json({
                error: "คุณไม่มีสิทธิ์ในการส่งต่อเอกสาร (ต้องการสิทธิ์ Staff หรือ Admin)"
            });
        }

        if (!new_assignee_id && !receiver_name) {
            return res.status(400).json({
                error: "กรุณาระบุผู้รับส่งต่อ (new_assignee_id หรือ receiver_name is required)"
            });
        }

        const sanitizedNewAssigneeId = new_assignee_id ? String(new_assignee_id).trim() : null;
        const sanitizedAssigneeName = sanitizeInput(new_assignee_name || "");
        const sanitizedReceiverName = sanitizeInput(receiver_name || "");
        if (
            sanitizedNewAssigneeId &&
            !/^[1-9]\d*$/.test(sanitizedNewAssigneeId)
        ) {
            return res.status(400).json({
                error: "รหัสผู้รับส่งต่อไม่ถูกต้อง"
            });
        }

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
                return res.status(404).json({ error: "ไม่พบเอกสารที่ระบุในระบบ" });
            }

            const doc = docRows[0];
            if (!checkDocumentAccess(req, doc, "forward").allowed) {
                await connection.rollback();
                return res.status(403).json({ error: "Forbidden" });
            }
            if (
                sanitizedNewAssigneeId &&
                doc.assignee_id != null &&
                String(doc.assignee_id) === sanitizedNewAssigneeId
            ) {
                await connection.rollback();
                return res.status(409).json({
                    error: "เอกสารนี้ส่งต่อให้ผู้รับคนนี้อยู่แล้ว"
                });
            }

            const forwardableStatuses = ["Received", "Assigned", "Processing"];
            const currentStatus = String(doc.status || "Received");

            if (!forwardableStatuses.includes(currentStatus)) {
                await connection.rollback();
                    return res.status(409).json({
                    error: `ไม่สามารถส่งต่อเอกสารในสถานะ ${currentStatus} ได้`
                });
            }

            if (sanitizedNewAssigneeId) {
                const [targetRows] = await connection.query(
                    `SELECT u.id FROM users u JOIN users_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
                     WHERE u.id=? AND u.is_active=1 AND r.name COLLATE utf8mb4_general_ci IN (?)`, [sanitizedNewAssigneeId, ASSIGNEE_ROLES]
                );
                if (!targetRows.length) { await connection.rollback(); return res.status(400).json({ error: "Invalid assignee" }); }
            }

            // อัปเดตเอกสาร
            await connection.query(
                `UPDATE documents 
                 SET assignee_id = COALESCE(?, assignee_id),
                     receiver_name = COALESCE(?, receiver_name)
                 WHERE id = ?`,
                [sanitizedNewAssigneeId, sanitizedReceiverName || null, id]
            );

            // บันทึกลงตาราง document_assignments
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

            // บันทึก Audit Trail ส่วนกลาง (Task 2, 3, 4, 6)
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
            message: `ส่งต่อเอกสารเรียบร้อยแล้ว`,
            data: updatedDoc,
            audit: auditRecord
        });

    } catch (error) {
        console.error("Forward document error:", error);
        res.status(500).json({ error: "Unable to forward document" });
    }
});

// GET /api/documents/:id/audit-trail - ตรวจสอบประวัติ Audit Trail ของเอกสารตาม Role/Permission Matrix (Task 8)
app.get("/api/documents/:id/audit-trail", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const { id } = req.params;
        const actor = extractServerActor(req);

        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "ไม่พบเอกสารที่ระบุในระบบ" });
        }

        const doc = docRows[0];

        // ตรวจสอบสิทธิ์การเข้าถึงประวัติตาม Role/Permission Matrix (Task 8)
        const access = verifyAuditTrailAccess(
            { userId: actor.actorUserId, role: actor.actorRole },
            doc
        );

        if (!access.allowed) {
            return res.status(403).json({
                error: access.reason || "คุณไม่มีสิทธิ์เข้าถึงประวัติ Audit Trail ของเอกสารนี้"
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
        res.status(500).json({ error: "Unable to fetch audit trail" });
    }
});

// GET /api/audit-trails - เรียกดู Audit Trail รวมทั้งระบบ สำหรับผู้ดูแลระบบ (Admin) หรือ ผู้บริหาร (Executive) (Task 8)
app.get("/api/audit-trails", requireCognitoAuth, loadUserRole, async (req, res) => {
    try {
        const actor = extractServerActor(req);
        const role = String(actor.actorRole || "").toLowerCase();

        // จำกัดเฉพาะ Admin และ Executive
        if (!["admin", "executive"].includes(role)) {
            return res.status(403).json({
                error: "คุณไม่มีสิทธิ์เข้าถึงประวัติการตรวจสอบทั้งระบบ (ต้องการสิทธิ์ Admin หรือ Executive เท่านั้น)"
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
        res.status(500).json({ error: "Unable to query audit trails" });
    }
});

// ป้องกันผู้ใช้ทั่วไปแก้ไขหรือลบประวัติ Audit Trail (Task 9 - Immutability & Tamper Protection)
app.all(["/api/documents/:id/audit-trail", "/api/audit-trails"], (req, res, next) => {
    if (["PUT", "PATCH", "DELETE", "POST"].includes(req.method)) {
        return res.status(405).json({
            error: "Method Not Allowed: ประวัติ Audit Trail ได้รับการคุ้มครองความถูกต้องและไม่สามารถแก้ไขหรือลบได้ (Immutable & Append-Only Record)"
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

// รองรับไฟล์: PDF, DOCX, JPG/JPEG, PNG, XLSX, PPTX
//เพิ่มตรวจ role ของผู้ใช้ก่อนอนุญาตให้สร้าง upload URL
app.get(
    "/api/documents/:id/upload-url",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
   try {
        const { id } = req.params;
        const { fileName, contentType, fileSize } = req.query;

        if (!fileName) {
            return res.status(400).json({
                error: "fileName is required"
            });
        }

        // ตรวจสอบเอกสารว่ามีอยู่จริงไหมก่อน
        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "Document not found" });
        }

        const access = checkDocumentAccess(req, docRows[0], "upload");
        if (!access.allowed) {
            return res.status(403).json({ error: access.reason || "Permission Denied: ไม่มีสิทธิ์อัปโหลดไฟล์" });
        }

        // รายการประเภทไฟล์ที่ระบบรองรับ (Upload: PDF, DOCX, JPG/JPEG, PNG, XLSX, PPTX)
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
        const requestedSize = Number(fileSize);
        if (!Number.isInteger(requestedSize) || requestedSize <= 0 || requestedSize > 10 * 1024 * 1024) {
            return res.status(400).json({ error: "File size must be between 1 byte and 10 MB" });
        }

        if (!allowedTypes[extension]) {
            return res.status(400).json({
                error: "Unsupported file type. Allowed: PDF, DOCX, JPG/JPEG, PNG, XLSX, PPTX"
            });
        }

        // จัดการ Content Type ให้ถูกต้อง (หากเบราว์เซอร์ส่ง generic มา ให้ใช้ค่าที่ถูกต้องตาม extension)
        const expectedType = allowedTypes[extension];
        if (contentType && !["application/octet-stream", "application/x-zip-compressed", expectedType].includes(contentType)) {
            return res.status(400).json({ error: "File MIME type does not match its extension" });
        }
        const finalContentType = expectedType;

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

        // บันทึก file_key ใน documents
        await pool.query(
            `
            UPDATE documents
            SET file_key = ?
            WHERE id = ?
            `,
            [fileKey, id]
        );

        // บันทึกหรืออัปเดต Metadata ในตาราง document_files
        const [existingFiles] = await pool.query(
            "SELECT id FROM document_files WHERE document_id = ?",
            [id]
        );

        const parsedSize = requestedSize;

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
            file_name: safeFileName,
            file_size: parsedSize,
            mime_type: finalContentType,
            upload_url: uploadUrl,
            file_key: fileKey
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to create upload URL"
        });
    }
});

// Endpoint สำหรับ Direct Upload ไฟล์ขึ้น S3 ผ่าน Backend โดยตรง (Bypass Browser CORS 100%)

app.post(
    "/api/documents/:id/upload-direct",
    requireCognitoAuth,
    loadUserRole,
    express.raw({ type: "*/*", limit: "10mb" }),
    async (req, res) => {

        try {
        const { id } = req.params;
        const fileName = req.query.fileName || req.headers["x-filename"] || `file-${Date.now()}`;
        const contentType = req.query.contentType || req.headers["content-type"] || "application/octet-stream";

        const [docRows] = await pool.query("SELECT * FROM documents WHERE id = ?", [id]);
        if (docRows.length === 0) {
            return res.status(404).json({ error: "Document not found" });
        }

        if (!checkDocumentAccess(req, docRows[0], "upload").allowed) return res.status(403).json({ error: "Forbidden" });
        if (!Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > 10 * 1024 * 1024) return res.status(400).json({ error: "Invalid file size" });

        const safeFileName = decodeURIComponent(fileName).replace(/[\u0000-\u001F\u007F]/g, "").trim();
        if (!safeFileName || /[\\/]/.test(safeFileName)) return res.status(400).json({ error: "Invalid file name" });
        const finalContentType = getMimeTypeByExtension(safeFileName);
        if (finalContentType === "application/octet-stream" || (contentType !== finalContentType && contentType !== "application/octet-stream")) return res.status(400).json({ error: "Unsupported or mismatched file type" });
        const fileKey = `documents/${id}/${Date.now()}-${safeFileName}`;

        try {
            await uploadObjectBuffer(fileKey, req.body, finalContentType);
        } catch (s3Err) {
            console.warn("Direct upload S3 warning (saving to local storage fallback):", s3Err.message);
            const localDir = path.join(__dirname, "uploads", String(id));
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            fs.writeFileSync(path.join(localDir, safeFileName), req.body);
        }

        await pool.query("UPDATE documents SET file_key = ? WHERE id = ?", [fileKey, id]);

        const [existingFiles] = await pool.query("SELECT id FROM document_files WHERE document_id = ?", [id]);
        if (existingFiles.length > 0) {
            await pool.query(
                "UPDATE document_files SET file_name = ?, file_path = ?, file_size = ?, mime_type = ?, uploaded_at = CURRENT_TIMESTAMP WHERE document_id = ?",
                [safeFileName, fileKey, req.body.length, finalContentType, id]
            );
        } else {
            await pool.query(
                "INSERT INTO document_files (document_id, file_name, file_path, file_size, mime_type, uploaded_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                [id, safeFileName, fileKey, req.body.length, finalContentType]
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
        res.status(500).json({ error: "Failed to upload file" });
    }
});

// Endpoint สำหรับบันทึก/ยืนยัน Metadata ไฟล์หลังการ Upload สำเร็จ
app.post(
    "/api/documents/:id/file-metadata",
    requireCognitoAuth,
    loadUserRole,
    async (req, res) => {
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

        // [เพิ่มใหม่] ตรวจสอบสิทธิ์ก่อนยอมให้บันทึก Metadata ไฟล์
        const access = checkDocumentAccess(req, docRows[0], "upload");
        if (!access.allowed) {
            return res.status(403).json({ error: access.reason || "Permission Denied" });
        }

        const safeFileName = fileName.replace(/[\u0000-\u001F\u007F]/g, "").trim();
        const finalKey = fileKey;
        if (!finalKey || finalKey !== docRows[0].file_key || !finalKey.startsWith(`documents/${id}/`)) return res.status(400).json({ error: "Invalid file key" });
        const finalMime = mimeType || getMimeTypeByExtension(safeFileName);
        const parsedSize = fileSize ? Number(fileSize) : null;

        if (!Number.isInteger(parsedSize) || parsedSize <= 0 || parsedSize > 10 * 1024 * 1024 || finalMime !== getMimeTypeByExtension(safeFileName)) return res.status(400).json({ error: "Invalid file metadata" });
        const storedObject = await getObjectMetadata(finalKey);
        if (storedObject.ContentLength !== parsedSize || (storedObject.ContentType && storedObject.ContentType !== finalMime)) return res.status(400).json({ error: "Uploaded file metadata does not match" });

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

// Create S3 preview URL พร้อมตรวจสอบสิทธิ์
// เฉพาะ PDF, JPG/JPEG และ PNG สามารถแสดงตัวอย่างได้
// สำหรับ DOCX, XLSX, PPTX จะส่ง metadata กลับเพื่อให้แสดงปุ่มดาวน์โหลด
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

            const access = checkDocumentAccess(req, doc, "read");
            if (!access.allowed) return res.status(403).json({ error: "Forbidden" });

            if (!fileKey) {
                return res.status(404).json({
                    error: "Document file not found"
                });
            }

            // ตรวจสอบสิทธิ์การเข้าถึง
            const finalFileName = doc.file_name || extractFileNameFromKey(fileKey);
            const ext = finalFileName ? path.extname(finalFileName).toLowerCase() : "";
            const canPreview = PREVIEWABLE_EXTENSIONS.includes(ext);
            const resolvedMime = doc.mime_type || getMimeTypeByExtension(finalFileName);

            let previewUrl = null;
            let downloadUrl = null;
            try {
                if (canPreview) {
                    previewUrl = await createDownloadUrl(fileKey, {
                        disposition: "inline",
                        fileName: finalFileName,
                        contentType: resolvedMime
                    });
                }
                downloadUrl = await createDownloadUrl(fileKey, {
                    disposition: "attachment",
                    fileName: finalFileName,
                    contentType: resolvedMime
                });
            } catch (s3Err) {
                console.warn("createDownloadUrl in preview-url endpoint fallback:", s3Err.message);
                previewUrl = `/api/documents/${id}/preview-file`;
                downloadUrl = `/api/documents/${id}/download-file`;
            }

            res.json({
                document_id: id,
                file_name: finalFileName,
                file_size: doc.file_size,
                mime_type: resolvedMime,
                file_extension: ext,
                can_preview: canPreview,
                preview_url: previewUrl,
                download_url: downloadUrl
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                error: "Failed to generate preview URL"
            });
        }
    }
);

// Helper ฟังก์ชันดึง Buffer ของไฟล์จริงจาก S3 โดยตรง (ลบ Fallback ที่นำภาพหรือไฟล์อื่นมาแสดงแทนออกทั้งหมด)
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

// Endpoint สตรีมไฟล์สำหรับ Preview (Inline)
app.get("/api/documents/:id/view-file", requireCognitoAuth, loadUserRole, async (req, res) => {
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
            return res.status(404).send("Document or file not found");
        }

        const doc = rows[0];
        const access = checkDocumentAccess(req, doc, "read");
        if (!access.allowed) {
            return res.status(403).send("Forbidden");
        }
        if (!doc.file_key) return res.status(404).send("Document or file not found");

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
// ช่วยให้เบราว์เซอร์ดาวน์โหลดไฟล์ลงเครื่องทันที และไม่ติด Quarantine Policy ของ AWS

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

            if (rows.length === 0) {
                return res.status(404).send("Document or file not found");
            }

            const doc = rows[0];
            const access = checkDocumentAccess(req, doc);
            if (!access.allowed) {
                return res.status(403).send("Forbidden");
            }
            if (!doc.file_key) return res.status(404).send("Document or file not found");

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

            if (rows.length === 0) {
                return res.status(404).json({
                    error: "Document or file not found"
                });
            }

            const doc = rows[0];

            const access = checkDocumentAccess(req, doc, "read");
            if (!access.allowed) return res.status(403).json({ error: "Forbidden" });
            if (!doc.file_key) return res.status(404).json({ error: "Document or file not found" });

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

            const mimeType = doc.mime_type || getMimeTypeByExtension(fileName);

            // ตรวจสอบไฟล์ในไดเรกทอรีภายในเครื่องก่อน (Local Mock Fallback สำหรับ Test Dataset)
            const possibleLocalPaths = [
                path.join(__dirname, "../documents", fileName),
                path.join(__dirname, "../frontend/data", fileName),
                path.join(__dirname, "uploads", fileName),
                path.join(__dirname, "uploads", String(id), fileName),
                path.join(__dirname, "uploads", String(id), path.basename(doc.file_key || "")),
                path.join(__dirname, "../documents", path.basename(doc.file_key || "")),
                path.join(__dirname, "../frontend/data", path.basename(doc.file_key || ""))
            ];
            const foundLocal = possibleLocalPaths.find(p => fs.existsSync(p));

            if (foundLocal) {
                const stat = fs.statSync(foundLocal);
                res.setHeader("Content-Type", mimeType);
                res.setHeader(
                    "Content-Disposition",
                    `inline; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"`
                );
                res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Content-Length", stat.size);
                return fs.createReadStream(foundLocal).pipe(res);
            }

            const file = await getS3Object(doc.file_key);

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
                        error: "ไม่พบไฟล์นี้ในระบบจัดเก็บ S3 Storage (NoSuchKey)"
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

// Create S3 download URL พร้อมตรวจสอบสิทธิ์
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

            const access = checkDocumentAccess(req, doc, "read");
            if (!access.allowed) return res.status(403).json({ error: "Forbidden" });

            // Check file exists in database
            if (!fileKey) {
                return res.status(404).json({
                    error: "Document file not found"
                });
            }

            const finalFileName = doc.file_name || extractFileNameFromKey(fileKey);
            const resolvedMime = doc.mime_type || getMimeTypeByExtension(finalFileName);
            let downloadUrl = null;
            try {
                downloadUrl = await createDownloadUrl(fileKey, {
                    disposition: "attachment",
                    fileName: finalFileName,
                    contentType: resolvedMime
                });
            } catch (s3Err) {
                console.warn("createDownloadUrl in download-url endpoint fallback:", s3Err.message);
                downloadUrl = `/api/documents/${id}/download-file`;
            }

            res.json({
                document_id: id,
                file_name: finalFileName,
                file_size: doc.file_size,
                mime_type: resolvedMime,
                download_url: downloadUrl,
                expires_in: 300
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                error: "Failed to create download URL"
            });
        }
    });

// ดาวน์โหลดไฟล์เอกสารโดยตรง (รองรับทั้ง Local Fallback และ S3)
app.get(
    "/api/documents/:id/download-file",
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

            if (rows.length === 0) {
                return res.status(404).json({ error: "Document or file not found" });
            }

            const doc = rows[0];
            const access = checkDocumentAccess(req, doc, "read");
            if (!access.allowed) return res.status(403).json({ error: "Forbidden" });

            const fileName = doc.file_name || extractFileNameFromKey(doc.file_key) || "document";
            const mimeType = doc.mime_type || getMimeTypeByExtension(fileName);

            const possibleLocalPaths = [
                path.join(__dirname, "../documents", fileName),
                path.join(__dirname, "../frontend/data", fileName),
                path.join(__dirname, "uploads", fileName),
                path.join(__dirname, "../documents", path.basename(doc.file_key || "")),
                path.join(__dirname, "../frontend/data", path.basename(doc.file_key || ""))
            ];
            const foundLocal = possibleLocalPaths.find(p => fs.existsSync(p));

            if (foundLocal) {
                const stat = fs.statSync(foundLocal);
                res.setHeader("Content-Type", mimeType);
                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"`
                );
                res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Content-Length", stat.size);
                return fs.createReadStream(foundLocal).pipe(res);
            }

            const file = await getS3Object(doc.file_key);
            res.setHeader("Content-Type", mimeType);
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, "_")}"`
            );
            res.setHeader("X-Content-Type-Options", "nosniff");
            if (file.ContentLength != null) res.setHeader("Content-Length", file.ContentLength);
            file.Body.pipe(res);
        } catch (error) {
            console.error("Download file error:", error.message);
            res.status(500).json({ error: "Failed to download document" });
        }
    }
);

// ============================================================================
// [CS361 V3 | Project 4] TEST DATASET APIS
// ============================================================================
app.get("/api/test-dataset", async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                document_id,
                incoming_no,
                subject,
                recipient,
                assigned_to,
                status,
                attachment,
                action_time
            FROM test_documents
            ORDER BY document_id ASC
        `);

        // ซิงค์สถานะและผู้ได้รับมอบหมายล่าสุดจากตาราง documents
        const [liveDocs] = await pool.query(`
            SELECT 
                d.reference_no,
                d.status,
                u.username AS assigned_username,
                u.full_name AS assigned_full_name
            FROM documents d
            LEFT JOIN users u ON u.id = d.assignee_id
            WHERE d.reference_no IN ('D-401', 'D-402')
        `);
        const liveMap = {};
        liveDocs.forEach(d => { liveMap[d.reference_no] = d; });

        const enriched = rows.map(r => {
            const live = liveMap[r.document_id];
            const liveAssignee = (live && live.assigned_username)
                ? `${live.assigned_username} (${live.assigned_full_name || ''})`.trim()
                : r.assigned_to;
            return {
                document_id: r.document_id,
                incoming_no: r.incoming_no,
                subject: r.subject,
                recipient: r.recipient,
                assigned_to: liveAssignee,
                status: (live && live.status) ? live.status : r.status,
                attachment: r.attachment,
                action_time: r.action_time
            };
        });

        res.json({
            ok: true,
            count: enriched.length,
            fields: [
                "document_id",
                "incoming_no",
                "subject",
                "recipient",
                "assigned_to",
                "status",
                "attachment",
                "action_time"
            ],
            data: enriched
        });
    } catch (error) {
        console.error("Test dataset API error:", error);
        try {
            const jsonPath = path.join(__dirname, "../json/test_dataset.json");
            if (fs.existsSync(jsonPath)) {
                const fileData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
                return res.json({
                    ok: true,
                    count: fileData.length,
                    source: "file_fallback",
                    data: fileData
                });
            }
        } catch (_) {}
        res.status(500).json({ ok: false, error: "Failed to fetch test dataset" });
    }
});

// รีเซ็ต Test Dataset กลับสู่ค่าตั้งต้น Baseline (สำหรับ Live Challenge และการทดสอบ)
app.all(["/api/test-dataset/reset", "/api/test-dataset/baseline"], async (req, res) => {
    try {
        const { execFile } = require("child_process");
        const scriptPath = path.join(__dirname, "seed_test_dataset.js");
        execFile(process.execPath, [scriptPath], (err, stdout, stderr) => {
            if (err) {
                console.error("Reset script error:", err, stderr);
                return res.status(500).json({ ok: false, error: "Reset failed", details: stderr || err.message });
            }
            res.json({
                ok: true,
                message: "Test dataset reset back to baseline successfully",
                output: stdout
            });
        });
    } catch (error) {
        console.error("Reset endpoint error:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ดักจับกรณีส่ง Request เกิน 1MB
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: "Payload too large" });
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
