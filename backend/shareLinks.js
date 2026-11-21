// ============================================================================
// Share Link (ADR #72) — แทนโหมด Guest เดิมของ #57
// ============================================================================
// - ผู้ใช้ที่ login แล้วและมีสิทธิ์ "share" สร้างลิงก์อ่านอย่างเดียวของเอกสาร 1 ฉบับ
// - token ดิบคืนให้ผู้สร้างครั้งเดียวตอนสร้าง; DB เก็บแค่ SHA-256 (token_hash)
// - GET /api/shared/:token เปิดดูรายละเอียด + Pre-signed URL อายุสั้น ไม่ต้อง login
// - token ไม่ถูกต้อง / หมดอายุ / ถูกยกเลิก ได้คำตอบเดียวกันทุกกรณี (404) ไม่บอกเหตุผล
// - token ใช้กับ Workflow API ไม่ได้ เพราะ API เหล่านั้นรับเฉพาะ Cognito JWT
// ============================================================================

const crypto = require("crypto");
const path = require("path");
const express = require("express");

const TOKEN_BYTES = 32;
// randomBytes(32) → base64url ยาว 43 ตัวเสมอ ตรวจรูปแบบก่อนแตะ DB
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const DEFAULT_EXPIRES_IN_HOURS = 72;
const MIN_EXPIRES_IN_HOURS = 1;
const MAX_EXPIRES_IN_HOURS = 24 * 30;

// อายุ Pre-signed URL ของไฟล์ที่เปิดผ่านลิงก์แชร์ (วินาที)
const SHARED_FILE_URL_TTL_SECONDS = 120;

const PREVIEWABLE_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

const UNAVAILABLE = Object.freeze({
    error: "Share link is not available",
    code: "SHARE_LINK_UNAVAILABLE"
});

function generateToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function isWellFormedToken(token) {
    return typeof token === "string" && TOKEN_PATTERN.test(token);
}

function parsePositiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

// undefined/null → ค่าเริ่มต้น; ค่าอื่นต้องเป็นจำนวนเต็มชั่วโมงในช่วงที่กำหนด
function parseExpiresInHours(value) {
    if (value === undefined || value === null || value === "") return DEFAULT_EXPIRES_IN_HOURS;
    // รับเฉพาะตัวเลขหรือสตริงตัวเลข (Number(true) = 1 จึงต้องกันชนิดอื่นออก)
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
    const hours = Number(value);
    if (!Number.isInteger(hours) || hours < MIN_EXPIRES_IN_HOURS || hours > MAX_EXPIRES_IN_HOURS) return null;
    return hours;
}

function shareLinkStatus(row, now = new Date()) {
    if (row.revoked_at) return "revoked";
    if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
    return "active";
}

// ไม่ส่ง token_hash ออกไปทาง API ใด ๆ
function toPublicLink(row) {
    return {
        id: row.id,
        document_id: row.document_id,
        created_by: row.created_by,
        created_by_name: row.created_by_name ?? null,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at ?? null,
        last_used_at: row.last_used_at ?? null,
        created_at: row.created_at,
        status: shareLinkStatus(row)
    };
}

// ใช้ IP ขวาสุดของ X-Forwarded-For (ค่าที่ API Gateway / Function URL ต่อท้ายเอง)
// เพราะค่าซ้ายสุดผู้เรียกปลอมได้
function clientIp(req) {
    const forwarded = String(req.headers?.["x-forwarded-for"] || "")
        .split(",").map(part => part.trim()).filter(Boolean);
    return forwarded[forwarded.length - 1] || req.socket?.remoteAddress || "unknown";
}

