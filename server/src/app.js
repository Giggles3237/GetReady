import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import session from "express-session";
import { v4 as uuid } from "uuid";
import {
  ROLE_LABELS,
  STATUS,
  STATUS_META,
  buildActionList,
  canTransition,
  computeBlockingIssues,
  deriveAssignedRole,
  formatStatus,
  getPipelineColumn,
  roleCanHandleAction,
  syncWorkflowState
} from "./workflow.js";
import {
  getPool,
  listActionDefinitions,
  listUsers,
  getUser,
  getUserByEmail,
  getVehicle,
  listVehicles,
  listAuditEntries,
  updateActionDefinition,
  createUser,
  updateUser,
  updateUserPassword,
  insertVehicle,
  replaceVehicle,
  insertAuditLog
} from "./db.js";

const app = express();
const port = process.env.PORT || 4000;
const isProduction = process.env.NODE_ENV === "production";

function isAdmin(user) {
  return user?.role === "admin";
}

function hasManagerAccess(user) {
  return ["admin", "manager"].includes(user?.role);
}

function buildAllowedOrigins() {
  const configured = String(process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured;
  }

  return ["http://localhost:5173", "http://127.0.0.1:5173"];
}

const allowedOrigins = buildAllowedOrigins();

app.set("trust proxy", 1);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS."));
  },
  credentials: true
}));
app.use(express.json());
app.use(session({
  name: "getready.sid",
  secret: process.env.SESSION_SECRET || "change-me-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 12
  }
}));

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: Boolean(user.must_change_password),
    is_active: Boolean(user.is_active),
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

function inferLocation(vehicle) {
  if (vehicle.status === STATUS.SUBMITTED) return "Sales Lot";
  if (vehicle.status === STATUS.TO_DETAIL) return "Detail Queue";
  if (vehicle.status === STATUS.DETAIL_STARTED) return "Detail Bay";
  if (vehicle.status === STATUS.DETAIL_FINISHED) return "Detail Complete - Awaiting Warehouse";
  if (vehicle.status === STATUS.REMOVED_FROM_DETAIL) return "Warehouse";
  if (vehicle.status === STATUS.SERVICE) return "Service Drive";
  if (vehicle.status === STATUS.QC) return "Warehouse QC";
  if (vehicle.status === STATUS.READY) return "Front Line";
  return vehicle.current_location ?? "Unknown";
}

function normalizeVehicle(row) {
  return {
    ...row,
    year: Number(row.year),
    needs_service: Boolean(row.needs_service),
    needs_bodywork: Boolean(row.needs_bodywork),
    recall_checked: Boolean(row.recall_checked),
    recall_open: Boolean(row.recall_open),
    recall_completed: Boolean(row.recall_completed),
    fueled: Boolean(row.fueled),
    qc_required: Boolean(row.qc_required),
    qc_completed: Boolean(row.qc_completed)
  };
}

function normalizeActionDefinition(row) {
  return {
    key: row.action_key,
    label: row.label,
    role: row.role,
    type: row.action_type,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order)
  };
}

function decorateAuditEntry(entry, usersById, vehiclesById) {
  return {
    ...entry,
    user: usersById.get(entry.user_id) ?? null,
    vehicle: entry.vehicle_id ? vehiclesById.get(entry.vehicle_id) ?? null : null,
    scope: entry.vehicle_id ? "vehicle" : "system"
  };
}

function decorateVehicle(vehicle, usersById, timelineEntries, actionDefinitions, currentUserId = null) {
  const currentUserRole = currentUserId ? usersById.get(currentUserId)?.role ?? null : null;
  const actions = buildActionList(vehicle, actionDefinitions, currentUserId, currentUserRole);
  return {
    ...vehicle,
    assigned_role: deriveAssignedRole(vehicle),
    actions,
    pipeline: getPipelineColumn(vehicle),
    blockers: computeBlockingIssues(vehicle),
    assigned_user: vehicle.assigned_user_id ? usersById.get(vehicle.assigned_user_id) ?? null : null,
    submitted_by: vehicle.submitted_by_user_id ? usersById.get(vehicle.submitted_by_user_id) ?? null : null,
    timeline: timelineEntries
  };
}

function getQueueForRole(vehicle, role, actionDefinitions, userId = null) {
  return buildActionList(vehicle, actionDefinitions, userId, role).some((action) => roleCanHandleAction(action.key, role));
}

