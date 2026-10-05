/* =====================================================
   START BUTTON
===================================================== */

startBtn.addEventListener("click", () => {

    /*
     * ป้องกันการกดซ้ำ
     */
    startBtn.disabled = true;


    /*
     * เริ่ม animation
     * กระดาษจะปลิวออก
     */
    welcomePage.classList.add("fly");


    /*
     * รอ animation แล้วไปหน้า Dashboard
     */
    setTimeout(() => {

        window.location.href = "dashboard.html";

    }, 950);

});