// Rate limit แบบ fixed window ในหน่วยความจำ (ต่อ instance)
// บน Lambda แต่ละ instance นับแยกกัน จึงเป็นชั้นป้องกันเพิ่มเติมจาก throttling ของ API Gateway
function createRateLimiter({ windowMs = 60_000, max = 30, maxKeys = 10_000, now = () => Date.now() } = {}) {
    const hits = new Map();

    function sweep(currentTime) {
        for (const [key, entry] of hits) {
            if (entry.resetAt <= currentTime) hits.delete(key);
        }
    }

    const middleware = (req, res, next) => {
        const currentTime = now();
        const key = clientIp(req);
        let entry = hits.get(key);

        if (!entry || entry.resetAt <= currentTime) {
            if (hits.size >= maxKeys) sweep(currentTime);
            // ยังเต็มหลัง sweep: ปฏิเสธแทนการขยาย Map ไม่จำกัด
            if (hits.size >= maxKeys) {
                res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
                return res.status(429).json({ error: "Too many requests", code: "RATE_LIMITED" });
            }
            entry = { count: 0, resetAt: currentTime + windowMs };
            hits.set(key, entry);
        }

        entry.count += 1;
        const remaining = Math.max(0, max - entry.count);
        res.setHeader("RateLimit-Limit", String(max));
        res.setHeader("RateLimit-Remaining", String(remaining));
        res.setHeader("RateLimit-Reset", String(Math.ceil((entry.resetAt - currentTime) / 1000)));

        if (entry.count > max) {
            res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - currentTime) / 1000)));
            return res.status(429).json({ error: "Too many requests", code: "RATE_LIMITED" });
        }
        return next();
    };

    middleware.reset = () => hits.clear();
    return middleware;
}

function noStore(req, res, next) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Referrer-Policy", "no-referrer");
    return next();
}

function extractFileNameFromKey(fileKey) {
    if (!fileKey) return null;
    const lastPart = String(fileKey).split("/").pop();
    const dashIdx = lastPart.indexOf("-");
    return dashIdx !== -1 ? lastPart.substring(dashIdx + 1) : lastPart;
}

/**
 * @param {Object} deps
 * @param {any} deps.pool mysql2 pool
 * @param {Function} deps.requireAuth middleware ตรวจ Cognito JWT
 * @param {Function} deps.loadUserRole middleware โหลด user/role จาก DB
 * @param {Function} deps.checkDocumentAccess (req, document, action, db) => { allowed }
 * @param {Object} deps.s3 โมดูล s3 (อ่าน createDownloadUrl ตอนเรียก เพื่อให้ mock ได้)
 * @param {Object} deps.audit { AUDIT_EVENTS, recordAuditEvent, extractServerActor }
 * @param {Function} [deps.rateLimiter] middleware สำหรับ /api/shared/*
 */