const statusOrder = {
  [STATUS.SUBMITTED]: 1,
  [STATUS.TO_DETAIL]: 2,
  [STATUS.DETAIL_STARTED]: 3,
  [STATUS.DETAIL_FINISHED]: 4,
  [STATUS.REMOVED_FROM_DETAIL]: 5,
  [STATUS.SERVICE]: 6,
  [STATUS.QC]: 7,
  [STATUS.READY]: 8
};

function isStatusUndo(currentStatus, nextStatus) {
  return (statusOrder[nextStatus] ?? 0) < (statusOrder[currentStatus] ?? 0);
}

function getProtectedUndoField(vehicle, changes) {
  const checks = [
    { field: "recall_checked", blocked: vehicle.recall_checked === true && changes.recall_checked === false },
    { field: "recall_open", blocked: vehicle.recall_open === true && changes.recall_open === false },
    { field: "recall_completed", blocked: vehicle.recall_completed === true && changes.recall_completed === false },
    { field: "fueled", blocked: vehicle.fueled === true && changes.fueled === false },
    { field: "qc_completed", blocked: vehicle.qc_completed === true && changes.qc_completed === false },
    { field: "service_status", blocked: vehicle.service_status === "completed" && changes.service_status && changes.service_status !== "completed" },
    { field: "bodywork_status", blocked: vehicle.bodywork_status === "completed" && changes.bodywork_status && changes.bodywork_status !== "completed" }
  ];

  return checks.find((item) => item.blocked)?.field ?? null;
}

function generateTemporaryPassword() {
  return `Temp${Math.random().toString(36).slice(2, 8)}!9`;
}

async function addAuditEntry(connection, { vehicleId = null, userId, actionType, fieldChanged, oldValue, newValue }) {
  await insertAuditLog(connection, {
    id: uuid(),
    vehicle_id: vehicleId || null,
    user_id: userId,
    action_type: actionType,
    field_changed: fieldChanged,
    old_value: oldValue == null ? null : String(oldValue),
    new_value: newValue == null ? null : String(newValue)
  });
}

async function updateVehicleWithAudit(vehicleId, changes, userId, actionType) {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const currentVehicle = normalizeVehicle(await getVehicle(vehicleId, connection));

    if (!currentVehicle) {
      throw Object.assign(new Error("Vehicle not found."), { statusCode: 404 });
    }

    for (const [field, newValue] of Object.entries(changes)) {
      const oldValue = currentVehicle[field];
      if (String(oldValue ?? "") !== String(newValue ?? "")) {
        await addAuditEntry(connection, {
          vehicleId: currentVehicle.id,
          userId,
          actionType,
          fieldChanged: field,
          oldValue,
          newValue
        });
      }
    }

    Object.assign(currentVehicle, changes);
    syncWorkflowState(currentVehicle);
    currentVehicle.current_location = inferLocation(currentVehicle);
    currentVehicle.assigned_role = deriveAssignedRole(currentVehicle);
    currentVehicle.updated_at = new Date().toISOString();

    await replaceVehicle(connection, currentVehicle);
    await connection.commit();

    return currentVehicle;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function loadSessionUser(req, _res, next) {
  if (!req.session?.userId) {
    req.currentUser = null;
    next();
    return;
  }

  req.currentUser = sanitizeUser(await getUser(req.session.userId));
  if (!req.currentUser || !req.currentUser.is_active) {
    req.session.destroy(() => {});
    req.currentUser = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ message: "Please sign in." });
    return;
  }

  next();
}

function requireManager(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ message: "Please sign in." });
    return;
  }

  if (!hasManagerAccess(req.currentUser)) {
    res.status(403).json({ message: "Manager access is required." });
    return;
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ message: "Please sign in." });
    return;
  }

  if (!isAdmin(req.currentUser)) {
    res.status(403).json({ message: "Admin access is required." });
    return;
  }

  next();
}

app.use(loadSessionUser);

app.get("/api/health", async (_req, res) => {
  await getPool().query("SELECT 1");
  res.json({ ok: true, service: "get-ready-api" });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  const user = await getUserByEmail(email);
  if (!user || !user.password_hash || !user.is_active) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  req.session.userId = user.id;
  res.json({ user: sanitizeUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.currentUser });
});

