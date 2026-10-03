DROP TABLE IF EXISTS document_files;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS document_types;
DROP TABLE IF EXISTS channels;

-- สร้างตาราง channels
CREATE TABLE IF NOT EXISTS channels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- สร้างตาราง document_types
CREATE TABLE IF NOT EXISTS document_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- สร้างตาราง documents
CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_reference VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    document_type_id INT NOT NULL,
    channel_id INT NOT NULL,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_document_type FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE RESTRICT,
    CONSTRAINT fk_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE RESTRICT
);

-- สร้างตารางเก็บไฟล์
CREATE TABLE IF NOT EXISTS document_files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size INT,
    mime_type VARCHAR(100),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_file_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- ช่องทางรับ
INSERT IGNORE INTO channels (code, name) VALUES 
('EMAIL', 'อีเมล'),
('PAPER', 'กระดาษ / ยื่นด้วยตนเอง');

-- ประเภทเอสาร
INSERT IGNORE INTO document_types (name, description) VALUES 
('เอกสารประชาสัมพันธ์', 'ใช้สำหรับแจ้งข่าวสาร หรือกิจกรรมต่าง ๆ'),
('เอกสารขออนุมัติ', 'ใช้สำหรับเสนอเรื่องเพื่อขออนุมัติ'),
('เอกสารมอบหมายงาน', 'ใช้สำหรับมอบหมายงานหรือหน้าที่'),
('เอกสารแจ้งเพื่อทราบ', 'ใช้สำหรับแจ้งข้อมูลให้ผู้รับทราบ'),
('เอกสารรอการตอบกลับ', 'ใช้สำหรับรอการยืนยันหรือการตอบกลับ'),
('เอกสารแจ้งกำหนดการ/การนัดหมาย', 'ใช้สำหรับแจ้งวัน เวลา และรายละเอียดการนัดหมาย'),
('เอกสารรายงานผล', 'ใช้สำหรับสรุปผลการดำเนินงาน');