function createShareLinkRouter({ pool, requireAuth, loadUserRole, checkDocumentAccess, s3, audit, rateLimiter }) {
    const router = express.Router();
    const { AUDIT_EVENTS, recordAuditEvent, extractServerActor } = audit;
    const limiter = rateLimiter || createRateLimiter({
        windowMs: Number(process.env.SHARE_LINK_RATE_LIMIT_WINDOW_MS) || 60_000,
        max: Number(process.env.SHARE_LINK_RATE_LIMIT_MAX) || 30
    });

    async function loadDocument(documentId, db = pool) {
        const [rows] = await db.query(
            "SELECT id, assignee_id, owner_id, status FROM documents WHERE id = ? LIMIT 1",
            [documentId]
        );
        return rows[0] || null;
    }

    async function authorizeShare(req, res, documentId, db = pool) {
        const document = await loadDocument(documentId, db);
        if (!document) {
            res.status(404).json({ error: "Document not found", code: "DOCUMENT_NOT_FOUND" });
            return null;
        }
        const { allowed } = await checkDocumentAccess(req, document, "share", db);
        if (!allowed) {
            res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
            return null;
        }
        return document;
    }

    // ---------- สร้างลิงก์ ----------
    router.post("/api/documents/:id/share-links", noStore, requireAuth, loadUserRole, async (req, res) => {
        const documentId = parsePositiveInt(req.params.id);
        if (!documentId) return res.status(400).json({ error: "Invalid document id", code: "INVALID_DOCUMENT_ID" });

        const expiresInHours = parseExpiresInHours(req.body?.expires_in_hours);
        if (expiresInHours === null) {
            return res.status(400).json({
                error: `expires_in_hours must be an integer between ${MIN_EXPIRES_IN_HOURS} and ${MAX_EXPIRES_IN_HOURS}`,
                code: "INVALID_EXPIRY"
            });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const document = await authorizeShare(req, res, documentId, connection);
            if (!document) {
                await connection.rollback();
                return undefined;
            }

            const token = generateToken();
            const [result] = await connection.query(
                `INSERT INTO document_share_links (document_id, token_hash, created_by, expires_at, created_at)
                 VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR), CURRENT_TIMESTAMP)`,
                [documentId, hashToken(token), req.userId, expiresInHours]
            );
            const [[link]] = await connection.query(
                `SELECT id, document_id, created_by, expires_at, revoked_at, last_used_at, created_at
                 FROM document_share_links WHERE id = ?`,
                [result.insertId]
            );

            const actor = extractServerActor(req);
            await recordAuditEvent({
                documentId,
                actorUserId: actor.actorUserId,
                actorUsername: actor.actorUsername,
                actorRole: actor.actorRole,
                eventType: AUDIT_EVENTS.SHARE_LINK_CREATE,
                afterState: { share_link_id: link.id, expires_at: link.expires_at },
                details: { expires_in_hours: expiresInHours },
                ipAddress: actor.ipAddress,
                connection
            });

            await connection.commit();
            // token ดิบออกจาก server ครั้งเดียวตรงนี้ และไม่ถูกบันทึกที่ใดอีก
            return res.status(201).json({ ...toPublicLink(link), token });
        } catch (error) {
            await connection.rollback().catch(() => {});
            console.error("Create share link error:", error.message);
            return res.status(500).json({ error: "Failed to create share link", code: "SHARE_LINK_CREATE_FAILED" });
        } finally {
            connection.release();
        }
    });

    // ---------- รายการลิงก์ของเอกสาร ----------
    router.get("/api/documents/:id/share-links", noStore, requireAuth, loadUserRole, async (req, res) => {
        const documentId = parsePositiveInt(req.params.id);
        if (!documentId) return res.status(400).json({ error: "Invalid document id", code: "INVALID_DOCUMENT_ID" });

        try {
            if (!(await authorizeShare(req, res, documentId))) return undefined;
            const [rows] = await pool.query(
                `SELECT s.id, s.document_id, s.created_by, COALESCE(u.full_name, u.username) AS created_by_name,
                        s.expires_at, s.revoked_at, s.last_used_at, s.created_at
                 FROM document_share_links s
                 LEFT JOIN users u ON u.id = s.created_by
                 WHERE s.document_id = ?
                 ORDER BY s.created_at DESC, s.id DESC`,
                [documentId]
            );
            return res.json(rows.map(toPublicLink));
        } catch (error) {
            console.error("List share links error:", error.message);
            return res.status(500).json({ error: "Failed to list share links", code: "SHARE_LINK_LIST_FAILED" });
        }
    });

    // ---------- ยกเลิกลิงก์ ----------
    router.delete("/api/share-links/:id", noStore, requireAuth, loadUserRole, async (req, res) => {
        const linkId = parsePositiveInt(req.params.id);
        if (!linkId) return res.status(400).json({ error: "Invalid share link id", code: "INVALID_SHARE_LINK_ID" });

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [[link]] = await connection.query(
                `SELECT id, document_id, created_by, expires_at, revoked_at, last_used_at, created_at
                 FROM document_share_links WHERE id = ? FOR UPDATE`,
                [linkId]
            );
            if (!link) {
                await connection.rollback();
                return res.status(404).json({ error: "Share link not found", code: "SHARE_LINK_NOT_FOUND" });
            }
            if (!(await authorizeShare(req, res, link.document_id, connection))) {
                await connection.rollback();
                return undefined;
            }

            // ยกเลิกซ้ำ = สำเร็จ (idempotent) และไม่บันทึก Audit ซ้ำ
            if (link.revoked_at) {
                await connection.rollback();
                return res.json(toPublicLink(link));
            }

            await connection.query(
                "UPDATE document_share_links SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL",
                [linkId]
            );
            const [[updated]] = await connection.query(
                `SELECT id, document_id, created_by, expires_at, revoked_at, last_used_at, created_at
                 FROM document_share_links WHERE id = ?`,
                [linkId]
            );

            const actor = extractServerActor(req);
            await recordAuditEvent({
                documentId: link.document_id,
                actorUserId: actor.actorUserId,
                actorUsername: actor.actorUsername,
                actorRole: actor.actorRole,
                eventType: AUDIT_EVENTS.SHARE_LINK_REVOKE,
                beforeState: { share_link_id: link.id, revoked_at: null },
                afterState: { share_link_id: link.id, revoked_at: updated.revoked_at },
                ipAddress: actor.ipAddress,
                connection
            });

            await connection.commit();
            return res.json(toPublicLink(updated));
        } catch (error) {
            await connection.rollback().catch(() => {});
            console.error("Revoke share link error:", error.message);
            return res.status(500).json({ error: "Failed to revoke share link", code: "SHARE_LINK_REVOKE_FAILED" });
        } finally {
            connection.release();
        }
    });

    // ---------- เปิดลิงก์ (ไม่ต้อง login, อ่านอย่างเดียว) ----------
    router.use("/api/shared", noStore, limiter);

    router.get("/api/shared/:token", async (req, res) => {
        const { token } = req.params;
        // รูปแบบผิด → ตอบเหมือน token หมดอายุ/ถูกยกเลิก
        if (!isWellFormedToken(token)) return res.status(404).json(UNAVAILABLE);

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            // เช็กหมดอายุ/ยกเลิกใน SQL เพื่อใช้นาฬิกาเดียวกับตอนสร้าง (DATE_ADD CURRENT_TIMESTAMP)
            const [rows] = await connection.query(
                `SELECT s.id AS share_link_id, s.expires_at,
                        d.id AS document_id, d.reference_no, d.document_number, d.subject,
                        d.document_type, d.receive_date, d.file_key,
                        f.file_name, f.file_size, f.mime_type
                 FROM document_share_links s
                 JOIN documents d ON d.id = s.document_id
                 LEFT JOIN document_files f ON f.document_id = d.id
                 WHERE s.token_hash = ?
                   AND s.revoked_at IS NULL
                   AND s.expires_at > CURRENT_TIMESTAMP
                 ORDER BY f.id DESC
                 LIMIT 1`,
                [hashToken(token)]
            );
            const row = rows[0];
            if (!row) {
                await connection.rollback();
                return res.status(404).json(UNAVAILABLE);
            }

            await connection.query(
                "UPDATE document_share_links SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
                [row.share_link_id]
            );
            await recordAuditEvent({
                documentId: row.document_id,
                actorUserId: `share_link:${row.share_link_id}`,
                actorUsername: null,
                actorRole: "share_link",
                eventType: AUDIT_EVENTS.SHARE_LINK_OPEN,
                details: { share_link_id: row.share_link_id },
                ipAddress: clientIp(req),
                connection
            });
            await connection.commit();

            const fileName = row.file_name || extractFileNameFromKey(row.file_key);
            const extension = fileName ? path.extname(fileName).toLowerCase() : "";
            const canPreview = PREVIEWABLE_EXTENSIONS.includes(extension);
            const mimeType = row.mime_type || s3.getMimeTypeByExtension(fileName || row.file_key);

            let previewUrl = null;
            let downloadUrl = null;
            if (row.file_key) {
                try {
                    const options = { fileName, contentType: mimeType, expiresIn: SHARED_FILE_URL_TTL_SECONDS };
                    if (canPreview) previewUrl = await s3.createDownloadUrl(row.file_key, { ...options, disposition: "inline" });
                    downloadUrl = await s3.createDownloadUrl(row.file_key, { ...options, disposition: "attachment" });
                } catch (error) {
                    console.warn("Shared link presign failed:", error.message);
                    previewUrl = null;
                    downloadUrl = null;
                }
            }

            // ส่งเฉพาะข้อมูลที่จำเป็นต่อการอ่าน ไม่มี id ภายใน, ผู้รับผิดชอบ, สถานะ workflow หรือ file_key
            return res.json({
                document: {
                    reference_no: row.reference_no,
                    document_number: row.document_number,
                    subject: row.subject,
                    document_type: row.document_type,
                    receive_date: row.receive_date,
                    file_name: fileName,
                    file_size: row.file_size ?? null,
                    mime_type: fileName ? mimeType : null,
                    can_preview: Boolean(row.file_key) && canPreview
                },
                link_expires_at: row.expires_at,
                preview_url: previewUrl,
                download_url: downloadUrl,
                url_expires_in: SHARED_FILE_URL_TTL_SECONDS
            });
        } catch (error) {
            if (connection) await connection.rollback().catch(() => {});
            console.error("Open share link error:", error.message);
            return res.status(500).json({ error: "Failed to open share link", code: "SHARE_LINK_OPEN_FAILED" });
        } finally {
            if (connection) connection.release();
        }
    });

    // วิธีอื่น/ path ย่อยของ /api/shared ไม่มี (ลิงก์อ่านอย่างเดียว)
    router.use("/api/shared", (req, res) => res.status(404).json(UNAVAILABLE));

    router.limiter = limiter;
    return router;
}

module.exports = {
    createShareLinkRouter,
    createRateLimiter,
    generateToken,
    hashToken,
    isWellFormedToken,
    parseExpiresInHours,
    shareLinkStatus,
    clientIp,
    DEFAULT_EXPIRES_IN_HOURS,
    MAX_EXPIRES_IN_HOURS,
    SHARED_FILE_URL_TTL_SECONDS
};
