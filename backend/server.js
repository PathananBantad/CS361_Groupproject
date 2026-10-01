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

        const [rows] = await pool.query(`
      SELECT *
      FROM documents
      ORDER BY created_at DESC
    `);

        res.json(rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch documents"
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


        // Required fields
        if (
            !reference_no ||
            !subject ||
            !document_type ||
            !sender_name
        ) {

            return res.status(400).json({
                error:
                    "reference_no, subject, document_type and sender_name are required"
            });

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
                reference_no,
                document_number || null,
                subject,
                document_type,
                sender_name,
                sender_department || null,
                receiver_name || null,
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