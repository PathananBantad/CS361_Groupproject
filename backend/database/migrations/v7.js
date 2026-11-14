// =====================================================
// V7 Schema Migration (Issue: [V7][DB] Migration ทุกตาราง/field ของรอบ V7)
// -----------------------------------------------------
// กติกา:
//   - รันซ้ำได้ (idempotent): ทุกคำสั่งตรวจ INFORMATION_SCHEMA ก่อน หรือใช้ IF NOT EXISTS
//   - ไม่มี DROP / RENAME / MODIFY column เดิม (เพิ่มอย่างเดียว)
//   - ใช้ Schema เดิม: MySQL, INT id, users / users_roles / document_assignments / document_audit_trails
//   - ไม่สร้างตาราง users / history ใหม่ และไม่เปลี่ยนเป็น UUID
// ที่มา: ADR #71 (หัวหน้าสาขา), ADR #72 (Share Link แทน Guest), #75, #77, #78, #79, #82, #90
// ER Diagram + เหตุผล: docs/ERD-V7.md
// =====================================================

const REVIEW_STATES = ["PENDING", "DIRECTED", "RETURNED", "DONE"];
const HEAD_DECISIONS = ["DIRECTED", "RETURNED"];

async function tableExists(db, table) {
    const [rows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return Number(rows[0].cnt) > 0;
}

async function getColumn(db, table, column) {
    const [rows] = await db.query(
        `SELECT COLUMN_TYPE, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows[0] || null;
}

async function addColumnIfMissing(db, table, column, definition, log) {
    if (await getColumn(db, table, column)) return false;
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    log(`  + Added ${table}.${column}`);
    return true;
}

// ข้ามถ้ามี index ชื่อเดียวกัน หรือมี index อื่นที่ "ขึ้นต้น" ด้วยคอลัมน์ชุดเดียวกันแล้ว
// (กันชนกับ index ที่ Issue อื่น เช่น #90 อาจเพิ่มด้วยชื่อต่างกัน)
async function addIndexIfMissing(db, table, name, columns, log) {
    const [rows] = await db.query(
        `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [table]
    );
    const byIndex = new Map();
    for (const r of rows) {
        if (!byIndex.has(r.INDEX_NAME)) byIndex.set(r.INDEX_NAME, []);
        byIndex.get(r.INDEX_NAME).push(String(r.COLUMN_NAME).toLowerCase());
    }
    if (byIndex.has(name)) return false;
    const wanted = columns.map(c => c.toLowerCase());
    for (const cols of byIndex.values()) {
        if (wanted.every((c, i) => cols[i] === c)) return false;
    }
    await db.query(
        `ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns.map(c => `\`${c}\``).join(", ")})`
    );
    log(`  + Added index ${table}.${name} (${columns.join(", ")})`);
    return true;
}

// RDS ใช้ sql_mode แบบไม่ strict: ค่าที่อยู่นอก ENUM จะถูกเก็บเป็น '' แค่ warning ไม่ error
// แต่ CHECK constraint (MySQL 8.0.16+) ถูกบังคับไม่ว่า sql_mode เป็นอะไร จึงใช้ CHECK กันค่าผิดอีกชั้น
async function addCheckIfMissing(db, table, name, expression, log) {
    const [rows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'CHECK'`,
        [table, name]
    );
    if (Number(rows[0].cnt) > 0) return false;
    await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` CHECK (${expression})`);
    log(`  + Added check ${table}.${name}`);
    return true;
}

async function createAppendOnlyTriggers(db, table, label) {
    await db.query(`DROP TRIGGER IF EXISTS prevent_${table}_update`);
    await db.query(`
        CREATE TRIGGER prevent_${table}_update
        BEFORE UPDATE ON \`${table}\`
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = '${label} records are append-only and cannot be updated.';
        END
    `);
    await db.query(`DROP TRIGGER IF EXISTS prevent_${table}_delete`);
    await db.query(`
        CREATE TRIGGER prevent_${table}_delete
        BEFORE DELETE ON \`${table}\`
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = '${label} records are append-only and cannot be deleted.';
        END
    `);
}

