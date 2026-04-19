import "dotenv/config";
import bcrypt from "bcryptjs";
import { getPool } from "../src/db.js";

const defaultPassword = "ChangeMe123!";

const defaultEmails = new Map([
  ["u-sales-1", "chris@dealership.local"],
  ["u-mgr-1", "morgan@dealership.local"],
  ["u-genius-1", "avery@dealership.local"],
  ["u-detail-1", "leo@dealership.local"],
  ["u-service-1", "jordan@dealership.local"]
]);

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

async function addUniqueIndexIfMissing(connection, tableName, indexName, ddl) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  );

  if (Number(rows[0]?.count ?? 0) === 0) {
    await connection.query(ddl);
  }
}

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  try {
    await connection.beginTransaction();

    await addColumnIfMissing(connection, "users", "email", "VARCHAR(191) NULL");
    await addColumnIfMissing(connection, "users", "password_hash", "VARCHAR(255) NULL");
    await addColumnIfMissing(connection, "users", "must_change_password", "BOOLEAN NOT NULL DEFAULT TRUE");
    await addColumnIfMissing(connection, "users", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE");

    const [users] = await connection.query("SELECT id, name, email, password_hash FROM users");
    for (const user of users) {
      const fallbackEmail =
        defaultEmails.get(user.id) ??
        `${String(user.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "")}@dealership.local`;

      await connection.query(
        `UPDATE users
         SET email = COALESCE(NULLIF(email, ''), ?),
             password_hash = COALESCE(NULLIF(password_hash, ''), ?),
             must_change_password = CASE
               WHEN password_hash IS NULL OR password_hash = '' THEN TRUE
               ELSE must_change_password
             END,
             is_active = COALESCE(is_active, TRUE)
         WHERE id = ?`,
        [fallbackEmail, passwordHash, user.id]
      );
    }

    await connection.query("ALTER TABLE users MODIFY COLUMN email VARCHAR(191) NOT NULL");
    await connection.query("ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NOT NULL");
    await addUniqueIndexIfMissing(connection, "users", "uq_users_email", "CREATE UNIQUE INDEX uq_users_email ON users(email)");

    await connection.commit();
    console.log("Auth migration complete.");
    console.log(`Default password applied where missing: ${defaultPassword}`);
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
