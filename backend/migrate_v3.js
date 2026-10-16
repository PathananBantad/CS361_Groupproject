const pool = require("./db");

async function run() {
  try {
    console.log("Checking and creating document_status_logs table...");
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS document_status_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        document_id INT NOT NULL,
        old_status VARCHAR(50) NOT NULL,
        new_status VARCHAR(50) NOT NULL,
        changed_by VARCHAR(100) NULL,
        changed_by_user_id INT NULL,
        remarks TEXT NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_doc_id (document_id),
        CONSTRAINT fk_status_log_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await pool.query(createTableSql);
    console.log("document_status_logs table is ready!");

    const [tables] = await pool.query("SHOW TABLES");
    console.log("Current tables in DB:", tables);

    process.exit(0);
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  }
}

run();
