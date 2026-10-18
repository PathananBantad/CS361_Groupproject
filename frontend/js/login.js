const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");
const loginMessage = document.getElementById("loginMessage");
const togglePassword = document.getElementById("togglePassword");
const guestLoginBtn = document.getElementById("guestLoginBtn");

function getApiBaseUrl() {
    if (
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"
    ) {
        return "http://localhost:3000/api";
    }

    return "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api";
}

// แสดง/ซ่อนรหัสผ่าน
togglePassword.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";

    passwordInput.type = isHidden ? "text" : "password";
    togglePassword.textContent = isHidden ? "HIDE" : "SHOW";
    togglePassword.setAttribute(
        "aria-label",
        isHidden ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"
    );
});


// เข้าสู่ระบบด้วย Username / Password
loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginMessage.textContent = "";
    loginButton.disabled = true;
    loginButtonText.textContent = "SIGNING IN...";

    const enteredUsername = usernameInput.value.trim();
    const enteredPassword = passwordInput.value;

    try {
        const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: enteredUsername,
                password: enteredPassword
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                result.message || result.error || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
            );
        }

        // กำหนด Role และ User ใน localStorage ให้ตรงกับที่ Login เข้ามา
        const userRole = (result.user?.roles && result.user.roles[0]) || (enteredUsername.toLowerCase().includes("admin") ? "admin" : "staff");
        const username = result.user?.username || enteredUsername;

        localStorage.setItem("docuflow_role", userRole);
        localStorage.setItem("docuflow_user", username);

        window.location.href = "dashboard.html";

    } catch (error) {
        console.error("Login error:", error);

        loginMessage.textContent =
            error.message === "Failed to fetch"
                ? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบ Backend"
                : error.message || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง";

        loginButton.disabled = false;
        loginButtonText.textContent = "SIGN IN";
    }
});

// เข้าสู่ระบบในฐานะ Guest
if (guestLoginBtn) {
    guestLoginBtn.addEventListener("click", async () => {
        guestLoginBtn.disabled = true;
        guestLoginBtn.style.opacity = "0.7";
        guestLoginBtn.style.cursor = "wait";

        try {
            await fetch(`${getApiBaseUrl()}/auth/guest`, {
                method: "POST",
                credentials: "include"
            }).catch(() => {});
        } finally {
            // บันทึกสถานะ Guest ลงใน localStorage และไปยัง Dashboard ทันที
            localStorage.setItem("docuflow_role", "guest");
            localStorage.setItem("docuflow_user", "Guest");
            window.location.href = "dashboard.html";
        }
    });
}
```