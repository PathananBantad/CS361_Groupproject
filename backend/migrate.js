const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function runMigration() {
  try {
    const sqlPath = path.join(__dirname, "database", "init_schema.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    const statements = sql
      .split(";")
      .map((st) => st.trim())
      .filter((st) => st.length > 0);

    console.log("กำลังสร้างตารางและ Master Data บน AWS RDS...");

    for (const statement of statements) {
      await pool.query(statement);
    }

    console.log("สร้างตารางและบันทึก Master Data 7 ประเภทสำเร็จเรียบร้อย!");
    process.exit(0);
  } catch (err) {
    console.error("เกิดข้อผิดพลาด:", err.message);
    process.exit(1);
  }
}

runMigration();