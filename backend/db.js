const mysql = require("mysql2/promise");
require("dotenv").config();

const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const dbHost = (process.env.DB_HOST || "").trim();
const isTiDB = dbHost.includes("tidbcloud.com");
const dbSecretArn = process.env.DB_SECRET_ARN;

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
        rejectUnauthorized: true,
        ...(process.env.DB_TLS_SERVERNAME ? { servername: process.env.DB_TLS_SERVERNAME } : {})
    };
}

function createSecretBackedPool(secretArn) {
    let poolPromise;

    async function getPool() {
        if (!poolPromise) {
            poolPromise = (async () => {
                const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
                if (!region) {
                    throw new Error("AWS_REGION is required when DB_SECRET_ARN is configured");
                }

                const client = new SecretsManagerClient({ region });
                const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
                if (!response.SecretString) {
                    throw new Error("The configured database secret has no SecretString");
                }

                let credentials;
                try {
                    credentials = JSON.parse(response.SecretString);
                } catch (error) {
                    throw new Error("The configured database secret is not valid JSON", { cause: error });
                }

                if (!credentials.username || !credentials.password) {
                    throw new Error("The configured database secret must contain username and password");
                }

                return mysql.createPool({
                    ...poolConfig,
                    user: credentials.username,
                    password: credentials.password
                });
            })();

            poolPromise.catch(() => {
                poolPromise = null;
            });
        }

        return poolPromise;
    }

    return {
        query: (...args) => getPool().then(pool => pool.query(...args)),
        execute: (...args) => getPool().then(pool => pool.execute(...args)),
        getConnection: () => getPool().then(pool => pool.getConnection()),
        end: () => getPool().then(pool => pool.end())
    };
}

const pool = dbSecretArn
    ? createSecretBackedPool(dbSecretArn)
    : mysql.createPool(poolConfig);

module.exports = pool;
