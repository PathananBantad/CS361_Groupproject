-- =====================================================
-- Migration: Add responsible_person role
-- Description: Adds 'responsible_person' to roles table safely and idempotently.
-- Safe to re-run multiple times without duplicate errors.
-- =====================================================

CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (name, description)
VALUES ('responsible_person', 'ผู้รับผิดชอบเรื่อง')
ON DUPLICATE KEY UPDATE description = VALUES(description);

