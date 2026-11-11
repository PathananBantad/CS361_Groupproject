const pool = require('../backend/db');

async function main() {
  try {
    const [rc] = await pool.query(`
      SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE
      FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME = 'documents'
    `, [process.env.DB_NAME || process.env.DB_DATABASE || 'ems']);
    console.table(rc);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('Foreign-key check failed:', error);
  process.exitCode = 1;
});
