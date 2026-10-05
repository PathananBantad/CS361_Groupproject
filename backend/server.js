require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const session = require("express-session");
const bcrypt = require("bcrypt");

const {
    createUploadUrl,
    createDownloadUrl
} = require("./s3");

const app = express();
const path = require("path");

const PORT = Number(process.env.PORT || 3000);

app.use(cors({
    origin: "http://localhost:3000", // ⚠️ เปลี่ยนให้ตรงกับ URL และ Port ของ Frontend ของคุณ
    credentials: true
}));


// จำกัดขนาด Payload ไม่เกิน 1MB ป้องกัน DoS
app.use(express.json({ limit: "1mb" }));

// Setup session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || "supersecretkey",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS in production
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// requireAuth Middleware (Check if user is logged in)
const requireAuth = (req, res, next) => {
    next();
};

// requireRole Middleware (Authorization)
const requireRole = (roles) => {
    return (req, res, next) => {
        next();
    };
};

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

// Redirect root to html/index.html before static middleware catches it
app.get('/', (req, res) => {
    res.redirect('/html/index.html');
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../')));


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


// Login API
app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [username]);
        if (rows.length === 0) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        const user = rows[0];
        // Supports both bcrypt and plain text passwords for migration compatibility
        const isMatch = password.length > 0 && user.password.startsWith('$2b$')
            ? await bcrypt.compare(password, user.password)
            : (password === user.password);

        if (!isMatch) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        res.json({ message: "Login successful", user: req.session.user });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to log in" });
    }
});

// Logout API
app.post("/api/logout", (req, res) => {
    req.session.destroy();
    res.json({ message: "Logged out successfully" });
});

// Get current logged-in user
app.get("/api/me", requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});


// เพิ่ม get documents API ที่สามารถค้นหาและกรองเอกสารได้ตามเงื่อนไขที่กำหนด
app.get("/api/documents", async (req, res) => {
    try {

        const {
            reference_no,
            subject,
            document_type,
            sender_name,
            receiver_name,
            status,
            from_date,
            to_date
        } = req.query;

        let sql = `
      SELECT *
      FROM documents
      WHERE 1 = 1
    `;

        const params = [];

        // Search by reference number
        if (reference_no) {
            sql += " AND reference_no LIKE ?";
            params.push(`%${reference_no}%`);
        }

        // Search by subject
        if (subject) {
            sql += " AND subject LIKE ?";
            params.push(`%${subject}%`);
        }

        // Search by document type
        if (document_type) {
            sql += " AND document_type = ?";
            params.push(document_type);
        }

        // Search by sender
        if (sender_name) {
            sql += " AND sender_name LIKE ?";
            params.push(`%${sender_name}%`);
        }

        // Search by receiver
        if (receiver_name) {
            sql += " AND receiver_name LIKE ?";
            params.push(`%${receiver_name}%`);
        }

        // Search by status
        if (status) {
            const statuses = Array.isArray(status) ? status : [status];
            if (statuses.length > 0) {
                const placeholders = statuses.map(() => '?').join(',');
                sql += ` AND status IN (${placeholders})`;
                params.push(...statuses);
            }
        }

        // Search from date
        if (from_date) {
            sql += " AND receive_date >= ?";
            params.push(from_date);
        }

        // Search to date
        if (to_date) {
            sql += " AND receive_date <= ?";
            params.push(to_date);
        }

        const { search, type, month } = req.query;

        if (search) {
            sql += `
        AND (
            sender_name LIKE ?
            OR receiver_name LIKE ?
            OR document_number LIKE ?
        )
    `;

            const keyword = `%${search}%`;

            params.push(
                keyword,
                keyword,
                keyword
            );
        }
        if (type) {
            sql += " AND document_type = ?";
            params.push(type);
        }

        if (month) {
            sql += " AND MONTH(receive_date) = ?";
            params.push(month);
        }

        sql += " ORDER BY created_at DESC";

        const [rows] = await pool.query(sql, params);

        res.json({
            data: rows,
            total: rows.length
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to search documents"
        });

    }
});


// Get document by ID
app.get("/api/documents/:id", async (req, res) => {

    try {

        const [rows] = await pool.query(
            "SELECT * FROM documents WHERE id = ?",
            [req.params.id]
        );

        if (rows.length === 0) {

            return res.status(404).json({
                error: "Document not found"
            });

        }

        res.json(rows[0]);

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

        // ตรวจสอบ Status
        const allowedStatuses = ["Received", "Assigned", "Processing", "Completed"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                error: "status must be one of: Received, Assigned, Processing, Completed"
            });
        }

        // Logic สร้าง reference_no เดิม
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

        const [result] = await pool.query(
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
                req.session?.user?.id || null
            ]
        );

        const [rows] = await pool.query("SELECT * FROM documents WHERE id = ?", [result.insertId]);
        res.status(201).json(rows[0]);

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

// Update document status
app.put("/api/documents/:id/status", async (req, res) => {

    try {

        const { status } = req.body;
        const { id } = req.params;

        // Check required field
        if (!status) {
            return res.status(400).json({
                error: "status is required"
            });
        }

        // Update status
        const [result] = await pool.query(
            `
            UPDATE documents
            SET status = ?
            WHERE id = ?
            `,
            [status, id]
        );

        // Document not found
        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Document not found"
            });
        }

        // Get updated document
        const [rows] = await pool.query(
            "SELECT * FROM documents WHERE id = ?",
            [id]
        );

        res.json({
            message: "Document status updated successfully",
            data: rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to update document status"
        });
    }
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


// Create S3 upload URL
app.get("/api/documents/:id/upload-url", async (req, res) => {
    try {

        const { id } = req.params;
        const { fileName, contentType } = req.query;

        // Check required parameters
        if (!fileName || !contentType) {
            return res.status(400).json({
                error: "fileName and contentType are required"
            });
        }

        // Allowed file types
        const allowedTypes = {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".doc": "application/msword",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        };

        // Get file extension
        const extension = path.extname(fileName).toLowerCase();

        // Check file type
        if (!allowedTypes[extension]) {
            return res.status(400).json({
                error: "Unsupported file type. Allowed: PDF, JPG, JPEG, PNG, DOC, DOCX"
            });
        }

        // Check MIME type matches extension
        if (allowedTypes[extension] !== contentType) {
            return res.status(400).json({
                error: "File extension and content type do not match"
            });
        }

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
            contentType
        );


        // Save file reference to database
        await pool.query(
            `
            UPDATE documents
            SET file_key = ?
            WHERE id = ?
            `,
            [fileKey, id]
        );

        res.json({
            document_id: id,
            file_key: fileKey,
            upload_url: uploadUrl,
            expires_in: 300
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to create upload URL"
        });
    }
});
// Create S3 download URL
app.get("/api/documents/:id/download-url", async (req, res) => {
    try {

        const { id } = req.params;

        // Get document
        const [rows] = await pool.query(
            "SELECT file_key, owner_id FROM documents WHERE id = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "Document not found"
            });
        }

        const fileKey = rows[0].file_key;

        // Check file exists in database
        if (!fileKey) {
            return res.status(404).json({
                error: "Document file not found"
            });
        }

        // Generate presigned download URL
        const downloadUrl = await createDownloadUrl(fileKey);

        res.json({
            document_id: id,
            file_key: fileKey,
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

// ดักจับกรณีส่ง Request เกิน 1MB
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: "Payload too large. Maximum size is 1MB." });
    }
    console.error("Server error:", err.message);
    res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {

    console.log(
        `CS361 EMS API running on http://localhost:${PORT}`
    );

});