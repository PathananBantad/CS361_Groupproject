/* =====================================================
   START BUTTON
   คลิกปุ่ม START แล้วเล่น Animation กระดาษปลิว
   จากนั้นนำทางไปยังหน้า login.html ก่อนเข้าใช้งาน
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const startBtn = document.getElementById("startBtn");
    const welcomePage = document.getElementById("welcomePage");

    if (!startBtn) return;

    startBtn.addEventListener("click", () => {
        // ป้องกันการกดซ้ำ
        startBtn.disabled = true;

        // เริ่ม animation กระดาษปลิวออก
        if (welcomePage) {
            welcomePage.classList.add("fly");
        }

        // รอ animation สิ้นสุด แล้วนำทางไปยังหน้า login.html
        setTimeout(() => {
            window.location.href = "login.html";
        }, 900);
    });
});