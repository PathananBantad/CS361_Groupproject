const express = require("express");
const crypto = require("node:crypto");
const pool = require("./db");

const {
    CognitoIdentityProviderClient,
    InitiateAuthCommand,
    GetUserCommand
} = require("@aws-sdk/client-cognito-identity-provider");

const router = express.Router();

const cognito = new CognitoIdentityProviderClient({
    region: process.env.COGNITO_REGION
});

// สร้าง SECRET_HASH สำหรับ Cognito App client ที่มี Client secret
function createSecretHash(username) {
    return crypto
        .createHmac("sha256", process.env.COGNITO_CLIENT_SECRET)
        .update(username + process.env.COGNITO_APP_CLIENT_ID)
        .digest("base64");
}

// Login ผ่าน Amazon Cognito
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
                message: "กรุณากรอกอีเมลและรหัสผ่าน"
            });
        }

        // 1. ให้ Cognito ตรวจสอบ Email และ Password

        // ตรวจสอบว่า Backend โหลดค่า Cognito ครบหรือไม่
        console.log("Cognito configuration:", {
            hasClientId: 
        Boolean(process.env.COGNITO_APP_CLIENT_ID),
            hasClientSecret: 
        Boolean(process.env.COGNITO_CLIENT_SECRET),
            secretHashType: typeof 
        createSecretHash(username.trim())
        });

        // 1. ให้ Cognito ตรวจสอบ Email และ Password
        const authResult = await cognito.send(
            new InitiateAuthCommand({
                AuthFlow: "USER_PASSWORD_AUTH",
                ClientId: process.env.COGNITO_APP_CLIENT_ID,
                AuthParameters: {
                    USERNAME: username.trim(),
                    PASSWORD: password,
                    SECRET_HASH: createSecretHash(username.trim())
                }
            })
        );

        // 2. ตรวจสอบว่าต้องทำขั้นตอนเพิ่มเติมหรือไม่
        if (authResult.ChallengeName) {
            return res.status(403).json({
                ok: false,
                message: "บัญชีนี้ต้องเปลี่ยนรหัสผ่านหรือยืนยันตัวตนเพิ่มเติมใน Cognito ก่อน"
            });
        }

        const accessToken = authResult.AuthenticationResult?.AccessToken;

        if (!accessToken) {
            return res.status(401).json({
                ok: false,
                message: "ไม่สามารถยืนยันตัวตนผ่าน Cognito ได้"
            });
        }

        // 3. อ่านข้อมูลผู้ใช้จาก Cognito ด้วย Access Token
        const cognitoUser = await cognito.send(
            new GetUserCommand({
                AccessToken: accessToken
            })
        );

        const cognitoSub = cognitoUser.UserAttributes?.find(
            (attribute) => attribute.Name === "sub"
        )?.Value;

        if (!cognitoSub) {
            return res.status(401).json({
                ok: false,
                message: "ไม่พบ User ID จาก Cognito"
            });
        }

        // 4. ค้นหาบัญชีที่เชื่อมไว้ใน MySQL
        const [users] = await pool.query(
            `SELECT id, username, role
             FROM users
             WHERE cognito_sub = ?
             LIMIT 1`,
            [cognitoSub]
        );

        if (users.length === 0) {
            return res.status(403).json({
                ok: false,
                message: "บัญชี Cognito นี้ยังไม่ได้เชื่อมกับผู้ใช้ในระบบ"
            });
        }

        const user = users[0];

        // 5. สร้าง Session หลังยืนยันตัวตนสำเร็จ
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
        console.error("Cognito login error:", {
            name: error.name,
            message: error.message
        });

        const invalidCredentials = [
            "NotAuthorizedException",
            "UserNotFoundException"
        ].includes(error.name);

        return res.status(invalidCredentials ? 401 : 500).json({
            ok: false,
            message: invalidCredentials
                ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
                : "ไม่สามารถเข้าสู่ระบบผ่าน Cognito ได้ กรุณาตรวจสอบการตั้งค่าหรือสถานะบัญชี"
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
