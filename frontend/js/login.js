
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

        loginButton.disabled = true;
        loginButtonText.textContent = "SIGNING IN...";

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    username,
                    password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message ||
                    "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
                );
            }

            // Backend สร้าง Session Cookie ให้แล้ว
            // ไม่ต้องเก็บ Cognito Token ใน localStorage
            localStorage.removeItem("docuflow_access_token");
            localStorage.removeItem("docuflow_id_token");
            localStorage.removeItem("docuflow_role");

            localStorage.setItem("docuflow_user", username);

            window.location.href = "dashboard.html";

        } catch (error) {
            console.error("Login failed:", error);

            loginMessage.textContent =
                error.message ||
                "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง";

        } finally {
            loginButton.disabled = false;
            loginButtonText.textContent = "SIGN IN";
        }
    });
}

// Guest ไม่สามารถข้ามการยืนยันตัวตน
if (guestLoginBtn) {
    guestLoginBtn.addEventListener("click", (event) => {
        event.preventDefault();

        loginMessage.textContent =
            "กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับอนุญาต";
    });
}
