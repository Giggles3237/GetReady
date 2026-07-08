import mysql from "mysql2/promise";

let pool;

export function toMySqlDateTime(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: getRequiredEnv("DB_HOST"),
      port: Number(process.env.DB_PORT || 3306),
      user: getRequiredEnv("DB_USER"),
      password: getRequiredEnv("DB_PASSWORD"),
      database: getRequiredEnv("DB_NAME"),
      ssl: process.env.DB_SSL === "false" ? undefined : { rejectUnauthorized: true },
      dateStrings: true,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  return pool;
}

export async function ensureSessionTable() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id VARCHAR(191) PRIMARY KEY,
      expires_at DATETIME NOT NULL,
      data LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_user_sessions_expires_at (expires_at)
    )
  `);
}

async function addIndexIfMissing(tableName, indexName, ddl) {
  const rows = await runQuery(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  );

  if (Number(rows[0]?.count ?? 0) === 0) {
    await runQuery(ddl);
  }
}

export async function ensureNotificationTables() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS notification_rules (
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

  await runQuery(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
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

  await addIndexIfMissing(
    "notification_rules",
    "idx_notification_rules_bucket",
    "CREATE INDEX idx_notification_rules_bucket ON notification_rules(bucket)"
  );
  await addIndexIfMissing(
    "notification_deliveries",
    "idx_notification_deliveries_vehicle",
    "CREATE INDEX idx_notification_deliveries_vehicle ON notification_deliveries(vehicle_id, created_at)"
  );
  await addIndexIfMissing(
    "notification_deliveries",
    "idx_notification_deliveries_user",
    "CREATE INDEX idx_notification_deliveries_user ON notification_deliveries(user_id, created_at)"
  );
}

async function runQuery(sql, params = [], connection = null) {
  const executor = connection ?? getPool();
  const [rows] = await executor.query(sql, params);
  return rows;
}

const userColumns = `
  id, name, email, role, must_change_password, is_active, created_at, updated_at
`;

export async function listUsers(connection = null) {
  return runQuery(`SELECT ${userColumns} FROM users ORDER BY name ASC`, [], connection);
}

export async function getUser(id, connection = null) {
  const rows = await runQuery(`SELECT ${userColumns} FROM users WHERE id = ? LIMIT 1`, [id], connection);
  return rows[0] ?? null;
}

export async function getUserByEmail(email, connection = null) {
  const rows = await runQuery(
    `SELECT ${userColumns} FROM users WHERE email = ? LIMIT 1`,
    [String(email).trim().toLowerCase()],
    connection
  );
  return rows[0] ?? null;
}

export async function createUser(connection, user) {
  await runQuery(
    `INSERT INTO users (id, name, email, role, password_hash, must_change_password, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.name,
      String(user.email).trim().toLowerCase(),
      user.role,
      user.password_hash,
      user.must_change_password ? 1 : 0,
      user.is_active === false ? 0 : 1
    ],
    connection
  );
}

export async function updateUser(connection, user) {
  await runQuery(
    "UPDATE users SET name = ?, email = ?, role = ?, is_active = ? WHERE id = ?",
    [user.name, String(user.email).trim().toLowerCase(), user.role, user.is_active === false ? 0 : 1, user.id],
    connection
  );
}

export async function listActionDefinitions(connection = null) {
  return runQuery(
    "SELECT action_key, label, role, action_type, enabled, sort_order FROM action_definitions ORDER BY sort_order ASC, action_key ASC",
    [],
    connection
  );
}

export async function updateActionDefinition(connection, action) {
  await runQuery(
    "UPDATE action_definitions SET label = ?, role = ?, action_type = ?, enabled = ?, sort_order = ? WHERE action_key = ?",
    [action.label, action.role, action.type, action.enabled ? 1 : 0, action.sort_order ?? 0, action.key],
    connection
  );
}

export async function listNotificationRules(connection = null) {
  return runQuery(
    `SELECT bucket, user_id, email_enabled, sms_enabled
     FROM notification_rules
     ORDER BY bucket ASC, user_id ASC`,
    [],
    connection
  );
}

export async function replaceNotificationRulesForBucket(connection, bucket, userIds) {
  await runQuery("DELETE FROM notification_rules WHERE bucket = ?", [bucket], connection);

  for (const userId of userIds) {
    await runQuery(
      `INSERT INTO notification_rules (bucket, user_id, email_enabled, sms_enabled)
       VALUES (?, ?, TRUE, FALSE)`,
      [bucket, userId],
      connection
    );
  }
}

const vehicleColumns = `
  id, stock_number, year, make, model, color, status, due_date, current_location, assigned_role,
  assigned_user_id, submitted_by_user_id, needs_service, needs_bodywork, recall_checked, recall_open,
  recall_completed, fueled, qc_required, qc_completed, service_status, bodywork_status,
  service_notes, bodywork_notes, notes, is_archived, archived_at, created_at, updated_at
`;

export async function listVehicles(connection = null) {
  return runQuery(`SELECT ${vehicleColumns} FROM vehicles ORDER BY due_date ASC, stock_number ASC`, [], connection);
}

