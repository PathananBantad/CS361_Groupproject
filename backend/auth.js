
const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("./db");

const router = express.Router();

// Login
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !password
        ) {
            return res.status(400).json({
                ok: false,
                message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"
            });
        }

        const [users] = await pool.query(
            `SELECT id, username, password, role
             FROM users
             WHERE username = ?
             LIMIT 1`,
            [username.trim()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                ok: false,
                message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
            });
        }

        const user = users[0];
        const storedPassword = user.password;

        let passwordMatches = false;

        // รองรับ bcrypt hash ที่มีอยู่แล้ว
        if (
            typeof storedPassword === "string" &&
            /^\$2[aby]\$/.test(storedPassword)
        ) {
            passwordMatches = await bcrypt.compare(
                password,
                storedPassword
            );
        } else {
            // รองรับรหัสผ่านเดิมที่ยังไม่ได้ hash
            passwordMatches = password === storedPassword;
        }

        if (!passwordMatches) {
            return res.status(401).json({
                ok: false,
                message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
            });
        }

        // เปลี่ยนรหัสผ่านเดิมเป็น bcrypt hash หลังตรวจสอบสำเร็จ
        if (!/^\$2[aby]\$/.test(storedPassword)) {
            const passwordHash = await bcrypt.hash(password, 12);

            await pool.query(
                "UPDATE users SET password = ? WHERE id = ?",
                [passwordHash, user.id]
            );
        }

        if (!req.session) {
            return res.status(500).json({
                ok: false,
                message: "ระบบ Session ยังไม่พร้อมใช้งาน"
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                console.error("Session regeneration failed:", error.message);

                return res.status(500).json({
                    ok: false,
                    message: "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้"
                });
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                roles: [user.role]
            };

            req.session.save((saveError) => {
                if (saveError) {
                    console.error("Session save failed:", saveError.message);

                    return res.status(500).json({
                        ok: false,
                        message: "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้"
                    });
                }

                return res.json({
                    ok: true,
                    message: "เข้าสู่ระบบสำเร็จ",
                    user: req.session.user
                });
            });
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            ok: false,
            message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ"
        });
    }
});

// Guest Login (เข้าสู่ระบบในฐานะ Guest)
router.post("/guest", (req, res) => {
    if (!req.session) {
        return res.status(500).json({
            ok: false,
            message: "ระบบ Session ยังไม่พร้อมใช้งาน"
        });
    }

    req.session.regenerate((error) => {
        if (error) {
            console.error("Guest session error:", error.message);
            return res.status(500).json({
                ok: false,
                message: "ไม่สามารถเข้าสู่ระบบในฐานะ Guest ได้"
            });
        }

        req.session.user = {
            id: 0,
            username: "Guest",
            roles: ["guest"]
        };

        req.session.save((saveError) => {
            if (saveError) {
                console.error("Guest session save error:", saveError.message);
                return res.status(500).json({
                    ok: false,
                    message: "ไม่สามารถบันทึก Session Guest ได้"
                });
            }

            return res.json({
                ok: true,
                message: "เข้าสู่ระบบในฐานะ Guest สำเร็จ",
                user: req.session.user
            });
        });
    });
});

// Check current user
router.get("/me", (req, res) => {
    if (!req.session?.user) {
        return res.status(401).json({
            authenticated: false,
            message: "กรุณาเข้าสู่ระบบ"
        });
    }

    return res.json({
        authenticated: true,
        user: req.session.user
    });
});

// Logout
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({
            ok: true,
            message: "ออกจากระบบสำเร็จ"
        });
    }

    req.session.destroy((error) => {
        if (error) {
            console.error("Logout error:", error.message);

            return res.status(500).json({
                ok: false,
                message: "ไม่สามารถออกจากระบบได้ในขณะนี้"
            });
        }

        res.clearCookie("edocs.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });

        return res.json({
            ok: true,
            message: "ออกจากระบบสำเร็จ"
        });
    });
});

module.exports = router;
