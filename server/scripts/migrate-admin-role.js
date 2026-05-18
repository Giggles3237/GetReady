import "dotenv/config";
import { getPool } from "../src/db.js";

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

    await connection.query(
      `INSERT INTO users (id, name, email, role, password_hash, must_change_password, is_active)
       VALUES (?, ?, ?, ?, '', 0, 1)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       email = VALUES(email),
       role = VALUES(role),
       password_hash = '',
       must_change_password = 0,
       is_active = VALUES(is_active)`,
      [bootstrapAdmin.id, bootstrapAdmin.name, bootstrapAdmin.email, bootstrapAdmin.role]
    );

    await connection.commit();
    console.log("Admin role migration complete.");
    console.log(`Bootstrap admin: ${bootstrapAdmin.email}`);
    console.log("Bootstrap admin signs in with email only.");
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
