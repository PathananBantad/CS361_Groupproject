// Integration test ของ Migration V7 — ต้องมี MySQL ทดสอบ (ไม่ใช่ RDS จริง)
// รัน:  MIGRATION_TEST_DB_URL=mysql://root@127.0.0.1:3399 node --test test/migrationV7.test.js
// ไม่ตั้งตัวแปร = skip (npm test ปกติไม่ต่อ DB)
// test สร้าง DB ชื่อ v7test_* ของตัวเอง แล้วลบทิ้งตอนจบ
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const { runMigration } = require("../migrate");
const { buildInboxOrderBy, compareInboxPriority } = require("../inboxPriority");

const URL = process.env.MIGRATION_TEST_DB_URL;
const skip = URL ? false : "ตั้ง MIGRATION_TEST_DB_URL เพื่อรัน integration test";
const suffix = Date.now();
const EMPTY_DB = `v7test_empty_${suffix}`;
const LEGACY_DB = `v7test_legacy_${suffix}`;
const quiet = () => {};
let admin;

// ค่าเริ่มต้น = sql_mode ของ RDS จริง (MySQL 8.4, ไม่ strict) เพื่อให้ผลเทสต์ตรงกับ production
// ทดสอบแบบ strict ได้ด้วย MIGRATION_TEST_SQL_MODE=STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION
const SQL_MODE = process.env.MIGRATION_TEST_SQL_MODE || "IGNORE_SPACE,NO_ENGINE_SUBSTITUTION";
const rejectedValue = e => ["ER_CHECK_CONSTRAINT_VIOLATED", "WARN_DATA_TRUNCATED", "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD", "ER_NO_DEFAULT_FOR_FIELD"].includes(e.code);

async function connect(db) {
    const c = await mysql.createConnection(`${URL}/${db}?charset=utf8mb4`);
    await c.query("SET SESSION sql_mode = ?", [SQL_MODE]);
    return c;
}

// สแนปช็อต schema: คอลัมน์ + index + trigger (ใช้เทียบว่ารันซ้ำแล้วไม่เปลี่ยน / ไม่มีคอลัมน์เดิมหาย)
async function schemaSnapshot(c) {
    const [cols] = await c.query(`SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_DEFAULT d
        FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY t, c`);
    const [idx] = await c.query(`SELECT TABLE_NAME t, INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
        FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() GROUP BY t, i ORDER BY t, i`);
    const [trg] = await c.query(`SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY 1`);
    return { cols, idx, trg: trg.map(r => r.TRIGGER_NAME) };
}

async function counts(c) {
    const out = {};
    for (const t of ["users", "users_roles", "roles", "documents", "document_files", "document_assignments",
        "document_audit_trails", "document_status_logs", "document_types", "channels"]) {
        const [[r]] = await c.query(`SELECT COUNT(*) n FROM ${t}`);
        out[t] = Number(r.n);
    }
    return out;
}

// Query เดิมจาก server.js (GET /api/documents/search ของอาจารย์) — ต้องให้ผลเหมือนเดิมหลัง migrate
const LEGACY_INBOX_SQL = `
    SELECT d.id, d.reference_no, assignee.username AS assignee_username, f.file_name
    FROM documents d
    LEFT JOIN document_files f ON d.id = f.document_id
    LEFT JOIN users assignee ON assignee.id = d.assignee_id
    LEFT JOIN users owner ON owner.id = d.owner_id
    WHERE 1 = 1 AND (d.assignee_id = ? OR EXISTS (
        SELECT 1 FROM document_assignments a
        WHERE a.document_id = d.id AND a.previous_assignee_id = ?))
    ORDER BY d.created_at DESC, d.id DESC`;

