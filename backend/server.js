const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();

const {
    createUploadUrl,
    createDownloadUrl
} = require("./s3");

const app = express();
const path = require("path");

const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

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
            sql += " AND status = ?";
            params.push(status);
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
            sql += ` AND (reference_no LIKE ? OR sender_name LIKE ? OR receiver_name LIKE ?) `;
            const keyword = `%${search}%`;
            params.push(keyword, keyword, keyword);
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
        const {
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

        // Validate receiving_channel (Removed strict validation to allow frontend values)


        // Required fields
        if (
            !subject ||
            !document_type ||
            !sender_name
        ) {
            return res.status(400).json({
                error: "subject, document_type and sender_name are required"
            });
        }


        // Validate status
        const allowedStatuses = [
            "Received",
            "Assigned",
            "Processing",
            "Completed"
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                error: "status must be one of: Received, Assigned, Processing, Completed"
            });
        }


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
        status,
        file_key
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
            [
                newRefNo,
                document_number || null,
                subject,
                document_type,
                sender_name,
                sender_department || null,
                sender_contact || null,
                receiver_name || null,
                sent_date || null,
                receive_date || null,
                deadline || null,
                remarks || null,
                receiving_channel || null,
                status,
                file_key
            ]
        );

        const [rows] = await pool.query(
            "SELECT * FROM documents WHERE id = ?",
            [result.insertId]
        );


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
            "กระดาษ",
            "อิเล็กทรอนิกส์"
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
        const fileKey = `documents/${id}/${Date.now()}-${fileName}`;

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
            "SELECT file_key FROM documents WHERE id = ?",
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

app.listen(PORT, () => {

    console.log(
        `CS361 EMS API running on http://localhost:${PORT}`
    );

});