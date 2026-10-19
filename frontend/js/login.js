
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

                // ตรวจสอบ Role จาก Cognito Groups
                let role = "staff";
                try {
                    const idPayload = session.getIdToken().decodePayload();
                    const groups = idPayload["cognito:groups"] || [];
                    if (groups.includes("admin")) {
                        role = "admin";
                    } else if (groups.includes("document_officer") || groups.includes("officer")) {
                        role = "officer";
                    } else if (groups.includes("faculty_staff")) {
                        role = "faculty_staff";
                    } else if (groups.includes("case_owner")) {
                        role = "case_owner";
                    } else if (groups.length > 0) {
                        role = groups[0];
                    } else if (username.toLowerCase().includes("admin")) {
                        role = "admin";
                    }
                } catch (e) {
                    if (username.toLowerCase().includes("admin")) {
                        role = "admin";
                    }
                }

                localStorage.setItem("docuflow_role", role);

                window.location.href = "dashboard.html";
            },

            onFailure: (error) => {
                console.error("Cognito login failed:", error);

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