app.patch("/api/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ message: "Current password and a new password of at least 8 characters are required." });
  }

  const authUser = await getUserByEmail(req.currentUser.email);
  const validPassword = authUser?.password_hash ? await bcrypt.compare(currentPassword, authUser.password_hash) : false;

  if (!validPassword) {
    return res.status(401).json({ message: "Current password is incorrect." });
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await updateUserPassword(connection, {
      id: req.currentUser.id,
      password_hash: await bcrypt.hash(newPassword, 10),
      must_change_password: false
    });
    await addAuditEntry(connection, {
      userId: req.currentUser.id,
      actionType: "password_change",
      fieldChanged: `user:${req.currentUser.id}:password`,
      oldValue: "",
      newValue: "updated"
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.json({ user: sanitizeUser(await getUser(req.currentUser.id)) });
});

app.use("/api", requireAuth);

app.get("/api/users", async (_req, res) => {
  const users = (await listUsers()).map(sanitizeUser);
  res.json({ users });
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { name, email, role } = req.body;

  if (!name || !email || !role || !ROLE_LABELS[role]) {
    return res.status(400).json({ message: "Name, email, and valid role are required." });
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return res.status(409).json({ message: "That email is already in use." });
  }

  const temporaryPassword = generateTemporaryPassword();
  const newUser = {
    id: uuid(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    role,
    password_hash: await bcrypt.hash(temporaryPassword, 10),
    must_change_password: true,
    is_active: true
  };

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await createUser(connection, newUser);
    await addAuditEntry(connection, {
      userId: req.currentUser.id,
      actionType: "admin_user_create",
      fieldChanged: `user:${newUser.id}:created`,
      oldValue: "",
      newValue: `${newUser.name} (${newUser.role})`
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.status(201).json({
    user: sanitizeUser(await getUser(newUser.id)),
    temporaryPassword,
    users: (await listUsers()).map(sanitizeUser)
  });
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const { name, email, role, is_active } = req.body;
  const targetUser = await getUser(req.params.id);

  if (!targetUser) {
    return res.status(404).json({ message: "User not found." });
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const nextUser = { ...targetUser };

    if (typeof name === "string" && name.trim() && targetUser.name !== name.trim()) {
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_user_update",
        fieldChanged: `user:${targetUser.id}:name`,
        oldValue: targetUser.name,
        newValue: name.trim()
      });
      nextUser.name = name.trim();
    }

    if (typeof email === "string" && email.trim() && targetUser.email !== email.trim().toLowerCase()) {
      const existingUser = await getUserByEmail(email, connection);
      if (existingUser && existingUser.id !== targetUser.id) {
        throw Object.assign(new Error("That email is already in use."), { statusCode: 409 });
      }

      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_user_update",
        fieldChanged: `user:${targetUser.id}:email`,
        oldValue: targetUser.email,
        newValue: email.trim().toLowerCase()
      });
      nextUser.email = email.trim().toLowerCase();
    }

    if (typeof role === "string" && ROLE_LABELS[role] && targetUser.role !== role) {
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_user_update",
        fieldChanged: `user:${targetUser.id}:role`,
        oldValue: targetUser.role,
        newValue: role
      });
      nextUser.role = role;
    }

    if (typeof is_active === "boolean" && Boolean(targetUser.is_active) !== is_active) {
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_user_update",
        fieldChanged: `user:${targetUser.id}:is_active`,
        oldValue: targetUser.is_active,
        newValue: is_active
      });
      nextUser.is_active = is_active;
    }

    await updateUser(connection, nextUser);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.json({ user: sanitizeUser(await getUser(req.params.id)), users: (await listUsers()).map(sanitizeUser) });
});

app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
  const targetUser = await getUser(req.params.id);

  if (!targetUser) {
    return res.status(404).json({ message: "User not found." });
  }

  const temporaryPassword = generateTemporaryPassword();
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await updateUserPassword(connection, {
      id: targetUser.id,
      password_hash: await bcrypt.hash(temporaryPassword, 10),
      must_change_password: true
    });
    await addAuditEntry(connection, {
      userId: req.currentUser.id,
      actionType: "admin_password_reset",
      fieldChanged: `user:${targetUser.id}:password_reset`,
      oldValue: "",
      newValue: "temporary password issued"
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.json({ temporaryPassword });
});

app.get("/api/admin/actions", requireAdmin, async (_req, res) => {
  const actions = (await listActionDefinitions()).map(normalizeActionDefinition);
  res.json({ actions });
});

