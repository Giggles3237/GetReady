import "dotenv/config";
import { getPool } from "../src/db.js";

async function addColumnIfMissing(connection, tableName, columnName, definition) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  if (Number(rows[0]?.count ?? 0) === 0) {
    await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await addColumnIfMissing(connection, "vehicles", "is_archived", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addColumnIfMissing(connection, "vehicles", "archived_at", "DATETIME NULL");
    await connection.commit();
    console.log("Vehicle archive migration complete.");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
