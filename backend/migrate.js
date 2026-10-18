const pool = require("./db");

async function runMigration() {
  try {
    console.log("🚀 กำลังตรวจสอบและ Migrate โครงสร้างฐานข้อมูล DocuFlow (AWS RDS)...");

    // 1. ตาราง channels (ช่องทางการรับเอกสาร)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS channels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. ตาราง document_types (ประเภทเอกสาร)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. ตาราง documents (เอกสารหลัก)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reference_no VARCHAR(50) NOT NULL UNIQUE,
        document_number VARCHAR(100) NULL,
        subject VARCHAR(255) NOT NULL,
        document_type VARCHAR(100) NOT NULL,
        sender_name VARCHAR(150) NOT NULL,
        sender_department VARCHAR(150) NULL,
        sender_contact VARCHAR(150) NULL,
        receiver_name VARCHAR(150) NULL,
        sent_date DATE NULL,
        receive_date DATE NULL,
        deadline DATE NULL,
        remarks TEXT NULL,
        receiving_channel VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'Received',
        file_key VARCHAR(255) NULL,
        owner_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. ตาราง document_files (ไฟล์แนบเอกสาร)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        document_id INT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_size INT NULL,
        mime_type VARCHAR(100) NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_file_doc (document_id),
        CONSTRAINT fk_file_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. ตาราง document_status_logs (ประวัติ Workflow V3 - รวมจาก migrate_v3.js)
    await pool.query(`
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
    `);

    // 6. เพิ่ม Master Data ช่องทางรับเอกสาร
    await pool.query(`
      INSERT IGNORE INTO channels (code, name) VALUES 
      ('EMAIL', 'อีเมล'),
      ('PAPER', 'กระดาษ / ยื่นด้วยตนเอง');
    `);

    // 7. เพิ่ม Master Data ประเภทเอกสาร 7 ประเภท
    await pool.query(`
      INSERT IGNORE INTO document_types (name, description) VALUES 
      ('เอกสารประชาสัมพันธ์', 'ใช้สำหรับแจ้งข่าวสาร หรือกิจกรรมต่าง ๆ'),
      ('เอกสารขออนุมัติ', 'ใช้สำหรับเสนอเรื่องเพื่อขออนุมัติ'),
      ('เอกสารมอบหมายงาน', 'ใช้สำหรับมอบหมายงานหรือหน้าที่'),
      ('เอกสารแจ้งเพื่อทราบ', 'ใช้สำหรับแจ้งข้อมูลให้ผู้รับทราบ'),
      ('เอกสารรอการตอบกลับ', 'ใช้สำหรับรอการยืนยันหรือการตอบกลับ'),
      ('เอกสารแจ้งกำหนดการ/การนัดหมาย', 'ใช้สำหรับแจ้งวัน เวลา และรายละเอียดการนัดหมาย'),
      ('เอกสารรายงานผล', 'ใช้สำหรับสรุปผลการดำเนินงาน');
    `);

    // 8. ตรวจสอบและเพิ่ม assignee_id ในตาราง documents
    try {
      const [colRows] = await pool.query(`
        SELECT COUNT(*) as cnt
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'documents'
          AND COLUMN_NAME = 'assignee_id'
      `);
      if (colRows[0].cnt === 0) {
        await pool.query(`
          ALTER TABLE documents
          ADD COLUMN assignee_id INT NULL,
          ADD INDEX idx_doc_assignee (assignee_id)
        `);
        console.log("  + Added assignee_id column to documents table");
      }
    } catch (colErr) {
      console.warn("  ! Note on assignee_id column:", colErr.message);
    }

    // 9. ตาราง document_assignments (การมอบหมายและการส่งต่อเอกสาร)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        document_id INT NOT NULL,
        assigned_by_user_id VARCHAR(100) NOT NULL,
        assigned_by_username VARCHAR(100) NULL,
        previous_assignee_id VARCHAR(100) NULL,
        new_assignee_id VARCHAR(100) NOT NULL,
        action_type VARCHAR(50) NOT NULL COMMENT 'ASSIGN หรือ FORWARD',
        remarks TEXT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_assign_doc (document_id),
        INDEX idx_assign_new (new_assignee_id),
        CONSTRAINT fk_assign_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. ตาราง document_audit_trails (บันทึก Audit Trail ส่วนกลาง - ครบถ้วนตามมาตรฐานความมั่นคงปลอดภัย)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_audit_trails (
        id INT AUTO_INCREMENT PRIMARY KEY,
        document_id INT NOT NULL,
        actor_user_id VARCHAR(100) NOT NULL,
        actor_username VARCHAR(100) NULL,
        actor_role VARCHAR(50) NULL,
        event_type VARCHAR(50) NOT NULL COMMENT 'ASSIGN, FORWARD, STATUS_CHANGE, DOCUMENT_CREATE',
        before_state JSON NULL COMMENT 'ข้อมูลก่อนการเปลี่ยนแปลง',
        after_state JSON NULL COMMENT 'ข้อมูลหลังการเปลี่ยนแปลง',
        details JSON NULL COMMENT 'รายละเอียดเพิ่มเติม เช่น หมายเหตุ เหตุผล (Sanitized)',
        ip_address VARCHAR(45) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_doc (document_id),
        INDEX idx_audit_event (event_type),
        INDEX idx_audit_actor (actor_user_id),
        INDEX idx_audit_time (created_at),
        CONSTRAINT fk_audit_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 11. Trigger ป้องกันการแก้ไข (UPDATE) บนตาราง document_audit_trails เพื่อความน่าเชื่อถือและป้องกันการแก้ไข (Tamper Protection)
    try {
      await pool.query("DROP TRIGGER IF EXISTS prevent_audit_trail_update");
      await pool.query(`
        CREATE TRIGGER prevent_audit_trail_update
        BEFORE UPDATE ON document_audit_trails
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Audit trail records are immutable and cannot be updated.';
        END;
      `);
      console.log("  + Immutability trigger on document_audit_trails active");
    } catch (trigErr) {
      console.warn("  ! Note on trigger creation:", trigErr.message);
    }

    console.log("✅ ตรวจสอบและสร้างโครงสร้างตารางทุกส่วน (รวม Audit Trail & Workflow V3) สำเร็จเรียบร้อย!");
    const [tables] = await pool.query("SHOW TABLES");
    console.log("📋 รายการตารางทั้งหมดในฐานข้อมูล:", tables.map(t => Object.values(t)[0]));

    process.exit(0);
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาดในการ Migrate:", err.message);
    process.exit(1);
  }
}

runMigration();