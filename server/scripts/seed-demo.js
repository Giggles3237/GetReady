import "dotenv/config";
import bcrypt from "bcryptjs";
import { getPool, toMySqlDateTime } from "../src/db.js";
import { STATUS, deriveAssignedRole } from "../src/workflow.js";

const now = Date.now();
const defaultPassword = "ChangeMe123!";

const users = [
  { id: "u-admin-1", name: "System Admin", email: "admin@dealership.local", role: "admin" },
  { id: "u-sales-1", name: "Chris Lasko", email: "chris@dealership.local", role: "salesperson" },
  { id: "u-mgr-1", name: "Morgan Tate", email: "morgan@dealership.local", role: "manager" },
  { id: "u-genius-1", name: "Avery Stone", email: "avery@dealership.local", role: "bmw_genius" },
  { id: "u-detail-1", name: "Leo Rivers", email: "leo@dealership.local", role: "detailer" },
  { id: "u-service-1", name: "Jordan Price", email: "jordan@dealership.local", role: "service_advisor" }
];

const vehicles = [
  {
    id: "v-1001",
    stock_number: "GR10245",
    year: 2023,
    make: "BMW",
    model: "X5 xDrive40i",
    color: "Black Sapphire",
    status: STATUS.SUBMITTED,
    due_date: new Date(now + 1000 * 60 * 60 * 24).toISOString(),
    current_location: "Sales Lot",
    assigned_user_id: "u-genius-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: false,
    needs_bodywork: false,
    recall_checked: false,
    recall_open: false,
    recall_completed: false,
    fueled: false,
    qc_required: false,
    qc_completed: false,
    service_status: "not_needed",
    bodywork_status: "not_needed",
    service_notes: "",
    bodywork_notes: "",
    notes: "Trade-in arriving from used inventory."
  },
  {
    id: "v-1002",
    stock_number: "GR10246",
    year: 2022,
    make: "BMW",
    model: "330i",
    color: "Alpine White",
    status: STATUS.TO_DETAIL,
    due_date: new Date(now + 1000 * 60 * 60 * 8).toISOString(),
    current_location: "Detail Queue",
    assigned_user_id: "u-detail-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: true,
    needs_bodywork: false,
    recall_checked: true,
    recall_open: false,
    recall_completed: false,
    fueled: false,
    qc_required: true,
    qc_completed: false,
    service_status: "pending",
    bodywork_status: "not_needed",
    service_notes: "Needs tire sensor diagnosis before front line.",
    bodywork_notes: "",
    notes: "Needs tire sensor check before front line."
  },
  {
    id: "v-1003",
    stock_number: "GR10247",
    year: 2021,
    make: "BMW",
    model: "X3 M40i",
    color: "Phytonic Blue",
    status: STATUS.DETAIL_STARTED,
    due_date: new Date(now + 1000 * 60 * 60 * 36).toISOString(),
    current_location: "Detail Bay 2",
    assigned_user_id: "u-detail-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: false,
    needs_bodywork: true,
    recall_checked: false,
    recall_open: false,
    recall_completed: false,
    fueled: true,
    qc_required: false,
    qc_completed: false,
    service_status: "not_needed",
    bodywork_status: "pending",
    service_notes: "",
    bodywork_notes: "Minor rear bumper repair approved.",
    notes: "Minor rear bumper repair approved."
  },
  {
    id: "v-1004",
    stock_number: "GR10248",
    year: 2024,
    make: "BMW",
    model: "i4 eDrive40",
    color: "Brooklyn Grey",
    status: STATUS.REMOVED_FROM_DETAIL,
    due_date: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
    current_location: "Service Drive",
    assigned_user_id: "u-service-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: true,
    needs_bodywork: false,
    recall_checked: true,
    recall_open: true,
    recall_completed: false,
    fueled: true,
    qc_required: true,
    qc_completed: false,
    service_status: "in_progress",
    bodywork_status: "not_needed",
    service_notes: "Software update and inspection still open.",
    bodywork_notes: "",
    notes: "Software update and inspection still open."
  },
  {
    id: "v-1005",
    stock_number: "GR10249",
    year: 2020,
    make: "BMW",
    model: "540i xDrive",
    color: "Carbon Black",
    status: STATUS.QC,
    due_date: new Date(now + 1000 * 60 * 60 * 4).toISOString(),
    current_location: "Delivery Prep",
    assigned_user_id: "u-mgr-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: false,
    needs_bodywork: false,
    recall_checked: true,
    recall_open: false,
    recall_completed: false,
    fueled: true,
    qc_required: true,
    qc_completed: false,
    service_status: "not_needed",
    bodywork_status: "not_needed",
    service_notes: "",
    bodywork_notes: "",
    notes: "Waiting on final manager walkaround."
  }
].map((vehicle) => ({
  ...vehicle,
  assigned_role: deriveAssignedRole(vehicle),
  created_at: new Date(now - 1000 * 60 * 60 * 12).toISOString(),
  updated_at: new Date(now - 1000 * 60 * 20).toISOString()
}));

