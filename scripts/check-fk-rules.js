const mysql = require('../backend/node_modules/mysql2/promise');
const path = require('path');
const dotenv = require('../backend/node_modules/dotenv');
const envConfig = dotenv.config({ path: path.join(__dirname, '../backend/.env') }).parsed || {};

async function main() {
  const conn = await mysql.createConnection({
    host: envConfig.DB_HOST,
    port: Number(envConfig.DB_PORT || 4000),
    user: envConfig.DB_USER,
    password: envConfig.DB_PASSWORD,
    database: envConfig.DB_NAME,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
  });

  const [rc] = await conn.query(`
    SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = 'ems' AND REFERENCED_TABLE_NAME = 'documents'
  `);
  console.table(rc);

  await conn.end();
}
main().catch(console.error);