// สร้าง DB "ข้อมูลเดิม" ตามรูปแบบก่อน V7 (init_schema + users ตามที่ server.js ใช้ + trigger audit)
async function seedLegacy(c) {
    const ddl = [
        `CREATE TABLE roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL UNIQUE,
            description VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE, email VARCHAR(150) NULL,
            full_name VARCHAR(150) NOT NULL, password VARCHAR(255) NULL, role VARCHAR(50) NULL, cognito_sub VARCHAR(100) NULL,
            is_active TINYINT(1) NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE users_roles (user_id INT NOT NULL, role_id INT NOT NULL, PRIMARY KEY (user_id, role_id),
            CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE) ENGINE=InnoDB`,
        `CREATE TABLE channels (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(50) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE document_types (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE documents (id INT AUTO_INCREMENT PRIMARY KEY, reference_no VARCHAR(50) NOT NULL UNIQUE, document_number VARCHAR(100) NULL,
            subject VARCHAR(255) NOT NULL, document_type VARCHAR(100) NOT NULL, sender_name VARCHAR(150) NOT NULL,
            sender_department VARCHAR(150) NULL, sender_contact VARCHAR(150) NULL, receiver_name VARCHAR(150) NULL,
            sent_date DATE NULL, receive_date DATE NULL, deadline DATE NULL, remarks TEXT NULL, receiving_channel VARCHAR(100) NOT NULL,
            status VARCHAR(50) DEFAULT 'Received', file_key VARCHAR(255) NULL, owner_id INT NULL, assignee_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_doc_assignee (assignee_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE document_files (id INT AUTO_INCREMENT PRIMARY KEY, document_id INT NOT NULL, file_name VARCHAR(255) NOT NULL,
            file_path TEXT NOT NULL, file_size INT NULL, mime_type VARCHAR(100) NULL, uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_file_doc (document_id), CONSTRAINT fk_file_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE document_status_logs (id INT AUTO_INCREMENT PRIMARY KEY, document_id INT NOT NULL, old_status VARCHAR(50) NOT NULL,
            new_status VARCHAR(50) NOT NULL, changed_by VARCHAR(100) NULL, changed_by_user_id INT NULL, remarks TEXT NULL,
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_doc_id (document_id),
            CONSTRAINT fk_status_log_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE document_assignments (id INT AUTO_INCREMENT PRIMARY KEY, document_id INT NOT NULL, assigned_by_user_id VARCHAR(100) NOT NULL,
            assigned_by_username VARCHAR(100) NULL, previous_assignee_id VARCHAR(100) NULL, new_assignee_id VARCHAR(100) NOT NULL,
            action_type VARCHAR(50) NOT NULL, remarks TEXT NULL, assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_assign_doc (document_id), INDEX idx_assign_new (new_assignee_id),
            CONSTRAINT fk_assign_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE document_audit_trails (id INT AUTO_INCREMENT PRIMARY KEY, document_id INT NOT NULL, actor_user_id VARCHAR(100) NOT NULL,
            actor_username VARCHAR(100) NULL, actor_role VARCHAR(50) NULL, event_type VARCHAR(50) NOT NULL, before_state JSON NULL,
            after_state JSON NULL, details JSON NULL, ip_address VARCHAR(45) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_audit_doc (document_id), CONSTRAINT fk_audit_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TRIGGER prevent_audit_trail_update BEFORE UPDATE ON document_audit_trails FOR EACH ROW
            BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit trail records are immutable and cannot be updated.'; END`
    ];
    for (const s of ddl) await c.query(s);

    await c.query(`INSERT INTO roles (name, description) VALUES ('document_officer','เจ้าหน้าที่รับเอกสาร (เดิม)'),
        ('faculty_staff','อาจารย์ / เจ้าหน้าที่'),('responsible_person','ผู้รับผิดชอบเรื่อง'),('admin','ผู้ดูแลระบบ'),('executive','ผู้บริหาร')`);
    await c.query(`INSERT INTO users (username, full_name, password, role, cognito_sub) VALUES
        ('officer1','เจ้าหน้าที่ 1','COGNITO_AUTH','document_officer','sub-officer'),
        ('teacher1','อาจารย์ 1','COGNITO_AUTH','faculty_staff','sub-t1'),
        ('teacher2','อาจารย์ 2','COGNITO_AUTH','faculty_staff','sub-t2')`);
    await c.query(`INSERT INTO users_roles (user_id, role_id) SELECT u.id, r.id FROM users u JOIN roles r ON r.name = u.role`);
    await c.query(`INSERT INTO channels (code, name) VALUES ('EMAIL','อีเมล')`);
    // ข้อมูลเดิมที่มี document_types ซ้ำอยู่แล้ว (ผลจาก INSERT IGNORE เดิม) — migration ต้องไม่พัง
    await c.query(`INSERT INTO document_types (name) VALUES ('เอกสารขออนุมัติ'),('เอกสารขออนุมัติ')`);
    await c.query(`INSERT INTO documents (reference_no, subject, document_type, sender_name, receiving_channel, deadline, owner_id, assignee_id, created_at) VALUES
        ('REF-001','ขออนุมัติโครงการ','เอกสารขออนุมัติ','คณะ','EMAIL','2026-11-20',1,2,'2026-11-01 09:00:00'),
        ('REF-002','ประชาสัมพันธ์','เอกสารประชาสัมพันธ์','คณะ','EMAIL',NULL,1,3,'2026-11-02 09:00:00'),
        ('REF-003','มอบหมายงาน','เอกสารมอบหมายงาน','คณะ','EMAIL','2026-11-10',1,2,'2026-11-03 09:00:00')`);
    await c.query(`INSERT INTO document_files (document_id, file_name, file_path) VALUES (1,'a.pdf','k/a.pdf'),(1,'b.pdf','k/b.pdf')`);
    await c.query(`INSERT INTO document_assignments (document_id, assigned_by_user_id, previous_assignee_id, new_assignee_id, action_type) VALUES
        (1,'1',NULL,'2','ASSIGN'),(2,'1','2','3','FORWARD'),(3,'1',NULL,'2','ASSIGN')`);
    await c.query(`INSERT INTO document_audit_trails (document_id, actor_user_id, event_type) VALUES (1,'1','DOCUMENT_CREATE'),(2,'1','FORWARD')`);
}

