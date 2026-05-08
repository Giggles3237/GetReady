import "dotenv/config";
import { getPool } from "../src/db.js";

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.query(`
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'vehicles'
        AND COLUMN_NAME = 'stock_number'
        AND NON_UNIQUE = 0
        AND INDEX_NAME <> 'PRIMARY'
    `);

    for (const row of rows) {
      await connection.query(`ALTER TABLE vehicles DROP INDEX ${row.INDEX_NAME}`);
    }

    console.log(rows.length > 0
      ? "Removed unique stock number constraint from vehicles."
      : "No unique stock number constraint found on vehicles.");
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
