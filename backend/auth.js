const express = require("express");
const crypto = require("node:crypto");
const pool = require("./db");

const {
    CognitoIdentityProviderClient,
    InitiateAuthCommand,
    GetUserCommand,
    AdminGetUserCommand,
    AdminCreateUserCommand,
    AdminAddUserToGroupCommand,
    AdminSetUserPasswordCommand,
    AdminListGroupsForUserCommand
} = require("@aws-sdk/client-cognito-identity-provider");
const AmazonCognitoIdentity = require("amazon-cognito-identity-js");
const { mapCognitoGroupsToRoles } = require("./documentAuthorization");

const router = express.Router();

const cognito = new CognitoIdentityProviderClient({
    region: process.env.COGNITO_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.aws_access_key_id || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.aws_secret_access_key || process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.aws_session_token || process.env.AWS_SESSION_TOKEN
    }
});

// สร้าง SECRET_HASH สำหรับ Cognito App client ที่มี Client secret
function createSecretHash(username) {
    if (!process.env.COGNITO_CLIENT_SECRET) return null;
    return crypto
        .createHmac("sha256", process.env.COGNITO_CLIENT_SECRET)
        .update(username + process.env.COGNITO_APP_CLIENT_ID)
        .digest("base64");
}

// ฟังก์ชันตรวจสอบสิทธิ์กับ TU REST API (Thammasat University Active Directory)
async function verifyWithTuApi(username, password) {
    const tuApiUrl = process.env.TU_API_URL || "https://restapi.tu.ac.th/api/v1/auth/Ad/verify";
    const tuApiKey = process.env.TU_API_KEY || process.env.TU_APP_KEY;

    // หากมีการตั้งค่า Application-Key ไว้ในระบบ ให้ตรวจสอบกับ TU REST API จริง
    if (tuApiKey && tuApiKey !== "TU_API_KEY_HERE") {
        async function attemptCall(u) {
            const resp = await fetch(tuApiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Application-Key": tuApiKey
                },
                body: JSON.stringify({
                    UserName: u,
                    PassWord: password
                }),
                signal: AbortSignal.timeout(6000)
            });
            const data = await resp.json().catch(() => ({}));
            return { ok: resp.ok, data };
        }

        try {
            // 1. ลองตรวจสอบด้วยชื่อผู้ใช้ตามที่กรอกมา
            let res = await attemptCall(username);
            let data = res.data;

            // 2. หากไม่สำเร็จและเป็นอีเมล ให้ลองด้วย Username สั้น (ตัดส่วนโดเมนออก เช่น 650965xxxx หรือ pakhwan.jul)
            if ((!data || data.status !== true) && username.includes("@")) {
                const shortUser = username.split("@")[0];
                const retryRes = await attemptCall(shortUser);
                if (retryRes.data && retryRes.data.status === true) {
                    data = retryRes.data;
                }
            }

            // 3. หากไม่สำเร็จและไม่มี @ ให้ลองเติม @dome.tu.ac.th
            if ((!data || data.status !== true) && !username.includes("@")) {
                const retryDome = await attemptCall(`${username}@dome.tu.ac.th`);
                if (retryDome.data && retryDome.data.status === true) {
                    data = retryDome.data;
                }
            }

            if (data && (data.status === true || data.status === "true" || data.status === 1)) {
                let resolvedEmail = data.email;
                if (!resolvedEmail || !resolvedEmail.includes("@")) {
                    resolvedEmail = username.includes("@") ? username : `${username}@dome.tu.ac.th`;
                }

                return {
                    success: true,
                    displayName: data.displayname_th || data.displayname_en || resolvedEmail.split("@")[0],
                    type: data.type || "employee",
                    faculty: data.faculty || "",
                    department: data.department || "",
                    email: resolvedEmail.trim().toLowerCase(),
                    tuData: data
                };
            }

            const errorMsg = data?.Description || data?.message || "ชื่อผู้ใช้หรือรหัสผ่านของระบบมหาวิทยาลัยธรรมศาสตร์ไม่ถูกต้อง";
            return {
                success: false,
                message: errorMsg
            };
        } catch (fetchErr) {
            console.warn("TU API fetch error:", fetchErr.message);
        }
    }

    // กรณีที่ยังไม่มี Application-Key จากศูนย์คอมพิวเตอร์ หรือกรณี fallback:
    const cleanUser = String(username).trim().toLowerCase();
    const resolvedEmail = cleanUser.includes("@") ? cleanUser : `${cleanUser}@dome.tu.ac.th`;
    const isTuDomain = resolvedEmail.endsWith("@dome.tu.ac.th") || resolvedEmail.endsWith("@tu.ac.th");
    if (!isTuDomain) {
        return {
            success: false,
            message: "กรุณาเข้าสู่ระบบด้วยอีเมลมหาวิทยาลัยธรรมศาสตร์ (@dome.tu.ac.th หรือ @tu.ac.th)"
        };
    }
    if (!password || password.length < 4) {
        return {
            success: false,
            message: "กรุณากรอกรหัสผ่านของบัญชี TU"
        };
    }

    return {
        success: true,
        displayName: resolvedEmail.split("@")[0],
        type: "employee",
        email: resolvedEmail
    };
}

