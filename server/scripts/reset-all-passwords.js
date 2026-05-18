import "dotenv/config";
import { getPool } from "../src/db.js";

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      "UPDATE users SET password_hash = '', must_change_password = FALSE"
    );
    await connection.commit();
    console.log(`Cleared password requirements for ${result.affectedRows ?? 0} users.`);
    console.log("Users now sign in with email only.");
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