export async function getVehicle(id, connection = null) {
  const rows = await runQuery(`SELECT ${vehicleColumns} FROM vehicles WHERE id = ? LIMIT 1`, [id], connection);
  return rows[0] ?? null;
}

export async function insertVehicle(connection, vehicle) {
  await runQuery(
    `INSERT INTO vehicles (
      id, stock_number, year, make, model, color, status, due_date, current_location, assigned_role,
      assigned_user_id, submitted_by_user_id, needs_service, needs_bodywork, recall_checked, recall_open,
      recall_completed, fueled, qc_required, qc_completed, service_status, bodywork_status,
      service_notes, bodywork_notes, notes, is_archived, archived_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      vehicle.id,
      vehicle.stock_number,
      vehicle.year,
      vehicle.make,
      vehicle.model,
      vehicle.color,
      vehicle.status,
      toMySqlDateTime(vehicle.due_date),
      vehicle.current_location,
      vehicle.assigned_role,
      vehicle.assigned_user_id,
      vehicle.submitted_by_user_id,
      vehicle.needs_service ? 1 : 0,
      vehicle.needs_bodywork ? 1 : 0,
      vehicle.recall_checked ? 1 : 0,
      vehicle.recall_open ? 1 : 0,
      vehicle.recall_completed ? 1 : 0,
      vehicle.fueled ? 1 : 0,
      vehicle.qc_required ? 1 : 0,
      vehicle.qc_completed ? 1 : 0,
      vehicle.service_status,
      vehicle.bodywork_status,
      vehicle.service_notes,
      vehicle.bodywork_notes,
      vehicle.notes,
      vehicle.is_archived ? 1 : 0,
      toMySqlDateTime(vehicle.archived_at),
      toMySqlDateTime(vehicle.created_at),
      toMySqlDateTime(vehicle.updated_at)
    ],
    connection
  );
}

export async function replaceVehicle(connection, vehicle) {
  await runQuery(
    `UPDATE vehicles SET
      stock_number = ?, year = ?, make = ?, model = ?, color = ?, status = ?, due_date = ?, current_location = ?,
      assigned_role = ?, assigned_user_id = ?, submitted_by_user_id = ?, needs_service = ?, needs_bodywork = ?,
      recall_checked = ?, recall_open = ?, recall_completed = ?, fueled = ?, qc_required = ?, qc_completed = ?,
      service_status = ?, bodywork_status = ?, service_notes = ?, bodywork_notes = ?, notes = ?, is_archived = ?, archived_at = ?, updated_at = ?
    WHERE id = ?`,
    [
      vehicle.stock_number,
      vehicle.year,
      vehicle.make,
      vehicle.model,
      vehicle.color,
      vehicle.status,
      toMySqlDateTime(vehicle.due_date),
      vehicle.current_location,
      vehicle.assigned_role,
      vehicle.assigned_user_id,
      vehicle.submitted_by_user_id,
      vehicle.needs_service ? 1 : 0,
      vehicle.needs_bodywork ? 1 : 0,
      vehicle.recall_checked ? 1 : 0,
      vehicle.recall_open ? 1 : 0,
      vehicle.recall_completed ? 1 : 0,
      vehicle.fueled ? 1 : 0,
      vehicle.qc_required ? 1 : 0,
      vehicle.qc_completed ? 1 : 0,
      vehicle.service_status,
      vehicle.bodywork_status,
      vehicle.service_notes,
      vehicle.bodywork_notes,
      vehicle.notes,
      vehicle.is_archived ? 1 : 0,
      toMySqlDateTime(vehicle.archived_at),
      toMySqlDateTime(vehicle.updated_at),
      vehicle.id
    ],
    connection
  );
}

export async function insertAuditLog(connection, entry) {
  await runQuery(
    "INSERT INTO audit_logs (id, vehicle_id, user_id, action_type, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [entry.id, entry.vehicle_id, entry.user_id, entry.action_type, entry.field_changed, entry.old_value, entry.new_value],
    connection
  );
}

export async function listAuditEntries({ userId = null, vehicleId = null, limit = 100 } = {}, connection = null) {
  const clauses = [];
  const params = [];

  if (userId) {
    clauses.push("user_id = ?");
    params.push(userId);
  }

  if (vehicleId) {
    clauses.push("vehicle_id = ?");
    params.push(vehicleId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(Number(limit));

  return runQuery(
    `SELECT id, vehicle_id, user_id, action_type, field_changed, old_value, new_value, created_at
     FROM audit_logs ${where}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
    connection
  );
}

export async function insertNotificationDelivery(connection, delivery) {
  await runQuery(
    `INSERT INTO notification_deliveries (
      id, vehicle_id, user_id, bucket, channel, recipient, status, provider_message_id, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      delivery.id,
      delivery.vehicle_id,
      delivery.user_id,
      delivery.bucket,
      delivery.channel,
      delivery.recipient,
      delivery.status,
      delivery.provider_message_id ?? null,
      delivery.error_message ?? null
    ],
    connection
  );
}
