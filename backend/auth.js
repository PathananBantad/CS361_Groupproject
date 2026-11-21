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
const {
    ROLES,
    mapCognitoGroupsToRoles,
    resolvePrimaryRole,
    cognitoGroupForRole,
    DEFAULT_ROLE
} = require("./documentAuthorization");
const { getPublicCognitoConfig } = require("./config");

const router = express.Router();

const cognito = new CognitoIdentityProviderClient({
    region: getPublicCognitoConfig().region
});

// ตรวจว่า error เกิดจาก AWS credentials ของเซิร์ฟเวอร์หมดอายุ/ไม่ถูกต้อง (ไม่ใช่ความผิดของผู้ใช้)
function isAwsCredentialError(error) {
    if (!error) return false;
    const name = error.name || "";
    const msg = String(error.message || "");
    return (
        name === "ExpiredTokenException" ||
        name === "ExpiredToken" ||
        name === "InvalidClientTokenId" ||
        name === "UnrecognizedClientException" ||
        name === "CredentialsProviderError" ||
        /security token.*expired/i.test(msg) ||
        /expired/i.test(msg) && /token/i.test(msg)
    );
}

// สร้าง SECRET_HASH สำหรับ Cognito App client ที่มี Client secret
function createSecretHash(username, clientId = getPublicCognitoConfig().appClientId) {
    if (!process.env.COGNITO_CLIENT_SECRET) return null;
    return crypto
        .createHmac("sha256", process.env.COGNITO_CLIENT_SECRET)
        .update(username + clientId)
        .digest("base64");
}

function withSecretHash(authParameters, username, clientId) {
    const secretHash = createSecretHash(username, clientId);
    return secretHash ? { ...authParameters, SECRET_HASH: secretHash } : authParameters;
}

// ผลลัพธ์เมื่อ TU SSO ใช้งานไม่ได้ (ไม่ได้ตั้งค่า key หรือเชื่อมต่อ TU API ไม่ได้) — ปฏิเสธเสมอ (fail closed)
function tuUnavailable(message) {
    return {
        success: false,
        status: 503,
        code: "TU_AUTH_UNAVAILABLE",
        message
    };
}