app.patch("/api/admin/actions/:key", requireAdmin, async (req, res) => {
  const { label, role, enabled } = req.body;
  const actions = (await listActionDefinitions()).map(normalizeActionDefinition);
  const action = actions.find((item) => item.key === req.params.key);

  if (!action) {
    return res.status(404).json({ message: "Action not found." });
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const nextAction = { ...action };

    if (typeof label === "string" && label.trim() && nextAction.label !== label.trim()) {
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_action_update",
        fieldChanged: `action:${action.key}:label`,
        oldValue: nextAction.label,
        newValue: label.trim()
      });
      nextAction.label = label.trim();
    }

    if (typeof role === "string" && ROLE_LABELS[role] && nextAction.role !== role) {
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_action_update",
        fieldChanged: `action:${action.key}:role`,
        oldValue: nextAction.role,
        newValue: role
      });
      nextAction.role = role;
    }

    if (typeof enabled === "boolean" && nextAction.enabled !== enabled) {
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_action_update",
        fieldChanged: `action:${action.key}:enabled`,
        oldValue: nextAction.enabled,
        newValue: enabled
      });
      nextAction.enabled = enabled;
    }

    await updateActionDefinition(connection, nextAction);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.json({ actions: (await listActionDefinitions()).map(normalizeActionDefinition) });
});

app.get("/api/admin/audit", requireAdmin, async (req, res) => {
  const { vehicleId, limit = 100 } = req.query;
  const [users, vehicles, entries] = await Promise.all([
    listUsers(),
    listVehicles(),
    listAuditEntries({ vehicleId, limit: Number(limit) })
  ]);

  const usersById = new Map(users.map((user) => [user.id, sanitizeUser(user)]));
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, normalizeVehicle(vehicle)]));

  res.json({
    audit: entries.map((entry) => decorateAuditEntry(entry, usersById, vehiclesById))
  });
});

