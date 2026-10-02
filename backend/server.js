const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();

const app = express();

const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());


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


// Get all documents
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


        sql += " ORDER BY created_at DESC";


        const [rows] = await pool.query(sql, params);

        res.json(rows);

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
            receiver_name,
            sent_date,
            receive_date,
            deadline,
            status = "Received",
            file_key = null
        } = req.body;


        // Trim text fields
        const referenceNo = reference_no?.trim();
        const documentNumber = document_number?.trim();
        const subjectText = subject?.trim();
        const documentType = document_type?.trim();
        const senderName = sender_name?.trim();
        const senderDepartment = sender_department?.trim();
        const receiverName = receiver_name?.trim();


        // Required fields
        if (
            !referenceNo ||
            !subjectText ||
            !documentType ||
            !senderName
        ) {
            return res.status(400).json({
                error: "reference_no, subject, document_type and sender_name are required"
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
                error: "Invalid status"
            });
        }

        const dateFields = {
            sent_date,
            receive_date,
            deadline
        };

        for (const [fieldName, value] of Object.entries(dateFields)) {

            if (value && isNaN(Date.parse(value))) {

                return res.status(400).json({
                    error: `${fieldName} must be a valid date`
                });

            }

        }

        // INSERT
        const [result] = await pool.query(
            `
        INSERT INTO documents (
        reference_no,
        document_number,
        subject,
        document_type,
        sender_name,
        sender_department,
        receiver_name,
        sent_date,
        receive_date,
        deadline,
        status,
        file_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
            [
                referenceNo,
                documentNumber || null,
                subjectText,
                documentType,
                senderName,
                senderDepartment || null,
                receiverName || null,
                sent_date || null,
                receive_date || null,
                deadline || null,
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


app.listen(PORT, () => {

    console.log(
        `CS361 EMS API running on http://localhost:${PORT}`
    );

});