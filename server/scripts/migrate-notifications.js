import "dotenv/config";
import { getPool } from "../src/db.js";

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );

  return Number(rows[0]?.count ?? 0) > 0;
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  );

  return Number(rows[0]?.count ?? 0) > 0;
}

async function createIndexIfMissing(connection, tableName, indexName, ddl) {
  if (!(await indexExists(connection, tableName, indexName))) {
    await connection.query(ddl);
  }
}

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (!(await tableExists(connection, "notification_rules"))) {
      await connection.query(`
        CREATE TABLE notification_rules (
          bucket VARCHAR(80) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (bucket, user_id),
          CONSTRAINT fk_notification_rule_user FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
    }

    if (!(await tableExists(connection, "notification_deliveries"))) {
      await connection.query(`
        CREATE TABLE notification_deliveries (
          id VARCHAR(36) PRIMARY KEY,
          vehicle_id VARCHAR(36) NOT NULL,
          user_id VARCHAR(36) NOT NULL,
          bucket VARCHAR(80) NOT NULL,
          channel ENUM('email', 'sms') NOT NULL,
          recipient VARCHAR(191) NOT NULL,
          status ENUM('sent', 'failed', 'pending') NOT NULL,
          provider_message_id VARCHAR(191) NULL,
          error_message TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_notification_delivery_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
          CONSTRAINT fk_notification_delivery_user FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
    }

    await createIndexIfMissing(
      connection,
      "notification_rules",
      "idx_notification_rules_bucket",
      "CREATE INDEX idx_notification_rules_bucket ON notification_rules(bucket)"
    );
    await createIndexIfMissing(
      connection,
      "notification_deliveries",
      "idx_notification_deliveries_vehicle",
      "CREATE INDEX idx_notification_deliveries_vehicle ON notification_deliveries(vehicle_id, created_at)"
    );
    await createIndexIfMissing(
      connection,
      "notification_deliveries",
      "idx_notification_deliveries_user",
      "CREATE INDEX idx_notification_deliveries_user ON notification_deliveries(user_id, created_at)"
    );

    await connection.commit();
    console.log("Notification migration complete.");
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
