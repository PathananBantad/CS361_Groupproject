
-- Authentication Migration
-- Add password_hash to existing users table.
-- Run this migration after selecting the project database.

SET @column_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'password_hash'
);

SET @migration_sql = IF(
    @column_exists = 0,
    'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL',
    'SELECT ''password_hash column already exists'' AS message'
);

PREPARE auth_stmt FROM @migration_sql;
EXECUTE auth_stmt;
DEALLOCATE PREPARE auth_stmt;
