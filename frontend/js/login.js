
const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");
const loginMessage = document.getElementById("loginMessage");
const togglePassword = document.getElementById("togglePassword");
const guestLoginBtn = document.getElementById("guestLoginBtn");

// โหลด Username ล่าสุด
document.addEventListener("DOMContentLoaded", () => {
    const savedUser = localStorage.getItem("docuflow_user");

    if (savedUser && savedUser !== "Guest") {
        usernameInput.value = savedUser;
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
    loginForm.addEventListener("submit", async (event) => {
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

        // 1. เข้าสู่ระบบผ่าน TU API และจัดกลุ่ม User เข้าเป็น Staff/Instructor ใน AWS Cognito อัตโนมัติ
        try {
            const apiBase = window.API_BASE_URL || (window.location.port === "3000" ? window.location.origin : "");
            const tuResp = await fetch(`${apiBase}/api/auth/tu-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const tuData = await tuResp.json();
            if (tuResp.ok && tuData.ok && tuData.access_token) {
                localStorage.setItem("docuflow_access_token", tuData.access_token);
                localStorage.setItem("docuflow_id_token", tuData.id_token);
                localStorage.setItem("access_token", tuData.access_token);
                localStorage.setItem("id_token", tuData.id_token);
                localStorage.setItem("docuflow_user", tuData.username || username);
                localStorage.setItem("docuflow_role", tuData.role || "faculty_staff");

                window.location.href = "dashboard.html";
                return;
            } else if (!tuResp.ok && tuData.message) {
                var apiErrorMessage = tuData.message;
            }
        } catch (tuErr) {
            console.warn("Login endpoint notice:", tuErr.message);
        }

        // 2. Direct AWS Cognito Authentication (สำหรับบัญชีใน Cognito User Pool)
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

                // ตรวจสอบ Role จาก Cognito Groups ใน Token
                let role = "faculty_staff"; // ค่าเริ่มต้นสำหรับผู้ใช้ทั่วไป
                try {
                    const idPayload = session.getIdToken().decodePayload();
                    const groups = (idPayload["cognito:groups"] || []).map(group => {
                        const name = String(group).trim().toLowerCase();
                        const aliases = {
                            documentreceiver: "document_officer",
                            "staff/instructor": "faculty_staff",
                            instructor: "faculty_staff"
                        };
                        return aliases[name] || name;
                    });

                    if (groups.includes("admin")) {
                        role = "admin";
                    } else if (groups.includes("document_officer")) {
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

                localStorage.setItem("docuflow_role", role);

                window.location.href = "dashboard.html";
            },

            onFailure: (error) => {
                console.error("Cognito login failed:", error);

                loginMessage.textContent =
                    apiErrorMessage ||
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
