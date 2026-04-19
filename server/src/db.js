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
    `SELECT ${userColumns}, password_hash FROM users WHERE email = ? LIMIT 1`,
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

export async function updateUserPassword(connection, { id, password_hash, must_change_password }) {
  await runQuery(
    "UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?",
    [password_hash, must_change_password ? 1 : 0, id],
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