async function runV7Migration(db, log = console.log) {
    log("🧩 V7 migration ...");

    // ชนิดคอลัมน์ user ต้องตรงกับ users.id ของ DB จริงทุกตัว (INT หรือ INT UNSIGNED) ไม่งั้น FK สร้างไม่ได้
    const usersId = await getColumn(db, "users", "id");
    if (!usersId) throw new Error("V7 migration requires existing table users(id)");
    const USER_ID = usersId.COLUMN_TYPE.toUpperCase(); // เช่น "INT" หรือ "INT UNSIGNED"

    // ---------- #78 Role branch_head ----------
    await db.query(
        "INSERT IGNORE INTO roles (name, description) VALUES ('branch_head', 'หัวหน้าสาขา')"
    );

    // ---------- #79 documents: หนังสือราชการ + สถานะขั้นหัวหน้าสาขา ----------
    await addColumnIfMissing(db, "documents", "is_official",
        "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'หนังสือราชการ ต้องผ่านหัวหน้าสาขา (ADR #71)'", log);
    await addColumnIfMissing(db, "documents", "review_state",
        `ENUM(${REVIEW_STATES.map(s => `'${s}'`).join(",")}) NULL DEFAULT NULL
         COMMENT 'NULL = ไม่เข้าขั้นหัวหน้าสาขา; PENDING/DIRECTED/RETURNED/DONE (ADR #71)'`, log);
    await addCheckIfMissing(db, "documents", "chk_doc_is_official", "is_official IN (0, 1)", log);
    await addCheckIfMissing(db, "documents", "chk_doc_review_state",
        `review_state IS NULL OR review_state IN (${REVIEW_STATES.map(s => `'${s}'`).join(", ")})`, log);

    // ---------- #77 document_assignments.seen_at ----------
    await addColumnIfMissing(db, "document_assignments", "seen_at",
        "TIMESTAMP NULL DEFAULT NULL COMMENT 'เวลาที่ผู้รับ (new_assignee_id) เปิดดูครั้งแรก'", log);

    // ---------- #75 document_share_links (ADR #72) ----------
    await db.query(`
        CREATE TABLE IF NOT EXISTS document_share_links (
            id INT AUTO_INCREMENT PRIMARY KEY,
            document_id INT NOT NULL,
            token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 hex ของ token; ไม่เก็บ token ดิบ',
            created_by ${USER_ID} NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            revoked_at TIMESTAMP NULL DEFAULT NULL,
            last_used_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_share_token_hash (token_hash),
            INDEX idx_share_doc (document_id),
            INDEX idx_share_created_by (created_by),
            CONSTRAINT fk_share_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
            CONSTRAINT fk_share_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // non-strict mode: ไม่ใส่ expires_at จะได้ 0000-00-00 แทน error → CHECK บังคับให้หมดอายุหลังเวลาสร้าง
    await addCheckIfMissing(db, "document_share_links", "chk_share_expiry", "expires_at > created_at", log);

    // ---------- #77 / #82 document_pins (ปักดาว) ----------
    await db.query(`
        CREATE TABLE IF NOT EXISTS document_pins (
            user_id ${USER_ID} NOT NULL,
            document_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, document_id),
            INDEX idx_pin_doc (document_id),
            CONSTRAINT fk_pin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            CONSTRAINT fk_pin_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ---------- #79 document_head_reviews (append-only) ----------
    await db.query(`
        CREATE TABLE IF NOT EXISTS document_head_reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            document_id INT NOT NULL,
            head_id ${USER_ID} NOT NULL,
            decision ENUM(${HEAD_DECISIONS.map(s => `'${s}'`).join(",")}) NOT NULL,
            assignee_id ${USER_ID} NULL DEFAULT NULL COMMENT 'ผู้รับคำสั่งการ (กรณี DIRECTED)',
            note TEXT NULL COMMENT 'คำสั่งการ / ข้อความถึงผู้รับ',
            reason TEXT NULL COMMENT 'เหตุผลการส่งกลับ (กรณี RETURNED)',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_head_review_doc (document_id, created_at),
            INDEX idx_head_review_head (head_id),
            INDEX idx_head_review_assignee (assignee_id),
            CONSTRAINT fk_head_review_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
            CONSTRAINT fk_head_review_head FOREIGN KEY (head_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_head_review_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await addCheckIfMissing(db, "document_head_reviews", "chk_head_review_decision",
        `decision IN (${HEAD_DECISIONS.map(s => `'${s}'`).join(", ")})`, log);
    // แบบเดียวกับ document_audit_trails: ห้าม UPDATE/DELETE ตรง ๆ
    // (ลบเอกสารยังทำได้: MySQL ไม่เรียก trigger กับแถวที่ลบผ่าน FK CASCADE)
    await createAppendOnlyTriggers(db, "document_head_reviews", "Head review");

    // ---------- #90 Index สำหรับ Inbox (รวมไว้ที่นี่ชุดเดียว) ----------
    // PREVIOUS_ASSIGNEE_SQL: WHERE a.document_id = d.id AND a.previous_assignee_id = ?
    await addIndexIfMissing(db, "document_assignments", "idx_assign_prev_doc", ["previous_assignee_id", "document_id"], log);
    // seen_at / แถวมอบหมายล่าสุดของผู้รับ: WHERE document_id = ? AND new_assignee_id = ?
    await addIndexIfMissing(db, "document_assignments", "idx_assign_doc_new", ["document_id", "new_assignee_id"], log);
    // didOfficerForward: WHERE document_id = ? AND assigned_by_user_id = ? AND action_type = 'FORWARD'
    await addIndexIfMissing(db, "document_assignments", "idx_assign_doc_by_action", ["document_id", "assigned_by_user_id", "action_type"], log);
    // ORDER BY d.created_at DESC ของหน้า Inbox/ค้นหา
    await addIndexIfMissing(db, "documents", "idx_doc_created_at", ["created_at"], log);
    // คิวหัวหน้าสาขา: WHERE is_official = 1 AND review_state = 'PENDING'
    await addIndexIfMissing(db, "documents", "idx_doc_official_review", ["is_official", "review_state"], log);
    // ทุก request ที่ login: WHERE cognito_sub = ? (เพิ่มเฉพาะเมื่อเป็น VARCHAR/CHAR ที่ index ได้)
    const sub = await getColumn(db, "users", "cognito_sub");
    if (sub && ["varchar", "char"].includes(String(sub.DATA_TYPE).toLowerCase())) {
        await addIndexIfMissing(db, "users", "idx_users_cognito_sub", ["cognito_sub"], log);
    }

    log("  ✓ V7 migration done");
}

module.exports = {
    runV7Migration,
    REVIEW_STATES,
    HEAD_DECISIONS,
    // export helper ไว้ให้ test / migration รอบถัดไปใช้แบบเดียวกัน
    tableExists,
    getColumn,
    addColumnIfMissing,
    addIndexIfMissing,
    addCheckIfMissing
};