// ฟังก์ชันตรวจสอบสิทธิ์กับ TU REST API (Thammasat University Active Directory)
async function verifyWithTuApi(username, password) {
    const tuApiUrl = process.env.TU_API_URL || "https://restapi.tu.ac.th/api/v1/auth/Ad/verify";
    const tuApiKey = (process.env.TU_API_KEY || process.env.TU_APP_KEY || "").trim();
    if (!tuApiKey || tuApiKey === "TU_API_KEY_HERE") {
        return { success: false, unavailable: true };
    }

    async function attemptCall(user) {
        const response = await fetch(tuApiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Application-Key": tuApiKey
            },
            body: JSON.stringify({
                UserName: user,
                PassWord: password
            }),
            signal: AbortSignal.timeout(6000)
        });

        if (!response.ok) {
            return { unavailable: true };
        }

        let data;
        try {
            data = await response.json();
        } catch {
            return { unavailable: true };
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return { unavailable: true };
        }

        if (data.status === true || data.status === "true" || data.status === 1) {
            return { data };
        }
        if (data.status === false || data.status === "false" || data.status === 0) {
            return { rejected: true };
        }

        return { unavailable: true };
    }

    const candidateUsernames = [username];
    if (username.includes("@")) {
        candidateUsernames.push(username.split("@")[0]);
    } else {
        candidateUsernames.push(`${username}@dome.tu.ac.th`);
    }

    try {
        for (const candidate of candidateUsernames) {
            const result = await attemptCall(candidate);
            if (result.unavailable) {
                return { success: false, unavailable: true };
            }
            if (result.data) {
                const data = result.data;
                let resolvedEmail = data.email;
                if (typeof resolvedEmail !== "string" || !resolvedEmail.includes("@")) {
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
        }
    } catch {
        return { success: false, unavailable: true };
    }

    return { success: false, unavailable: false };
}

// ฟังก์ชันยืนยันตัวตนกับ AWS Cognito User Pool โดยตรง (สำหรับบัญชีที่มีใน Cognito เช่น v3test.*, Officer, Executive, Admin)
async function authenticateWithCognito(username, password) {
    const { appClientId: clientId } = getPublicCognitoConfig();
    try {
        const authRes = await cognito.send(new InitiateAuthCommand({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: clientId,
            AuthParameters: withSecretHash({
                USERNAME: username,
                PASSWORD: password
            }, username, clientId)
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
        const cleanUser = typeof username === "string" ? username.trim() : "";

        if (!cleanUser || typeof password !== "string" || !password) {
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
            const resolvedRole = resolvePrimaryRole(mappedRoles);

            try {
                await pool.query(
                    `INSERT INTO users (username, password, role, cognito_sub, is_active, full_name)
                     VALUES (?, 'COGNITO_AUTH', ?, ?, 1, ?)
                     ON DUPLICATE KEY UPDATE cognito_sub = VALUES(cognito_sub), role = VALUES(role), is_active = 1`,
                    [directCognitoAuth.email, resolvedRole, directCognitoAuth.userSub, directCognitoAuth.displayName || directCognitoAuth.email]
                );

                const [userRows] = await pool.query("SELECT id FROM users WHERE username = ?", [directCognitoAuth.email]);
                if (userRows.length > 0) {
                    const userId = userRows[0].id;
                    if (mappedRoles.includes("responsible_person") && !mappedRoles.includes("faculty_staff")) {
                        await pool.query(
                            "DELETE ur FROM users_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'faculty_staff'",
                            [userId]
                        );
                    }
                    for (const rName of mappedRoles) {
                        const [rRows] = await pool.query("SELECT id FROM roles WHERE name = ?", [rName]);
                        if (rRows.length > 0) {
                            await pool.query("INSERT IGNORE INTO users_roles (user_id, role_id) VALUES (?, ?)", [userId, rRows[0].id]);
                        }
                    }
                }
            } catch (dbErr) {
                console.warn("Database user synchronization failed after Cognito login.");
            }

            return res.json({
                ok: true,
                message: "เข้าสู่ระบบสำเร็จผ่าน AWS Cognito",
                access_token: directCognitoAuth.accessToken,
                id_token: directCognitoAuth.idToken,
                username: directCognitoAuth.email,
                role: resolvedRole,
                roles: mappedRoles,
                groups: directCognitoAuth.groups,
                displayName: directCognitoAuth.displayName
            });
        }

        // 2. หากไม่พบบัญชีใน Cognito หรือใช้รหัสผ่าน TU ตรวจสอบการยืนยันตัวตนกับ TU API
        const tuResult = await verifyWithTuApi(cleanUser, password);
        if (!tuResult.success) {
            return res.status(tuResult.unavailable ? 503 : 401).json({
                ok: false,
                code: tuResult.unavailable ? "TU_AUTH_UNAVAILABLE" : "INVALID_CREDENTIALS",
                message: tuResult.unavailable
                    ? "TU authentication is temporarily unavailable. Please try again later."
                    : "Invalid username or password."
            });
        }

        // กำหนด Target Email ที่เป็นอีเมลที่ถูกต้องเสมอ (สำหรับ Cognito User Pool ที่ใช้ UsernameAttributes = ['email'])
        targetEmail = (tuResult.email || targetEmail).trim().toLowerCase();

        const { userPoolId, appClientId: clientId } = getPublicCognitoConfig();

        // 2. ตรวจสอบและซิงค์ผู้ใช้กับ AWS Cognito
        let userSub = null;
        let cognitoUsername = null;
        let tokens = null;
        let isCognitoAdminWorking = true;

        try {
            const getRes = await cognito.send(new AdminGetUserCommand({
                UserPoolId: userPoolId,
                Username: targetEmail
            }));
            cognitoUsername = getRes.Username; // UUID ใน Cognito
            userSub = getRes.UserAttributes?.find(a => a.Name === "sub")?.Value || cognitoUsername;
        } catch (getErr) {
            if (getErr.name === "UserNotFoundException") {
                try {
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

                    await cognito.send(new AdminAddUserToGroupCommand({
                        UserPoolId: userPoolId,
                        Username: cognitoUsername,
                        GroupName: cognitoGroupForRole(DEFAULT_ROLE)
                    }));
                } catch (createErr) {
                    console.warn("Cognito Admin create user failed during TU login.");
                    isCognitoAdminWorking = false;
                }
            } else {
                console.warn("Cognito Admin get user failed during TU login.");
                isCognitoAdminWorking = false;
            }
        }

        if (isCognitoAdminWorking && cognitoUsername) {
            try {
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
                        GroupName: cognitoGroupForRole(DEFAULT_ROLE)
                    }));
                    currentGroups = [cognitoGroupForRole(DEFAULT_ROLE)];
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
                tokens = await new Promise((resolve, reject) => {
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
            } catch (cogSyncErr) {
                console.warn("Cognito user synchronization failed during TU login.");
                tokens = null;
            }
        }

        // Fail closed when Cognito cannot issue a token.
        if (!tokens) {
            return res.status(503).json({
                ok: false,
                code: "COGNITO_TOKEN_UNAVAILABLE",
                message: "Unable to complete sign-in through Cognito. Please try again later."
            });
        }

        const mappedRoles = mapCognitoGroupsToRoles(tokens.groups);
        const resolvedRole = resolvePrimaryRole(mappedRoles);

        try {
            await pool.query(
                `INSERT INTO users (username, password, role, cognito_sub, is_active, full_name)
                 VALUES (?, 'COGNITO_TU_AUTH', ?, ?, 1, ?)
                 ON DUPLICATE KEY UPDATE cognito_sub = VALUES(cognito_sub), role = VALUES(role), is_active = 1`,
                [targetEmail, resolvedRole, userSub, tuResult.displayName || targetEmail]
            );

            const [userRows] = await pool.query("SELECT id FROM users WHERE username = ?", [targetEmail]);
            if (userRows.length > 0) {
                const userId = userRows[0].id;
                if (mappedRoles.includes("responsible_person") && !mappedRoles.includes("faculty_staff")) {
                    await pool.query(
                        "DELETE ur FROM users_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.name = 'faculty_staff'",
                        [userId]
                    );
                }
                for (const rName of mappedRoles) {
                    const [rRows] = await pool.query("SELECT id FROM roles WHERE name = ?", [rName]);
                    if (rRows.length > 0) {
                        await pool.query("INSERT IGNORE INTO users_roles (user_id, role_id) VALUES (?, ?)", [userId, rRows[0].id]);
                    }
                }
            }
        } catch (dbErr) {
            console.warn("Database user synchronization failed after TU login.");
        }

        return res.json({
            ok: true,
            message: "เข้าสู่ระบบด้วยบัญชี TU สำเร็จ",
            access_token: tokens.accessToken,
            id_token: tokens.idToken,
            username: targetEmail,
            role: resolvedRole,
            roles: mappedRoles,
            groups: tokens.groups,
            displayName: tuResult.displayName || targetEmail.split("@")[0]
        });

    } catch (error) {
        console.error("TU login failed.");

        // AWS credentials ของเซิร์ฟเวอร์หมดอายุ -> ไม่ใช่ความผิดของผู้ใช้ แจ้งให้ผู้ดูแลระบบอัปเดต credential
        if (isAwsCredentialError(error)) {
            return res.status(503).json({
                ok: false,
                code: "AWS_CREDENTIALS_EXPIRED",
                message: "Authentication is temporarily unavailable. Please try again later."
            });
        }

        // ไม่ส่งรายละเอียด error ภายในกลับไปให้ผู้ใช้
        return res.status(500).json({
            ok: false,
            message: "Unable to complete sign-in. Please try again later."
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
        const { appClientId } = getPublicCognitoConfig();
        const authResult = await cognito.send(
            new InitiateAuthCommand({
                AuthFlow: "USER_PASSWORD_AUTH",
                ClientId: appClientId,
                AuthParameters: withSecretHash({
                    USERNAME: username.trim(),
                    PASSWORD: password
                }, username.trim(), appClientId)
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
        const roles = (user.roles || "").split(",").map((role) => role.trim()).filter((role) => ROLES.includes(role));
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
