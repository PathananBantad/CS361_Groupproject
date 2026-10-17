-- =====================================================
-- DocuFlow Database Schema (AWS RDS MySQL)
-- =====================================================

-- 1. ตาราง channels (ช่องทางการรับเอกสาร)
CREATE TABLE IF NOT EXISTS channels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. ตาราง document_types (ประเภทเอกสาร)
CREATE TABLE IF NOT EXISTS document_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. ตาราง documents (เอกสารหลัก)
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

-- 4. ตาราง document_files (ไฟล์แนบเอกสาร)
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

-- 5. ตาราง document_status_logs (ประวัติการเปลี่ยนสถานะ Workflow V3)
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

-- 6. เพิ่ม Master Data ช่องทางรับเอกสาร
INSERT IGNORE INTO channels (code, name) VALUES 
('EMAIL', 'อีเมล'),
('PAPER', 'กระดาษ / ยื่นด้วยตนเอง');

-- 7. เพิ่ม Master Data ประเภทเอกสาร 7 ประเภท
INSERT IGNORE INTO document_types (name, description) VALUES 
('เอกสารประชาสัมพันธ์', 'ใช้สำหรับแจ้งข่าวสาร หรือกิจกรรมต่าง ๆ'),
('เอกสารขออนุมัติ', 'ใช้สำหรับเสนอเรื่องเพื่อขออนุมัติ'),
('เอกสารมอบหมายงาน', 'ใช้สำหรับมอบหมายงานหรือหน้าที่'),
('เอกสารแจ้งเพื่อทราบ', 'ใช้สำหรับแจ้งข้อมูลให้ผู้รับทราบ'),
('เอกสารรอการตอบกลับ', 'ใช้สำหรับรอการยืนยันหรือการตอบกลับ'),
('เอกสารแจ้งกำหนดการ/การนัดหมาย', 'ใช้สำหรับแจ้งวัน เวลา และรายละเอียดการนัดหมาย'),
('เอกสารรายงานผล', 'ใช้สำหรับสรุปผลการดำเนินงาน');