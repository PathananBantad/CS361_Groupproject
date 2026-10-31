const mysql = require("mysql2/promise");
require("dotenv").config();

const dbHost = (process.env.DB_HOST || "").trim();
const isTiDB = dbHost.includes("tidbcloud.com");

const poolConfig = {
    host: dbHost,
    port: Number(process.env.DB_PORT || 3306),
    user: (process.env.DB_USER || process.env.DB_USERNAME || "").replace(/^'|'$/g, "").trim(),
    password: (process.env.DB_PASSWORD || "").replace(/^'|'$/g, "").trim(),
    database: (process.env.DB_NAME || process.env.DB_DATABASE || "ems").replace(/^'|'$/g, "").trim(),

    charset: "utf8mb4",

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

// TiDB Cloud Serverless requires SSL connection
if (isTiDB || process.env.DB_SSL === "true") {
    poolConfig.ssl = {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true
    };
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;
