const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginButtonText = document.getElementById("loginButtonText");
const loginMessage = document.getElementById("loginMessage");
const togglePassword = document.getElementById("togglePassword");

function getApiBaseUrl() {
    if (
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"
    ) {
        return "http://localhost:3000/api";
    }

    return "https://utvhg6d6o3.execute-api.us-east-1.amazonaws.com/api";
}

togglePassword.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";

    passwordInput.type = isHidden ? "text" : "password";
    togglePassword.textContent = isHidden ? "HIDE" : "SHOW";
    togglePassword.setAttribute(
        "aria-label",
        isHidden ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"
    );
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginMessage.textContent = "";
    loginButton.disabled = true;
    loginButtonText.textContent = "SIGNING IN...";

    try {
        const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: usernameInput.value.trim(),
                password: passwordInput.value
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                result.message || result.error || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
            );
        }

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
```