
const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");
const loginMessage = document.getElementById("loginMessage");
const togglePassword = document.getElementById("togglePassword");
const guestLoginBtn = document.getElementById("guestLoginBtn");

const EMAIL_ROLE_MAP = {
    "pathanan.ban@dome.tu.ac.th": "admin",
    "maneerat.aun@dome.tu.ac.th": "faculty_staff",
    "achiraya.kha@dome.tu.ac.th": "document_officer",
    "pakhwan.jul@dome.tu.ac.th": "executive",
    "admin": "admin",
    "staff-1": "document_officer",
    "fac-a": "faculty_staff",
    "fac-b": "faculty_staff",
    "staff": "faculty_staff"
};

function performLocalMockLogin(username, role) {
    const cleanUser = String(username).toLowerCase().trim();
    const resolvedRole = role || EMAIL_ROLE_MAP[cleanUser] || "faculty_staff";
    localStorage.setItem("docuflow_access_token", `mock-${cleanUser}`);
    localStorage.setItem("docuflow_id_token", `mock-${cleanUser}`);
    localStorage.setItem("access_token", `mock-${cleanUser}`);
    localStorage.setItem("id_token", `mock-${cleanUser}`);
    localStorage.setItem("docuflow_user", username);
    localStorage.setItem("docuflow_role", resolvedRole);
    window.location.href = "dashboard.html";
}

// โหลด Username ล่าสุด และแสดงปุ่มทดสอบสำหรับ localhost
document.addEventListener("DOMContentLoaded", () => {
    const savedUser = localStorage.getItem("docuflow_user");

    if (savedUser && savedUser !== "Guest") {
        usernameInput.value = savedUser;
    }

    // เพิ่มแผงทดสอบบน Localhost สำหรับจำลองสิทธิ์ต่างๆ
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocal && loginForm) {
        let devBox = document.getElementById("localDevBox");
        if (!devBox) {
            devBox = document.createElement("div");
            devBox.id = "localDevBox";
            devBox.style.marginTop = "18px";
            devBox.style.padding = "14px";
            devBox.style.borderRadius = "8px";
            devBox.style.background = "rgba(79, 70, 229, 0.08)";
            devBox.style.border = "1px dashed #6366f1";
            devBox.style.textAlign = "center";

            devBox.innerHTML = `
                <div style="font-size: 13px; font-weight: 600; color: #4338ca; margin-bottom: 8px;">
                    ⚡ Local Dev Quick Test (คลิกเข้าทดสอบได้ทันที)
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;">
                    <button type="button" class="btn-dev-role" data-user="admin" data-role="admin" style="padding: 5px 10px; font-size: 12px; border: 1px solid #c7d2fe; border-radius: 4px; background: #ffffff; cursor: pointer;">👑 Admin</button>
                    <button type="button" class="btn-dev-role" data-user="FAC-A" data-role="faculty_staff" style="padding: 5px 10px; font-size: 12px; border: 1px solid #c7d2fe; border-radius: 4px; background: #ffffff; cursor: pointer;">👨‍🏫 อาจารย์ (FAC-A)</button>
                    <button type="button" class="btn-dev-role" data-user="STAFF-1" data-role="document_officer" style="padding: 5px 10px; font-size: 12px; border: 1px solid #c7d2fe; border-radius: 4px; background: #ffffff; cursor: pointer;">📋 สารบรรณ (STAFF-1)</button>
                </div>
            `;

            devBox.querySelectorAll(".btn-dev-role").forEach(btn => {
                btn.addEventListener("click", () => {
                    const u = btn.getAttribute("data-user");
                    const r = btn.getAttribute("data-role");
                    performLocalMockLogin(u, r);
                });
            });

            loginForm.parentNode.insertBefore(devBox, loginForm.nextSibling);
        }
    }
});

// แสดง/ซ่อนรหัสผ่าน
if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", () => {
        const isHidden = passwordInput.type === "password";

        passwordInput.type = isHidden ? "text" : "password";
        togglePassword.textContent = isHidden ? "HIDE" : "SHOW";
        togglePassword.setAttribute(
            "aria-label",
            isHidden ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"
        );
    });
}