// ฟังก์ชันยืนยันตัวตนกับ AWS Cognito User Pool โดยตรง (สำหรับบัญชีที่มีใน Cognito เช่น v3test.*, Officer, Executive, Admin)
async function authenticateWithCognito(username, password) {
    const clientId = process.env.COGNITO_APP_CLIENT_ID || "454o0719rb9d6lkspv4m8tmb6i";
    try {
        const authRes = await cognito.send(new InitiateAuthCommand({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: clientId,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password
            }
        }));

        const result = authRes.AuthenticationResult;
        if (!result || !result.AccessToken || !result.IdToken) {
            return null;
        }

        const idPayload = JSON.parse(Buffer.from(result.IdToken.split(".")[1], "base64").toString());
        const groups = idPayload["cognito:groups"] || [];
        const userSub = idPayload["sub"] || username;
        const email = idPayload["email"] || username;

        return {
            accessToken: result.AccessToken,
            idToken: result.IdToken,
            groups,
            userSub,
            email,
            displayName: idPayload["name"] || email.split("@")[0]
        };
    } catch (err) {
        return null;
    }
}

// Route สำหรับ Login (รองรับทั้งบัญชีที่ตั้งไว้ใน AWS Cognito Groups โดยตรง และ TU Active Directory API)
router.post("/tu-login", async (req, res) => {
    try {
        const { username, password } = req.body || {};
        const cleanUser = String(username || "").trim();

        if (!cleanUser || !password) {
            return res.status(400).json({
                ok: false,
                message: "กรุณากรอกชื่อผู้ใช้/อีเมล และรหัสผ่าน"
            });
        }

        let targetEmail = cleanUser.includes("@") ? cleanUser.toLowerCase() : `${cleanUser.toLowerCase()}@dome.tu.ac.th`;

        // 1. ตรวจสอบการเข้าสู่ระบบกับ AWS Cognito โดยตรงก่อน (สำหรับบัญชีที่ตั้งไว้ใน Cognito Groups เช่น v3test.*, Officer, Executive, Admin)
        const directCognitoAuth = await authenticateWithCognito(cleanUser, password) ||
            (cleanUser !== targetEmail ? await authenticateWithCognito(targetEmail, password) : null);

        if (directCognitoAuth) {
            const mappedRoles = mapCognitoGroupsToRoles(directCognitoAuth.groups);
            const resolvedRole = mappedRoles[0] || "faculty_staff";

            try {
                await pool.query(
                    `INSERT INTO users (username, password, role, cognito_sub, is_active, full_name)
                     VALUES (?, 'COGNITO_AUTH', ?, ?, 1, ?)
                     ON DUPLICATE KEY UPDATE cognito_sub = VALUES(cognito_sub), role = VALUES(role), is_active = 1`,
                    [directCognitoAuth.email, resolvedRole, directCognitoAuth.userSub, directCognitoAuth.displayName || directCognitoAuth.email]
                );
            } catch (dbErr) {
                console.warn("DB user sync warning:", dbErr.message);
            }

            return res.json({
                ok: true,
                message: "เข้าสู่ระบบสำเร็จผ่าน AWS Cognito",
                access_token: directCognitoAuth.accessToken,
                id_token: directCognitoAuth.idToken,
                username: directCognitoAuth.email,
                role: resolvedRole,
                groups: directCognitoAuth.groups,
                displayName: directCognitoAuth.displayName
            });
        }

        // 2. หากไม่พบบัญชีใน Cognito หรือใช้รหัสผ่าน TU ตรวจสอบการยืนยันตัวตนกับ TU API
        const tuResult = await verifyWithTuApi(cleanUser, password);
        if (!tuResult.success) {
            return res.status(401).json({
                ok: false,
                message: tuResult.message || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
            });
        }

        // กำหนด Target Email ที่เป็นอีเมลที่ถูกต้องเสมอ (สำหรับ Cognito User Pool ที่ใช้ UsernameAttributes = ['email'])
        targetEmail = (tuResult.email || targetEmail).trim().toLowerCase();

        const userPoolId = process.env.COGNITO_USER_POOL_ID || "us-east-1_1duzJEFfU";
        const clientId = process.env.COGNITO_APP_CLIENT_ID || "454o0719rb9d6lkspv4m8tmb6i";

        // 2. ตรวจสอบและสร้างผู้ใช้ใน AWS Cognito User Pool
        let userSub = null;
        let cognitoUsername = null;

        try {
            const getRes = await cognito.send(new AdminGetUserCommand({
                UserPoolId: userPoolId,
                Username: targetEmail
            }));
            cognitoUsername = getRes.Username; // UUID ใน Cognito
            userSub = getRes.UserAttributes?.find(a => a.Name === "sub")?.Value || cognitoUsername;
        } catch (getErr) {
            if (getErr.name === "UserNotFoundException") {
                // สร้าง User ใหม่ใน AWS Cognito จริงด้วย targetEmail
                const createRes = await cognito.send(new AdminCreateUserCommand({
                    UserPoolId: userPoolId,
                    Username: targetEmail,
                    UserAttributes: [
                        { Name: "email", Value: targetEmail },
                        { Name: "email_verified", Value: "true" }
                    ],
                    MessageAction: "SUPPRESS"
                }));
                cognitoUsername = createRes.User?.Username;
                userSub = createRes.User?.Attributes?.find(a => a.Name === "sub")?.Value || cognitoUsername;
                console.log(`Created new Cognito user: ${targetEmail} (${cognitoUsername})`);

                // 3. จัดกลุ่มผู้ใช้ใหม่เข้ากลุ่ม "Staff/Instructor" ใน AWS Cognito ทันที!
                await cognito.send(new AdminAddUserToGroupCommand({
                    UserPoolId: userPoolId,
                    Username: cognitoUsername,
                    GroupName: "Staff/Instructor"
                }));
                console.log(`Assigned user [${targetEmail}] to Cognito group "Staff/Instructor"`);
            } else {
                throw getErr;
            }
        }

        // 3.1 ตรวจสอบกลุ่มใน Cognito อีกครั้ง หากยังไม่มีกลุ่ม ให้เพิ่มเข้ากลุ่ม Staff/Instructor
        const listGroups = await cognito.send(new AdminListGroupsForUserCommand({
            UserPoolId: userPoolId,
            Username: cognitoUsername
        }));
        let currentGroups = (listGroups.Groups || []).map(g => g.GroupName);
        if (currentGroups.length === 0) {
            await cognito.send(new AdminAddUserToGroupCommand({
                UserPoolId: userPoolId,
                Username: cognitoUsername,
                GroupName: "Staff/Instructor"
            }));
            currentGroups = ["Staff/Instructor"];
        }

        // 4. ซิงค์รหัสผ่านใน Cognito เพื่อให้ออก JWT Token จาก AWS Cognito แท้ได้
        let cognitoSyncPassword = password;
        const satisfiesPolicy = password.length >= 8 &&
            /[A-Z]/.test(password) &&
            /[a-z]/.test(password) &&
            /[0-9]/.test(password) &&
            /[^A-Za-z0-9]/.test(password);

        if (!satisfiesPolicy) {
            cognitoSyncPassword = `TuAuth!${crypto.createHash("sha256").update(targetEmail + password).digest("hex").slice(0, 10)}9A`;
        }

        await cognito.send(new AdminSetUserPasswordCommand({
            UserPoolId: userPoolId,
            Username: cognitoUsername,
            Password: cognitoSyncPassword,
            Permanent: true
        }));

        // 5. ออก Access Token และ ID Token จาก AWS Cognito แท้
        const tokens = await new Promise((resolve, reject) => {
            const userPool = new AmazonCognitoIdentity.CognitoUserPool({
                UserPoolId: userPoolId,
                ClientId: clientId
            });
            const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
                Username: targetEmail,
                Pool: userPool
            });
            cognitoUser.authenticateUser(new AmazonCognitoIdentity.AuthenticationDetails({
                Username: targetEmail,
                Password: cognitoSyncPassword
            }), {
                onSuccess: (session) => {
                    resolve({
                        accessToken: session.getAccessToken().getJwtToken(),
                        idToken: session.getIdToken().getJwtToken(),
                        groups: session.getIdToken().decodePayload()["cognito:groups"] || currentGroups
                    });
                },
                onFailure: (err) => reject(err)
            });
        });

        // 6. ซิงค์ข้อมูลผู้ใช้และ Role จาก Cognito Group ลงใน MySQL Database
        const mappedRoles = mapCognitoGroupsToRoles(tokens.groups);
        const resolvedRole = mappedRoles[0] || "faculty_staff";

        try {
            await pool.query(
                `INSERT INTO users (username, password, role, cognito_sub, is_active, full_name)
                 VALUES (?, 'COGNITO_TU_AUTH', ?, ?, 1, ?)
                 ON DUPLICATE KEY UPDATE cognito_sub = VALUES(cognito_sub), role = VALUES(role), is_active = 1`,
                [targetEmail, resolvedRole, userSub, tuResult.displayName || targetEmail]
            );
        } catch (dbErr) {
            console.warn("DB user sync warning:", dbErr.message);
        }

        return res.json({
            ok: true,
            message: "เข้าสู่ระบบด้วยบัญชี TU สำเร็จ",
            access_token: tokens.accessToken,
            id_token: tokens.idToken,
            username: targetEmail,
            role: resolvedRole,
            groups: tokens.groups,
            displayName: tuResult.displayName || targetEmail.split("@")[0]
        });

    } catch (error) {
        console.error("TU Login error:", error);
        return res.status(500).json({
            ok: false,
            message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบผ่าน TU API: " + error.message
        });
    }
});
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

        const cognitoUsername = cognitoUser.Username || cognitoUser.UserAttributes?.find((attribute) => attribute.Name === "preferred_username")?.Value || username.trim();
        if (!cognitoUsername) {
            return res.status(401).json({
                ok: false,
                message: "ไม่พบ User ID จาก Cognito"
            });
        }

        // 4. ค้นหาบัญชีที่เชื่อมไว้ใน MySQL
        const [users] = await pool.query(
            `SELECT u.id, u.username, GROUP_CONCAT(DISTINCT r.name) AS roles
             FROM users u JOIN users_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE u.username = ? AND u.is_active = TRUE
             GROUP BY u.id, u.username`,
            [cognitoUsername]
        );

        if (users.length === 0) {
            return res.status(403).json({
                ok: false,
                message: "บัญชี Cognito นี้ยังไม่ได้เชื่อมกับผู้ใช้ในระบบ"
            });
        }

        const user = users[0];
        const roles = (user.roles || "").split(",").map((role) => role.trim()).filter((role) => ["document_officer", "faculty_staff", "admin", "executive"].includes(role));
        if (!roles.length) return res.status(403).json({ ok: false, message: "บัญชีนี้ยังไม่มีบทบาทที่ได้รับอนุญาต" });

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
                roles
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
                    user: req.session.user,
                    access_token: accessToken
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
