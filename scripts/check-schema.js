const pool = require('../backend/db');

async function main() {
  try {
    const [fks] = await pool.query(`
      SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE REFERENCED_TABLE_NAME = 'documents' AND TABLE_SCHEMA = ?
    `, [process.env.DB_NAME || process.env.DB_DATABASE || 'ems']);
    console.log('Foreign keys referencing documents:');
    console.table(fks);

    const [docCols] = await pool.query('SHOW CREATE TABLE documents');
    console.log(docCols[0]['Create Table']);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('Schema check failed:', error);
  process.exitCode = 1;
});