const auditLogs = [
  {
    id: "audit-1001",
    vehicle_id: "v-1004",
    user_id: "u-genius-1",
    action_type: "status_change",
    field_changed: "status",
    old_value: "detail_finished",
    new_value: "removed_from_detail",
    created_at: new Date(now - 1000 * 60 * 90).toISOString()
  },
  {
    id: "audit-1002",
    vehicle_id: "v-1004",
    user_id: "u-service-1",
    action_type: "flag_update",
    field_changed: "service_status",
    old_value: "pending",
    new_value: "in_progress",
    created_at: new Date(now - 1000 * 60 * 60).toISOString()
  },
  {
    id: "audit-1003",
    vehicle_id: "v-1005",
    user_id: "u-service-1",
    action_type: "flag_update",
    field_changed: "qc_required",
    old_value: "false",
    new_value: "true",
    created_at: new Date(now - 1000 * 60 * 45).toISOString()
  }
];

async function seedUsers(connection) {
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  for (const user of users) {
    await connection.query(
      `INSERT INTO users (id, name, email, role, password_hash, must_change_password, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       email = VALUES(email),
       role = VALUES(role),
       password_hash = VALUES(password_hash),
       must_change_password = VALUES(must_change_password),
       is_active = VALUES(is_active)`,
      [user.id, user.name, user.email, user.role, passwordHash]
    );
  }
}

async function seedVehicles(connection) {
  for (const vehicle of vehicles) {
    await connection.query(
      `INSERT INTO vehicles (
        id, stock_number, year, make, model, color, status, due_date, current_location, assigned_role,
        assigned_user_id, submitted_by_user_id, needs_service, needs_bodywork, recall_checked, recall_open,
        recall_completed, fueled, qc_required, qc_completed, service_status, bodywork_status, service_notes,
        bodywork_notes, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        stock_number = VALUES(stock_number),
        year = VALUES(year),
        make = VALUES(make),
        model = VALUES(model),
        color = VALUES(color),
        status = VALUES(status),
        due_date = VALUES(due_date),
        current_location = VALUES(current_location),
        assigned_role = VALUES(assigned_role),
        assigned_user_id = VALUES(assigned_user_id),
        submitted_by_user_id = VALUES(submitted_by_user_id),
        needs_service = VALUES(needs_service),
        needs_bodywork = VALUES(needs_bodywork),
        recall_checked = VALUES(recall_checked),
        recall_open = VALUES(recall_open),
        recall_completed = VALUES(recall_completed),
        fueled = VALUES(fueled),
        qc_required = VALUES(qc_required),
        qc_completed = VALUES(qc_completed),
        service_status = VALUES(service_status),
        bodywork_status = VALUES(bodywork_status),
        service_notes = VALUES(service_notes),
        bodywork_notes = VALUES(bodywork_notes),
        notes = VALUES(notes),
        updated_at = VALUES(updated_at)`,
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
        toMySqlDateTime(vehicle.created_at),
        toMySqlDateTime(vehicle.updated_at)
      ]
    );
  }
}

async function seedAuditLogs(connection) {
  for (const entry of auditLogs) {
    await connection.query(
      `INSERT INTO audit_logs (id, vehicle_id, user_id, action_type, field_changed, old_value, new_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       action_type = VALUES(action_type),
       field_changed = VALUES(field_changed),
       old_value = VALUES(old_value),
       new_value = VALUES(new_value),
       created_at = VALUES(created_at)`,
      [
        entry.id,
        entry.vehicle_id,
        entry.user_id,
        entry.action_type,
        entry.field_changed,
        entry.old_value,
        entry.new_value,
        toMySqlDateTime(entry.created_at)
      ]
    );
  }
}

async function main() {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await seedUsers(connection);
    await seedVehicles(connection);
    await seedAuditLogs(connection);
    await connection.commit();
    console.log(`Seeded ${users.length} users, ${vehicles.length} vehicles, and ${auditLogs.length} audit entries.`);
    console.log(`Default demo password: ${defaultPassword}`);
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
