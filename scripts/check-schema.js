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

  const [fks] = await conn.query(`
    SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE REFERENCED_TABLE_NAME = 'documents' AND TABLE_SCHEMA = 'ems'
  `);
  console.log('Foreign keys referencing documents:');
  console.table(fks);

  const [docCols] = await conn.query('SHOW CREATE TABLE documents');
  console.log(docCols[0]['Create Table']);

  await conn.end();
}
main().catch(console.error);