app.get("/api/vehicles", async (req, res) => {
  const { search, view = "mine" } = req.query;
  const requestedRole = typeof req.query.role === "string" && req.query.role !== "all" ? req.query.role : req.currentUser.role;
  const role = requestedRole === "admin" ? "manager" : requestedRole;
  const includeAllSalespersonVehicles = role === "salesperson" && view === "all";
  const normalizedSearch = String(search ?? "").trim().toLowerCase();
  const [users, actionDefinitionsRaw, vehiclesRaw] = await Promise.all([
    listUsers(),
    listActionDefinitions(),
    listVehicles()
  ]);

  const usersById = new Map(users.map((user) => [user.id, sanitizeUser(user)]));
  const actionDefinitions = actionDefinitionsRaw.map(normalizeActionDefinition);
  const filteredRows = vehiclesRaw.map(normalizeVehicle);
  const decorated = filteredRows.map((vehicle) => decorateVehicle(vehicle, usersById, [], actionDefinitions, req.currentUser.id));

  let filtered = decorated.filter((vehicle) =>
    getQueueForRole(vehicle, role, actionDefinitions, req.currentUser.id) ||
    (role === "manager" && vehicle.assigned_role === role) ||
    (role === "salesperson" && (includeAllSalespersonVehicles || vehicle.submitted_by_user_id === req.currentUser.id)) ||
    (vehicle.assigned_role === role && (role !== "detailer" || vehicle.status !== STATUS.DETAIL_STARTED || vehicle.assigned_user_id === req.currentUser.id))
  );

  if (role === "detailer") {
    filtered = filtered.filter((vehicle) => vehicle.status !== STATUS.DETAIL_STARTED || vehicle.assigned_user_id === req.currentUser.id);
  }

  if (normalizedSearch) {
    filtered = filtered.filter((vehicle) =>
      [vehicle.stock_number, vehicle.make, vehicle.model, vehicle.color, vehicle.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }

  res.json({ vehicles: filtered });
});

app.get("/api/vehicles/:id", async (req, res) => {
  const [vehicleRow, users, actionDefinitionsRaw, auditEntries] = await Promise.all([
    getVehicle(req.params.id),
    listUsers(),
    listActionDefinitions(),
    listAuditEntries({ vehicleId: req.params.id, limit: 250 })
  ]);

  if (!vehicleRow) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  const vehicle = normalizeVehicle(vehicleRow);
  const usersById = new Map(users.map((user) => [user.id, sanitizeUser(user)]));
  const vehiclesById = new Map([[vehicle.id, vehicle]]);
  const actionDefinitions = actionDefinitionsRaw.map(normalizeActionDefinition);
  const timeline = auditEntries.map((entry) => decorateAuditEntry(entry, usersById, vehiclesById));

  res.json({ vehicle: decorateVehicle(vehicle, usersById, timeline, actionDefinitions, req.currentUser.id) });
});

app.post("/api/vehicles", async (req, res) => {
  const {
    stock_number,
    year,
    make,
    model,
    color,
    due_date,
    submitted_by_user_id,
    assigned_user_id = null,
    needs_service = false,
    needs_bodywork = false,
    service_notes = "",
    bodywork_notes = "",
    qc_required = false,
    notes = ""
  } = req.body;

  if (!stock_number || !year || !make || !model || !due_date) {
    return res.status(400).json({ message: "Missing required vehicle fields." });
  }

  const existing = (await listVehicles()).find((vehicle) => vehicle.stock_number.toLowerCase() === String(stock_number).toLowerCase());
  if (existing) {
    return res.status(409).json({ message: "That stock number already exists." });
  }

  const users = await listUsers();
  const usersById = new Map(users.map((user) => [user.id, user]));
  const submittedByUserId = hasManagerAccess(req.currentUser) && submitted_by_user_id
    ? submitted_by_user_id
    : req.currentUser.id;

  const submittedByUser = usersById.get(submittedByUserId);
  if (!submittedByUser) {
    return res.status(400).json({ message: "The selected salesperson could not be found." });
  }

  if (!hasManagerAccess(req.currentUser) && submittedByUserId !== req.currentUser.id) {
    return res.status(403).json({ message: "Only a Manager can submit a get ready for another user." });
  }

  const initialAssignedUserId = hasManagerAccess(req.currentUser) && assigned_user_id ? assigned_user_id : null;
  if (initialAssignedUserId && !usersById.has(initialAssignedUserId)) {
    return res.status(400).json({ message: "The selected assigned user could not be found." });
  }

  const vehicle = {
    id: uuid(),
    stock_number,
    year: Number(year),
    make,
    model,
    color,
    status: STATUS.SUBMITTED,
    due_date,
    current_location: "Submitted",
    assigned_user_id: initialAssignedUserId,
    submitted_by_user_id: submittedByUserId,
    needs_service: Boolean(needs_service),
    needs_bodywork: Boolean(needs_bodywork),
    recall_checked: false,
    recall_open: false,
    recall_completed: false,
    fueled: false,
    qc_required: Boolean(qc_required),
    qc_completed: false,
    service_status: needs_service ? "pending" : "not_needed",
    bodywork_status: needs_bodywork ? "pending" : "not_needed",
    service_notes: needs_service ? service_notes : "",
    bodywork_notes: needs_bodywork ? bodywork_notes : "",
    notes,
    assigned_role: "bmw_genius",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await insertVehicle(connection, vehicle);
    await addAuditEntry(connection, {
      vehicleId: vehicle.id,
      userId: req.currentUser.id,
      actionType: "vehicle_created",
      fieldChanged: "status",
      oldValue: "",
      newValue: "Get Ready Submitted"
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.status(201).json({ vehicle });
});

app.patch("/api/vehicles/:id/status", async (req, res) => {
  const { status } = req.body;
  const vehicleRow = await getVehicle(req.params.id);

  if (!vehicleRow) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  const vehicle = normalizeVehicle(vehicleRow);

  if (status === STATUS.READY && !["admin", "salesperson", "manager"].includes(req.currentUser.role)) {
    return res.status(403).json({ message: "Only Salespeople, Managers, and Admins can mark a car completed." });
  }

  if (isStatusUndo(vehicle.status, status) && !hasManagerAccess(req.currentUser)) {
    return res.status(403).json({ message: "Only a Manager or Admin can undo a completed status step." });
  }

  const transition = canTransition(vehicle, status);
  if (!transition.allowed) {
    return res.status(400).json({ message: transition.message, blockers: transition.blockers ?? [] });
  }

  const nextVehicle = await updateVehicleWithAudit(
    vehicle.id,
    {
      status,
      assigned_user_id: status === STATUS.DETAIL_STARTED ? req.currentUser.id : vehicle.assigned_user_id,
      assigned_role: STATUS_META[status]?.nextRole ?? deriveAssignedRole(vehicle)
    },
    req.currentUser.id,
    "status_change"
  );

  res.json({ vehicle: nextVehicle });
});

app.patch("/api/vehicles/:id/flags", async (req, res) => {
  const vehicleRow = await getVehicle(req.params.id);

  if (!vehicleRow) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  const vehicle = normalizeVehicle(vehicleRow);
  const normalized = { ...req.body };
  const protectedUndoField = getProtectedUndoField(vehicle, normalized);

  if (protectedUndoField && !hasManagerAccess(req.currentUser)) {
    return res.status(403).json({ message: `Only a Manager or Admin can undo ${protectedUndoField.replaceAll("_", " ")} once it is complete.` });
  }

  if (typeof normalized.needs_service === "boolean") {
    normalized.service_status = normalized.needs_service ? (vehicle.service_status === "not_needed" ? "pending" : vehicle.service_status) : "not_needed";
    if (!normalized.needs_service) {
      normalized.service_notes = "";
    }
  }

  if (typeof normalized.needs_bodywork === "boolean") {
    normalized.bodywork_status = normalized.needs_bodywork ? (vehicle.bodywork_status === "not_needed" ? "pending" : vehicle.bodywork_status) : "not_needed";
    if (!normalized.needs_bodywork) {
      normalized.bodywork_notes = "";
    }
  }

  if (normalized.recall_checked === true) {
    normalized.recall_open = false;
    normalized.recall_completed = false;
  }

  if (normalized.recall_open === true) {
    normalized.recall_checked = true;
    normalized.recall_completed = false;
  }

  if (normalized.recall_completed === true) {
    normalized.recall_checked = true;
    normalized.recall_open = true;
  }

  if (normalized.qc_completed === true && vehicle.status !== STATUS.READY) {
    normalized.status = STATUS.QC;
  }

  const nextVehicle = await updateVehicleWithAudit(vehicle.id, normalized, req.currentUser.id, "flag_update");
  res.json({ vehicle: nextVehicle });
});

app.get("/api/dashboard/summary", async (req, res) => {
  const requestedRole = typeof req.query.role === "string" && req.query.role !== "all" ? req.query.role : req.currentUser.role;
  const role = requestedRole === "admin" ? "manager" : requestedRole;
  const includeAllSalespersonVehicles = role === "salesperson" && req.query.view === "all";
  const [actionDefinitionsRaw, vehiclesRaw] = await Promise.all([listActionDefinitions(), listVehicles()]);
  const actionDefinitions = actionDefinitionsRaw.map(normalizeActionDefinition);
  const vehicles = vehiclesRaw
    .map(normalizeVehicle)
    .filter((vehicle) => role !== "salesperson" || includeAllSalespersonVehicles || vehicle.submitted_by_user_id === req.currentUser.id);
  const now = Date.now();

  const summary = {
    total: vehicles.length,
    overdue: vehicles.filter((vehicle) => new Date(vehicle.due_date).getTime() < now && vehicle.status !== STATUS.READY).length,
    ready: vehicles.filter((vehicle) => vehicle.status === STATUS.READY).length,
    needsAction: vehicles.filter((vehicle) => getQueueForRole(vehicle, role, actionDefinitions, req.currentUser.id)).length,
    byPipeline: ["Submitted", "At Detail", "In Detail", "Service", "QC", "Ready"].map((column) => ({
      column,
      count: vehicles.filter((vehicle) => getPipelineColumn(vehicle) === column).length
    }))
  };

  res.json({ summary });
});

app.get("/api/dashboard/calendar", async (_req, res) => {
  const items = (await listVehicles())
    .map(normalizeVehicle)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
    .map((vehicle) => ({
      id: vehicle.id,
      title: `${vehicle.stock_number} - ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      due_date: vehicle.due_date,
      overdue: new Date(vehicle.due_date).getTime() < Date.now() && vehicle.status !== STATUS.READY,
      status: formatStatus(vehicle.status)
    }));

  res.json({ items });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    roles: ROLE_LABELS,
    statuses: Object.entries(STATUS_META).map(([key, meta]) => ({ key, ...meta }))
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({ message: err.message || "Unexpected server error." });
});

app.listen(port, async () => {
  await getPool().query("SELECT 1");
  console.log(`Get Ready API listening on ${port}`);
});
