import "dotenv/config";
import bcrypt from "bcryptjs";
import { getPool, listUsers, updateUserPassword } from "../src/db.js";

const nextPassword = process.argv[2];

if (!nextPassword) {
  console.error("Usage: node scripts/reset-all-passwords.js <temporary-password>");
  process.exit(1);
}

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();
  const passwordHash = await bcrypt.hash(nextPassword, 10);

  try {
    await connection.beginTransaction();

    const users = await listUsers(connection);

    for (const user of users) {
      await updateUserPassword(connection, {
        id: user.id,
        password_hash: passwordHash,
        must_change_password: true
      });
    }

    await connection.commit();
    console.log(`Reset passwords for ${users.length} users.`);
    console.log(`Temporary password set to: ${nextPassword}`);
    console.log("Users will be required to change it at next login.");
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