// เข้าสู่ระบบด้วย AWS Cognito
if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
        event.preventDefault();

        loginMessage.textContent = "";

        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const config = window.COGNITO_CONFIG;

        if (!username) {
            loginMessage.textContent = "กรุณากรอกชื่อผู้ใช้";
            usernameInput.focus();
            return;
        }

        if (!password) {
            loginMessage.textContent = "กรุณากรอกรหัสผ่าน";
            passwordInput.focus();
            return;
        }

        if (
            !window.AmazonCognitoIdentity ||
            !config ||
            !config.userPoolId ||
            !config.clientId
        ) {
            loginMessage.textContent =
                "ระบบ Cognito โหลดไม่สำเร็จ กรุณาตรวจสอบ SDK และ Config";
            return;
        }

        loginButton.disabled = true;
        loginButtonText.textContent = "SIGNING IN...";

        const pool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: config.userPoolId,
            ClientId: config.clientId
        });

        const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
            Username: username,
            Pool: pool
        });

        const authenticationDetails =
            new AmazonCognitoIdentity.AuthenticationDetails({
                Username: username,
                Password: password
            });

        cognitoUser.authenticateUser(authenticationDetails, {
            onSuccess: (session) => {
                // เก็บ Token จาก Cognito สำหรับใช้เรียก Backend บน AWS
                const accessToken = session.getAccessToken().getJwtToken();
                const idToken = session.getIdToken().getJwtToken();

                localStorage.setItem("docuflow_access_token", accessToken);
                localStorage.setItem("docuflow_id_token", idToken);
                localStorage.setItem("access_token", accessToken);
                localStorage.setItem("id_token", idToken);
                localStorage.setItem("docuflow_user", username);

                // ตรวจสอบ Role จาก Email หรือ Cognito Groups
                const EMAIL_ROLE_MAP = {
                    "pathanan.ban@dome.tu.ac.th": "admin",
                    "maneerat.aun@dome.tu.ac.th": "faculty_staff",
                    "achiraya.kha@dome.tu.ac.th": "document_officer",
                    "pakhwan.jul@dome.tu.ac.th": "executive",
                    "admin": "admin",
                    "staff-1": "document_officer",
                    "fac-a": "faculty_staff",
                    "fac-b": "faculty_staff",
                    "staff": "faculty_staff"
                };

                const cleanUser = username.toLowerCase().trim();
                let role = EMAIL_ROLE_MAP[cleanUser] || null;

                if (!role) {
                    try {
                        const idPayload = session.getIdToken().decodePayload();
                        const groups = idPayload["cognito:groups"] || [];
                        if (groups.includes("admin")) {
                            role = "admin";
                        } else if (groups.includes("document_officer") || groups.includes("officer")) {
                            role = "document_officer";
                        } else if (groups.includes("faculty_staff") || groups.includes("staff")) {
                            role = "faculty_staff";
                        } else if (groups.includes("executive")) {
                            role = "executive";
                        } else if (groups.length > 0) {
                            role = groups[0];
                        }
                    } catch (e) {
                        console.warn("Could not decode Cognito ID token:", e);
                    }
                }

                if (!role) {
                    if (cleanUser.includes("admin")) role = "admin";
                    else if (cleanUser.includes("officer")) role = "document_officer";
                    else if (cleanUser.includes("exec")) role = "executive";
                    else role = "faculty_staff";
                }

                localStorage.setItem("docuflow_role", role);


                window.location.href = "dashboard.html";
            },

            onFailure: (error) => {
                console.error("Cognito login failed:", error);

                // หากทดสอบบน Localhost ให้เข้าใช้งานผ่านสิทธิ์จำลองได้ทันที
                const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
                const cleanUser = username.toLowerCase().trim();
                if (isLocal && (EMAIL_ROLE_MAP[cleanUser] || cleanUser.startsWith("mock") || cleanUser.includes("fac") || cleanUser.includes("admin") || cleanUser.includes("staff"))) {
                    performLocalMockLogin(username, EMAIL_ROLE_MAP[cleanUser]);
                    return;
                }

                loginMessage.textContent =
                    error.message ||
                    "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบ Username และ Password";

                loginButton.disabled = false;
                loginButtonText.textContent = "SIGN IN";
            },

            newPasswordRequired: () => {
                loginMessage.textContent =
                    "บัญชีนี้ต้องเปลี่ยนรหัสผ่านก่อน กรุณาตั้งรหัสผ่านใหม่ผ่านขั้นตอนของ Cognito";

                loginButton.disabled = false;
                loginButtonText.textContent = "SIGN IN";
            }
        });
    });
}

// เข้าสู่ระบบในฐานะ Guest
if (guestLoginBtn) {
    guestLoginBtn.addEventListener("click", (event) => {
        event.preventDefault();
        localStorage.setItem("docuflow_role", "guest");
        localStorage.setItem("docuflow_user", "Guest");
        localStorage.removeItem("docuflow_access_token");
        localStorage.removeItem("docuflow_id_token");
        window.location.href = "dashboard.html";
    });
}

