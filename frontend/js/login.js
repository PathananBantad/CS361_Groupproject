
const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");
const loginMessage = document.getElementById("loginMessage");
const togglePassword = document.getElementById("togglePassword");
function resolveLoginRole(responseRole, groups = []) {
    const aliases = {
        documentreceiver: "document_officer",
        "staff/instructor": "faculty_staff",
        instructor: "faculty_staff",
        staff: "faculty_staff",
        responsibleperson: "responsible_person",
        responsible_person: "responsible_person"
    };
    const normalize = value => {
        const role = String(value || "").trim().toLowerCase();
        return Object.hasOwn(aliases, role) ? aliases[role] : role;
    };
    const groupRoles = (Array.isArray(groups) ? groups : [groups]).map(normalize).filter(Boolean);
    const candidateRoles = [...groupRoles];
    if (responseRole) candidateRoles.push(normalize(responseRole));

    return ["admin", "executive", "document_officer", "responsible_person", "faculty_staff"]
        .find(role => candidateRoles.includes(role)) || (responseRole ? normalize(responseRole) : groupRoles[0]) || "faculty_staff";
}


// โหลด Username ล่าสุด
document.addEventListener("DOMContentLoaded", () => {
    const savedUser = localStorage.getItem("docuflow_user");

    if (savedUser) {
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

// ฟังก์ชันนำทางไปยัง Dashboard อย่างปลอดภัย รองรับทั้ง URL ที่มี /html/ และไม่มี
function navigateToDashboard() {
    const target = window.location.pathname.startsWith("/html/") ? "dashboard.html" : "/html/dashboard.html";
    window.location.href = target;
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
            // ใช้ฟังก์ชันกลางเพื่อให้ทำงานถูกทั้งบน Local (ทุก port) และ Production
            const apiBase = typeof window.resolveApiBaseUrl === "function"
                ? window.resolveApiBaseUrl()
                : (window.API_BASE_URL + "/api");
            const tuResp = await (window.apiFetch || fetch)(`${apiBase}/auth/tu-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const tuData = await tuResp.json().catch(() => ({}));
            if (tuResp.ok && tuData.ok && tuData.access_token) {
                localStorage.setItem("docuflow_access_token", tuData.access_token);
                localStorage.setItem("docuflow_id_token", tuData.id_token);
                localStorage.setItem("access_token", tuData.access_token);
                localStorage.setItem("id_token", tuData.id_token);
                localStorage.setItem("docuflow_user", tuData.username || username);
                localStorage.setItem("docuflow_role", resolveLoginRole(tuData.role, tuData.groups));

                navigateToDashboard();
                return;
            }

            // กรณี AWS credentials ของเซิร์ฟเวอร์หมดอายุ: บัญชีผู้ใช้ถูกต้องแล้ว ไม่ต้องไปลอง Cognito ต่อ
            // (เพราะจะ fail ด้วย NotAuthorizedException และทำให้ข้อความสับสน) แสดงข้อความแล้วหยุด
            if (tuData && tuData.code === "AWS_CREDENTIALS_EXPIRED") {
                loginMessage.textContent = tuData.message;
                loginButton.disabled = false;
                loginButtonText.textContent = "SIGN IN";
                return;
            }

            // บันทึกข้อความข้อผิดพลาดเฉพาะกรณีที่เป็นข้อผิดพลาดจากธุรกิจ (เช่น รหัสผ่านผิด 401/400)
            // ไม่นำรหัส 500 (Server Error จาก AWS Lab ดับ) มาทับข้อความ เพื่อให้ผู้ใช้ล็อกอินผ่าน Cognito ตรงได้
            if (!tuResp.ok && tuData && tuData.message && tuResp.status < 500) {
                var apiErrorMessage = tuData.message;

                // หากเป็นบัญชีนักศึกษา/บุคลากร มธ. (10 หลัก หรือ @dome.tu.ac.th หรือ @tu.ac.th)
                // เมื่อ TU API ตรวจสอบแล้วพบว่ารหัสผ่านไม่ถูกต้อง ให้แสดงข้อความแจ้งเตือนและหยุดทันที
                // ไม่ต้องส่งไปลองใน AWS Cognito ซ้ำอีก เพื่อป้องกันการติดล็อค "Password attempts exceeded" ของ Cognito!
                const isTuAccount = /^\d{10}$/.test(username) || username.includes("@dome.tu.ac.th") || username.includes("@tu.ac.th");
                if (isTuAccount) {
                    loginMessage.textContent = tuData.message;
                    loginButton.disabled = false;
                    loginButtonText.textContent = "SIGN IN";
                    return;
                }
            }

            if (!tuResp.ok && tuResp.status >= 500) {
                const isTuAccount = /^\d{10}$/.test(username) || username.includes("@dome.tu.ac.th") || username.includes("@tu.ac.th");
                if (isTuAccount) {
                    loginMessage.textContent = "ระบบยืนยันตัวตน TU API กำลังเชื่อมต่อหรือขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
                    loginButton.disabled = false;
                    loginButtonText.textContent = "SIGN IN";
                    return;
                }
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

                localStorage.setItem("docuflow_role", resolveLoginRole(
                    null, session.getAccessToken().decodePayload()["cognito:groups"] ||
                        session.getIdToken().decodePayload()["cognito:groups"]
                ));

                navigateToDashboard();
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
