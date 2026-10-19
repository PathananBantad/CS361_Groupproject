function requireSessionAuth(req, res, next) {
    const user = req.session?.user;

    if (
        !user ||
        !Number.isInteger(Number(user.id)) ||
        Number(user.id) <= 0 ||
        !Array.isArray(user.roles) ||
        user.roles.length === 0 ||
        user.roles.every(role => role === "guest")
    ) {
        return res.status(401).json({
            error: "Unauthorized",
            message: "กรุณาเข้าสู่ระบบก่อนใช้งาน"
        });
    }

    req.authenticatedUser = {
        id: user.id,
        username: user.username,
        roles: user.roles
    };

    next();
}

module.exports = { requireSessionAuth };
