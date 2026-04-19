import "dotenv/config";
import bcrypt from "bcryptjs";
import { getPool } from "../src/db.js";

const defaultPassword = "ChangeMe123!";
const bootstrapAdmin = {
  id: "u-admin-1",
  name: "System Admin",
  email: "admin@dealership.local",
  role: "admin"
};

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      "ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'salesperson', 'manager', 'bmw_genius', 'detailer', 'service_advisor') NOT NULL"
    );
    await connection.query(
      "ALTER TABLE action_definitions MODIFY COLUMN role ENUM('admin', 'salesperson', 'manager', 'bmw_genius', 'detailer', 'service_advisor') NOT NULL"
    );

    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    await connection.query(
      `INSERT INTO users (id, name, email, role, password_hash, must_change_password, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       email = VALUES(email),
       role = VALUES(role),
       password_hash = COALESCE(NULLIF(users.password_hash, ''), VALUES(password_hash)),
       must_change_password = CASE
         WHEN users.password_hash IS NULL OR users.password_hash = '' THEN VALUES(must_change_password)
         ELSE users.must_change_password
       END,
       is_active = VALUES(is_active)`,
      [bootstrapAdmin.id, bootstrapAdmin.name, bootstrapAdmin.email, bootstrapAdmin.role, passwordHash]
    );

    await connection.commit();
    console.log("Admin role migration complete.");
    console.log(`Bootstrap admin: ${bootstrapAdmin.email}`);
    console.log(`Temporary password (if newly created): ${defaultPassword}`);
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
