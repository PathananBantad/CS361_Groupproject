/**
 * Shared Navbar & User Profile Controller
 * DocuFlow Electronic Mailbox & Document Flow System
 * Unifies topbar search and profile dropdown across all pages.
 */
(function () {
    "use strict";

    const ROLE_LABELS = {
        admin: "ผู้ดูแลระบบ (Admin)",
        document_officer: "เจ้าหน้าที่สารบรรณ",
        officer: "เจ้าหน้าที่สารบรรณ",
        faculty_staff: "อาจารย์ / บุคลากร",
        staff: "อาจารย์ / บุคลากร",
        executive: "ผู้บริหาร",
        guest: "ผู้ใช้ทั่วไป"
    };

    function initNavbarProfile() {
        const userRoleDisplay = document.getElementById("userRoleDisplay");
        const userRoleDot = document.getElementById("userRoleDot");
        const roleMenuBtn = document.getElementById("roleMenuBtn");
        const roleDropdown = document.getElementById("roleDropdown");
        const logoutBtn = document.getElementById("logoutBtn");
        const globalSearch = document.getElementById("globalSearch");
        const userRoleDropdownTitle = document.getElementById("userRoleDropdownTitle");
        const userRoleDropdownEmail = document.getElementById("userRoleDropdownEmail");

        const savedRole = (localStorage.getItem("docuflow_role") || "guest").toLowerCase().trim();
        const savedUser = localStorage.getItem("docuflow_user") || "";
        const token = localStorage.getItem("docuflow_access_token") || localStorage.getItem("access_token") || "";

        // Authentication guard for protected pages
        const currentPath = window.location.pathname.toLowerCase();
        if (!savedUser && !token) {
            if (currentPath.includes("register.html") || currentPath.includes("dashboard.html")) {
                window.location.replace("login.html");
                return;
            }
        }

        const roleLabel = ROLE_LABELS[savedRole] || savedRole || "ไม่ระบุบทบาท";

        // Update profile button display
        if (userRoleDisplay) {
            userRoleDisplay.textContent = `${roleLabel} (${savedUser || "-"})`;
        }

        // Update dot color based on role
        if (userRoleDot) {
            userRoleDot.className = "profile-icon";
            if (savedRole === "admin") {
                userRoleDot.classList.add("role-admin");
            } else if (savedRole === "executive") {
                userRoleDot.classList.add("role-executive");
            } else if (savedRole === "document_officer" || savedRole === "officer") {
                userRoleDot.classList.add("role-officer");
            } else if (savedRole === "guest") {
                userRoleDot.classList.add("role-guest");
            } else {
                userRoleDot.classList.add("role-staff");
            }
        }

        // Update dropdown header info
        if (userRoleDropdownTitle) {
            userRoleDropdownTitle.textContent = roleLabel;
        }
        if (userRoleDropdownEmail) {
            userRoleDropdownEmail.textContent = savedUser || "ผู้ใช้งานระบบ DocuFlow";
        }

        // Toggle profile dropdown menu
        if (roleMenuBtn && roleDropdown) {
            roleMenuBtn.onclick = function (e) {
                e.stopPropagation();
                const isExpanded = roleMenuBtn.getAttribute("aria-expanded") === "true";
                roleMenuBtn.setAttribute("aria-expanded", String(!isExpanded));
                roleDropdown.hidden = isExpanded;
            };

            document.addEventListener("click", function (e) {
                if (!roleMenuBtn.contains(e.target) && !roleDropdown.contains(e.target)) {
                    roleMenuBtn.setAttribute("aria-expanded", "false");
                    roleDropdown.hidden = true;
                }
            });
        }

        // Handle Logout
        if (logoutBtn) {
            logoutBtn.onclick = function (e) {
                e.preventDefault();
                localStorage.removeItem("docuflow_role");
                localStorage.removeItem("docuflow_user");
                localStorage.removeItem("docuflow_access_token");
                localStorage.removeItem("docuflow_id_token");
                localStorage.removeItem("access_token");
                localStorage.removeItem("id_token");
                window.location.href = "login.html";
            };
        }

        // Cross-page search: redirect to dashboard.html with query if user presses Enter
        if (globalSearch && !currentPath.endsWith("dashboard.html")) {
            globalSearch.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const query = encodeURIComponent(globalSearch.value.trim());
                    window.location.href = `dashboard.html${query ? `?search=${query}` : ""}`;
                }
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initNavbarProfile);
    } else {
        initNavbarProfile();
    }

    window.initNavbarProfile = initNavbarProfile;
})();
