const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");
const loginMessage = document.getElementById("loginMessage");
const togglePassword = document.getElementById("togglePassword");
const guestLoginBtn = document.getElementById("guestLoginBtn");

function getApiBaseUrl() {
    return window.API_BASE_URL;
}

// โหลด Username ล่าสุด หรือค่าเริ่มต้นเป็น admin01
document.addEventListener("DOMContentLoaded", () => {
    const savedUser = localStorage.getItem("docuflow_user");
    if (savedUser && savedUser !== "Guest") {
        usernameInput.value = savedUser;
    } else if (!usernameInput.value) {
        usernameInput.value = "";
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

// เข้าสู่ระบบด้วย Username / Password
if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        loginMessage.textContent = "";

        const enteredUsername = usernameInput.value.trim();
        const enteredPassword = passwordInput.value;

        if (!enteredUsername) {
            loginMessage.textContent = "กรุณากรอกชื่อผู้ใช้ (เช่น admin01 หรือ staff01)";
            usernameInput.focus();
            return;
        }

        if (!enteredPassword) {
            loginMessage.textContent = "กรุณากรอกรหัสผ่าน";
            passwordInput.focus();
            return;
        }

        loginButton.disabled = true;
        loginButtonText.textContent = "SIGNING IN...";

        try {
            const fetchOptions = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: enteredUsername,
                    password: enteredPassword
                })
            };

            // เบราว์เซอร์จะไม่ส่ง credentials ถ้าเป็น file:///
            if (window.location.protocol !== "file:") {
                fetchOptions.credentials = "include";
            }

            const response = await fetch(`${getApiBaseUrl()}/auth/login`, fetchOptions);
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    result.message || result.error || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
                );
            }

            // กำหนด Role และ User ใน localStorage ให้ตรงกับที่ Login เข้ามา
            const userRole = (result.user?.roles && result.user.roles[0]) || 
                             (enteredUsername.toLowerCase().includes("admin") ? "admin" : "staff");
            const username = result.user?.username || enteredUsername;

            localStorage.setItem("docuflow_role", userRole);
            localStorage.setItem("docuflow_user", username);

            // เด้งไปยังหน้า Dashboard ทันที
            window.location.href = "dashboard.html";

        } catch (error) {
            console.warn("Login attempt error:", error);

            loginMessage.textContent =
                error.message === "Failed to fetch"
                    ? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Backend ได้ (กรุณารัน node server.js)"
                    : error.message || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

            loginButton.disabled = false;
            loginButtonText.textContent = "SIGN IN";
        }
    });
}

// เข้าสู่ระบบในฐานะ Guest
if (guestLoginBtn) {
    guestLoginBtn.addEventListener("click", async () => {
        guestLoginBtn.disabled = true;
        guestLoginBtn.style.opacity = "0.7";
        guestLoginBtn.style.cursor = "wait";

        try {
            const fetchOptions = { method: "POST" };
            if (window.location.protocol !== "file:") {
                fetchOptions.credentials = "include";
            }
            await fetch(`${getApiBaseUrl()}/auth/guest`, fetchOptions).catch(() => {});
        } finally {
            // บันทึกสถานะ Guest ลงใน localStorage และไปยัง Dashboard ทันที
            localStorage.setItem("docuflow_role", "guest");
            localStorage.setItem("docuflow_user", "Guest");
            window.location.href = "dashboard.html";
        }
    });
}