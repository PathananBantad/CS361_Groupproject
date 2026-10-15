const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || "cs361-ems-db.cgitffpyocio.us-east-1.rds.amazonaws.com",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "admin",
    password: process.env.DB_PASSWORD || "cs362emailbox",
    database: process.env.DB_NAME || "ems",

    charset: "utf8mb4",

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

module.exports = pool;