before(async () => {
    if (skip) return;
    admin = await mysql.createConnection(URL);
    await admin.query(`CREATE DATABASE ${EMPTY_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`CREATE DATABASE ${LEGACY_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
});

after(async () => {
    if (skip) return;
    await admin.query(`DROP DATABASE IF EXISTS ${EMPTY_DB}`);
    await admin.query(`DROP DATABASE IF EXISTS ${LEGACY_DB}`);
    await admin.end();
});

test("DB ว่าง: migrate สำเร็จ และรันซ้ำแล้ว schema/ข้อมูล seed ไม่เปลี่ยน", { skip }, async () => {
    const c = await connect(EMPTY_DB);
    try {
        await runMigration(c, quiet);
        const first = await schemaSnapshot(c);
        const firstCounts = await counts(c);
        await runMigration(c, quiet);
        await runMigration(c, quiet);
        assert.deepEqual(await schemaSnapshot(c), first, "schema ต้องเหมือนเดิมหลังรันซ้ำ");
        assert.deepEqual(await counts(c), firstCounts, "seed ต้องไม่ซ้ำ");
        assert.equal(firstCounts.document_types, 7);

        const tables = new Set(first.cols.map(r => r.t));
        for (const t of ["document_share_links", "document_pins", "document_head_reviews", "users", "users_roles"]) {
            assert.ok(tables.has(t), `ต้องมีตาราง ${t}`);
        }
        const [roles] = await c.query("SELECT name FROM roles ORDER BY name");
        assert.deepEqual(roles.map(r => r.name),
            ["admin", "branch_head", "document_officer", "executive", "faculty_staff", "responsible_person"]);
        assert.ok(first.trg.includes("prevent_document_head_reviews_update"));
        assert.ok(first.trg.includes("prevent_document_head_reviews_delete"));
    } finally { await c.end(); }
});

test("DB ที่มีข้อมูลเดิม: ไม่มีคอลัมน์เดิมหาย/เปลี่ยน, ข้อมูลครบ, query เดิมให้ผลเหมือนเดิม", { skip }, async () => {
    const c = await connect(LEGACY_DB);
    try {
        await seedLegacy(c);
        const beforeSchema = await schemaSnapshot(c);
        const beforeCounts = await counts(c);
        const [beforeInbox] = await c.query(LEGACY_INBOX_SQL, [2, "2"]);
        const [[beforeRoleDesc]] = await c.query("SELECT description FROM roles WHERE name = 'document_officer'");

        await runMigration(c, quiet);
        const once = await schemaSnapshot(c);
        await runMigration(c, quiet);
        assert.deepEqual(await schemaSnapshot(c), once, "รันซ้ำบน DB เดิมต้องไม่เปลี่ยน schema");

        // ไม่มี Drop / Rename / Modify column เดิม
        const key = r => `${r.t}.${r.c}`;
        const afterCols = new Map(once.cols.map(r => [key(r), r]));
        for (const col of beforeSchema.cols) {
            assert.deepEqual(afterCols.get(key(col)), col, `คอลัมน์เดิม ${key(col)} ต้องอยู่ครบและไม่เปลี่ยน`);
        }
        for (const ix of beforeSchema.idx) {
            assert.ok(once.idx.some(i => i.t === ix.t && i.i === ix.i && i.cols === ix.cols), `index เดิม ${ix.t}.${ix.i}`);
        }

        // ข้อมูลเดิมครบ (ตารางเดิมเพิ่มได้เฉพาะ seed ที่ขาด: role ใหม่ และ document_types ที่ยังไม่มี)
        const afterCounts = await counts(c);
        for (const t of ["users", "users_roles", "documents", "document_files", "document_assignments", "document_audit_trails", "channels"]) {
            assert.equal(afterCounts[t], beforeCounts[t] + (t === "channels" ? 1 : 0), t);
        }
        assert.equal(afterCounts.roles, beforeCounts.roles + 1, "เพิ่มเฉพาะ branch_head");
        assert.equal(afterCounts.document_types, beforeCounts.document_types + 6, "ไม่เพิ่ม 'เอกสารขออนุมัติ' ซ้ำ");
        const [[roleDesc]] = await c.query("SELECT description FROM roles WHERE name = 'document_officer'");
        assert.equal(roleDesc.description, beforeRoleDesc.description, "ไม่ทับ description เดิม");

        const [afterInbox] = await c.query(LEGACY_INBOX_SQL, [2, "2"]);
        assert.deepEqual(afterInbox, beforeInbox, "query Inbox เดิมต้องให้ผลเหมือนเดิม");

        // ค่า default ของเอกสารเดิม = ไม่ใช่หนังสือราชการ และไม่อยู่ในขั้นหัวหน้าสาขา
        const [docs] = await c.query("SELECT is_official, review_state FROM documents");
        assert.ok(docs.every(d => d.is_official === 0 && d.review_state === null));
        const [seen] = await c.query("SELECT seen_at FROM document_assignments");
        assert.ok(seen.every(r => r.seen_at === null));

        // trigger audit trail เดิม (UPDATE) ยังทำงาน และ DELETE ถูกเติมให้ครบ
        await assert.rejects(c.query("UPDATE document_audit_trails SET actor_username = 'x' WHERE id = 1"), /immutable/);
        await assert.rejects(c.query("DELETE FROM document_audit_trails WHERE id = 1"), /immutable/);
    } finally { await c.end(); }
});

test("Constraint ของตาราง V7: กรณีที่ต้องผ่านและต้องถูกปฏิเสธ", { skip }, async () => {
    const c = await connect(LEGACY_DB); // ต่อจาก test ก่อนหน้า (migrate แล้ว)
    try {
        const hash = "a".repeat(64);
        await c.query(`INSERT INTO document_share_links (document_id, token_hash, created_by, expires_at) VALUES (1, ?, 1, '2026-12-01 00:00:00')`, [hash]);
        await assert.rejects(c.query(`INSERT INTO document_share_links (document_id, token_hash, created_by, expires_at) VALUES (2, ?, 1, '2026-12-01 00:00:00')`, [hash]),
            e => e.code === "ER_DUP_ENTRY", "token_hash ต้อง unique");
        await assert.rejects(c.query(`INSERT INTO document_share_links (document_id, token_hash, created_by) VALUES (1, ?, 1)`, ["b".repeat(64)]),
            rejectedValue, "expires_at บังคับ");
        await assert.rejects(c.query(`INSERT INTO document_share_links (document_id, token_hash, created_by, expires_at) VALUES (1, ?, 1, '2020-01-01')`, ["e".repeat(64)]),
            rejectedValue, "expires_at ต้องอยู่หลังเวลาสร้าง");
        await assert.rejects(c.query(`INSERT INTO document_share_links (document_id, token_hash, created_by, expires_at) VALUES (999, ?, 1, '2026-12-01')`, ["c".repeat(64)]),
            e => e.code === "ER_NO_REFERENCED_ROW_2", "document ต้องมีอยู่จริง");
        await assert.rejects(c.query(`INSERT INTO document_share_links (document_id, token_hash, created_by, expires_at) VALUES (1, ?, 999, '2026-12-01')`, ["d".repeat(64)]),
            e => e.code === "ER_NO_REFERENCED_ROW_2", "created_by ต้องเป็น user จริง");
        await c.query("UPDATE document_share_links SET revoked_at = NOW(), last_used_at = NOW() WHERE token_hash = ?", [hash]);

        await c.query("INSERT INTO document_pins (user_id, document_id) VALUES (2, 1)");
        await assert.rejects(c.query("INSERT INTO document_pins (user_id, document_id) VALUES (2, 1)"), e => e.code === "ER_DUP_ENTRY", "ปักดาวซ้ำไม่ได้");

        await c.query("UPDATE documents SET is_official = 1, review_state = 'PENDING' WHERE id = 3");
        await assert.rejects(c.query("UPDATE documents SET review_state = 'APPROVED' WHERE id = 3"), rejectedValue, "review_state นอก enum");
        await assert.rejects(c.query("UPDATE documents SET is_official = 2 WHERE id = 3"), rejectedValue, "is_official มีแค่ 0/1");
        const [[st]] = await c.query("SELECT review_state FROM documents WHERE id = 3");
        assert.equal(st.review_state, "PENDING", "ค่าเดิมไม่ถูกเขียนทับเป็น ''");

        await c.query("INSERT INTO document_head_reviews (document_id, head_id, decision, assignee_id, note) VALUES (3, 1, 'DIRECTED', 2, 'ดำเนินการ')");
        await c.query("INSERT INTO document_head_reviews (document_id, head_id, decision, reason) VALUES (3, 1, 'RETURNED', 'ข้อมูลไม่ครบ')");
        await assert.rejects(c.query("INSERT INTO document_head_reviews (document_id, head_id, decision) VALUES (3, 1, 'DONE')"),
            rejectedValue, "decision มีแค่ DIRECTED / RETURNED");
        await assert.rejects(c.query("UPDATE document_head_reviews SET note = 'แก้' WHERE document_id = 3"), /append-only/);
        await assert.rejects(c.query("DELETE FROM document_head_reviews WHERE document_id = 3"), /append-only/);

        await c.query("UPDATE document_assignments SET seen_at = NOW() WHERE document_id = 1 AND new_assignee_id = '2'");

        // ลบเอกสารแบบที่ server.js ทำ (ลบลูกเดิมก่อนแล้วลบ documents) ยังทำได้ และตาราง V7 ถูกลบตาม CASCADE
        await c.query("DELETE FROM document_assignments WHERE document_id = 3");
        await c.query("DELETE FROM documents WHERE id = 3");
        const [[left]] = await c.query("SELECT COUNT(*) n FROM document_head_reviews WHERE document_id = 3");
        assert.equal(Number(left.n), 0);
    } finally { await c.end(); }
});

test("สูตร Priority ฝั่ง SQL ให้ลำดับเดียวกับ compareInboxPriority และไม่ทำให้แถวซ้ำ", { skip }, async () => {
    const c = await connect(LEGACY_DB);
    try {
        const viewer = 2;
        const { sql: orderBy, params } = buildInboxOrderBy({ pinnedExpr: "p.user_id IS NOT NULL", seenExpr: "a.seen_at" });
        // แถวมอบหมายล่าสุดของผู้ดูต่อเอกสาร (กัน JOIN หลายแถว #90)
        const sql = `
            SELECT d.id, d.document_type, d.deadline, d.created_at, a.seen_at, (p.user_id IS NOT NULL) AS is_pinned
            FROM documents d
            LEFT JOIN document_pins p ON p.document_id = d.id AND p.user_id = ?
            LEFT JOIN document_assignments a ON a.id = (
                SELECT MAX(a2.id) FROM document_assignments a2
                WHERE a2.document_id = d.id AND a2.new_assignee_id = ?)
            WHERE d.assignee_id = ? OR EXISTS (SELECT 1 FROM document_assignments x WHERE x.document_id = d.id AND x.previous_assignee_id = ?)
            ${orderBy}`;
        const [rows] = await c.query(sql, [viewer, String(viewer), viewer, String(viewer), ...params]);
        const ids = rows.map(r => r.id);
        assert.equal(new Set(ids).size, ids.length, "ไม่มีเอกสารซ้ำ");
        assert.deepEqual(ids, [...rows].sort(compareInboxPriority).map(r => r.id));
        assert.equal(ids[0], 1, "เอกสารที่ปักดาวอยู่บนสุด");
    } finally { await c.end(); }
});
