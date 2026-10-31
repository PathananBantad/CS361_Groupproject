-- =====================================================
-- DocuFlow Audit Trail & Assignment Migration
-- =====================================================

-- 1. เพิ่มฟิลด์ assignee_id ในตาราง documents หากยังไม่มี
SET @column_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'documents'
      AND COLUMN_NAME = 'assignee_id'
);

SET @alter_sql = IF(
    @column_exists = 0,
    'ALTER TABLE documents ADD COLUMN assignee_id INT NULL, ADD INDEX idx_doc_assignee (assignee_id)',
    'SELECT ''assignee_id column already exists'' AS message'
);

PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. สร้างตาราง document_assignments หากยังไม่มี
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

-- 3. สร้างตาราง document_audit_trails สำหรับบันทึก Audit Trail ส่วนกลาง
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

-- 4. Trigger เพื่อป้องกันการแก้ไข (UPDATE) และลบ (DELETE) บนตาราง document_audit_trails (Immutability / Tamper Protection)
DROP TRIGGER IF EXISTS prevent_audit_trail_update;
DELIMITER //
CREATE TRIGGER prevent_audit_trail_update
BEFORE UPDATE ON document_audit_trails
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Audit trail records are immutable and cannot be updated.';
END;
//
DELIMITER ;

DROP TRIGGER IF EXISTS prevent_audit_trail_delete;
DELIMITER //
CREATE TRIGGER prevent_audit_trail_delete
BEFORE DELETE ON document_audit_trails
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Audit trail records are immutable and cannot be deleted.';
END;
//
DELIMITER ;
