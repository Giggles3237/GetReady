import "dotenv/config";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import cors from "cors";
import express from "express";
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
const authTokenTtlDays = Math.max(Number(process.env.AUTH_TOKEN_TTL_DAYS || process.env.SESSION_TTL_DAYS || 90), 1);
const authTokenMaxAgeMs = authTokenTtlDays * 24 * 60 * 60 * 1000;
const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "change-me-in-production";
const integrationKeys = [
  process.env.BOPCHIPBOARD_API_KEY,
  ...String(process.env.INTEGRATION_API_KEYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
].filter(Boolean);

function isAdmin(user) {
  return user?.role === "admin";
}

function hasManagerAccess(user) {
  return ["admin", "manager"].includes(user?.role);
}

function buildAllowedOrigins() {
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost"
  ];
  const configured = String(process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return [...new Set([...configured, ...defaults])];
  }

  return defaults;
}

const allowedOrigins = buildAllowedOrigins();

function readIntegrationKey(req) {
  const headerKey = req.get("x-integration-key");
  if (headerKey) {
    return headerKey.trim();
  }

  const authHeader = req.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return "";
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function signAuthToken(user) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user.id,
    email: normalizeEmail(user.email),
    role: user.role,
    name: user.name,
    exp: Math.floor((Date.now() + authTokenMaxAgeMs) / 1000)
  };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyAuthToken(token) {
  const [encodedHeader, encodedPayload, signature] = String(token || "").split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Malformed token.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (signature !== expectedSignature) {
    throw new Error("Invalid token signature.");
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload));
  if (!payload?.sub || !payload?.exp || payload.exp * 1000 <= Date.now()) {
    throw new Error("Token expired.");
  }

  return payload;
}

function requireBopchipboardKey(req, res, next) {
  if (integrationKeys.length === 0) {
    res.status(500).json({ message: "Bopchipboard integration key is not configured." });
    return;
  }

  const providedKey = readIntegrationKey(req);
  if (!providedKey || !integrationKeys.includes(providedKey)) {
    res.status(401).json({ message: "A valid integration key is required." });
    return;
  }

  next();
}

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
    is_archived: Boolean(row.is_archived),
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
  const completionEntry = timelineEntries.find((entry) => entry.field_changed === "status" && String(entry.new_value).toLowerCase() === "ready") ?? null;
  return {
    ...vehicle,
    assigned_role: deriveAssignedRole(vehicle),
    actions,
    pipeline: getPipelineColumn(vehicle),
    blockers: computeBlockingIssues(vehicle),
    assigned_user: vehicle.assigned_user_id ? usersById.get(vehicle.assigned_user_id) ?? null : null,
    submitted_by: vehicle.submitted_by_user_id ? usersById.get(vehicle.submitted_by_user_id) ?? null : null,
    completion_entry: completionEntry,
    timeline: timelineEntries
  };
}

function getQueueForRole(vehicle, role, actionDefinitions, userId = null) {
  return buildActionList(vehicle, actionDefinitions, userId, role).some((action) => roleCanHandleAction(action.key, role));
}

function getVehicleSearchText(vehicle) {
  return [
    vehicle.stock_number,
    vehicle.year,
    vehicle.make,
    vehicle.model,
    vehicle.color,
    vehicle.status,
    vehicle.current_location,
    vehicle.assigned_role,
    vehicle.notes,
    vehicle.service_notes,
    vehicle.bodywork_notes,
    vehicle.submitted_by?.name,
    vehicle.submitted_by?.email,
    vehicle.assigned_user?.name,
    vehicle.assigned_user?.email,
    vehicle.pipeline,
    ...(vehicle.actions ?? []).map((action) => action.label)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

function buildDueDateFromParts(dateValue, timeValue = "14:00") {
  if (!dateValue) {
    return null;
  }

  const normalizedTime = /^\d{2}:\d{2}$/.test(String(timeValue)) ? String(timeValue) : "14:00";
  const parsed = new Date(`${dateValue}T${normalizedTime}:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return fallback;
}

function normalizeInstructionList(instructions) {
  if (Array.isArray(instructions)) {
    return instructions.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof instructions === "string") {
    return instructions.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function deriveFlagsFromInstructions(instructions) {
  const serviceTriggers = [
    "Maintenance",
    "Safety Check",
    "PDI",
    "State and Emissions",
    "Check for Retail",
    "Wholesale - Check for recalls"
  ];

  return {
    needsService: instructions.some((item) => serviceTriggers.includes(item)),
    needsBodywork: instructions.includes("Body Estimate"),
    serviceNotes: instructions.filter((item) => serviceTriggers.includes(item)).join(", "),
    bodyworkNotes: instructions.includes("Body Estimate") ? "Body Estimate requested" : ""
  };
}

function buildIntegrationNotes(payload, instructions, integrationSource) {
  const mergedNotes = [];

  if (typeof payload.notes === "string" && payload.notes.trim()) {
    mergedNotes.push(payload.notes.trim());
  }

  if (typeof payload.comments === "string" && payload.comments.trim()) {
    mergedNotes.push(`Comments: ${payload.comments.trim()}`);
  }

  if (payload.location) {
    mergedNotes.push(`Location: ${payload.location}`);
  }

  if (payload.miles) {
    mergedNotes.push(`Miles: ${payload.miles}`);
  }

  if (payload.customer_name || payload.customerName) {
    mergedNotes.push(`Customer: ${payload.customer_name ?? payload.customerName}`);
  }

  if (payload.chassis) {
    mergedNotes.push(`Chassis: ${payload.chassis}`);
  }

  if (instructions.length > 0) {
    mergedNotes.push(`Instructions: ${instructions.join(", ")}`);
  }

  mergedNotes.push(`Source: ${integrationSource}`);
  return mergedNotes.join("\n");
}

function resolveSubmittedByUser(users, payload, fallbackUser = null) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const byId = payload.submitted_by_user_id ?? payload.salesperson_id;
  if (byId) {
    const matchedById = usersById.get(byId);
    if (matchedById) {
      return { user: matchedById, matched: true, matchType: "id" };
    }
  }

  const byEmail = String(payload.submitted_by_email ?? payload.salesperson_email ?? "").trim().toLowerCase();
  if (byEmail) {
    const matchedByEmail = users.find((user) => String(user.email).trim().toLowerCase() === byEmail);
    if (matchedByEmail) {
      return { user: matchedByEmail, matched: true, matchType: "email" };
    }
  }

  const byName = String(payload.submitted_by_name ?? payload.salesperson_name ?? payload.advisor ?? "").trim().toLowerCase();
  if (byName) {
    const matchedByName = users.find((user) => String(user.name).trim().toLowerCase() === byName);
    if (matchedByName) {
      return { user: matchedByName, matched: true, matchType: "name" };
    }
  }

  if (fallbackUser) {
    return { user: fallbackUser, matched: false, matchType: "fallback" };
  }

  const stanleyUser = users.find((user) => String(user.name).trim().toLowerCase() === "stanley");
  if (stanleyUser) {
    return { user: stanleyUser, matched: false, matchType: "stanley" };
  }

  return { user: null, matched: false, matchType: "none" };
}

async function createVehicleRecord({
  actorUser,
  payload,
  allowAlternateSubmitter = false,
  actionType = "vehicle_created",
  statusLabel = "Get Ready Submitted",
  integrationSource = actorUser ? "get-ready-app" : "bopchipboard",
  enrichNotes = false
}) {
  const {
    assigned_user_id = null,
    service_notes = "",
    bodywork_notes = "",
    qc_required = false
  } = payload;

  const stockNumber = payload.stock_number ?? payload.stockNumber;
  const dueDate = payload.due_date ?? buildDueDateFromParts(payload.getReadyDate, payload.promiseTime);
  const instructions = normalizeInstructionList(payload.instructions);
  const derivedFlags = deriveFlagsFromInstructions(instructions);
  const needsService = payload.needs_service == null ? derivedFlags.needsService : toBoolean(payload.needs_service);
  const needsBodywork = payload.needs_bodywork == null ? derivedFlags.needsBodywork : toBoolean(payload.needs_bodywork);
  const resolvedSource = payload.integration_source ?? payload.integrationSource ?? integrationSource;

  if (!stockNumber || !payload.year || !payload.make || !payload.model || !dueDate) {
    throw Object.assign(new Error("Missing required vehicle fields."), { statusCode: 400 });
  }

  const existing = (await listVehicles()).find((vehicle) => vehicle.stock_number.toLowerCase() === String(stockNumber).toLowerCase());
  if (existing) {
    throw Object.assign(new Error("That stock number already exists."), { statusCode: 409 });
  }

  const users = await listUsers();
  const usersById = new Map(users.map((user) => [user.id, user]));
  const submittedByResolution = resolveSubmittedByUser(users, payload, actorUser);
  const submittedByUser = submittedByResolution.user;

  if (!submittedByUser) {
    throw Object.assign(new Error("The selected salesperson could not be found."), { statusCode: 400 });
  }

  if (!allowAlternateSubmitter && actorUser && submittedByResolution.matched && submittedByUser.id !== actorUser.id) {
    throw Object.assign(new Error("Only a Manager can submit a get ready for another user."), { statusCode: 403 });
  }

  const initialAssignedUserId = allowAlternateSubmitter && assigned_user_id ? assigned_user_id : null;
  if (initialAssignedUserId && !usersById.has(initialAssignedUserId)) {
    throw Object.assign(new Error("The selected assigned user could not be found."), { statusCode: 400 });
  }

  const mismatchNote = !submittedByResolution.matched
    ? [
        "Original salesperson could not be matched in Get Ready.",
        payload.submitted_by_name || payload.salesperson_name || payload.advisor
          ? `Original salesperson name: ${payload.submitted_by_name ?? payload.salesperson_name ?? payload.advisor}`
          : "",
        payload.submitted_by_email || payload.salesperson_email
          ? `Original salesperson email: ${payload.submitted_by_email ?? payload.salesperson_email}`
          : "",
        `Assigned to fallback user: ${submittedByUser.name}`
      ].filter(Boolean).join("\n")
    : "";

  const combinedNotes = [buildIntegrationNotes(payload, instructions, resolvedSource), mismatchNote]
    .filter(Boolean)
    .join("\n\n");

  const vehicle = {
    id: uuid(),
    stock_number: stockNumber,
    year: Number(payload.year),
    make: payload.make,
    model: payload.model,
    color: payload.color ?? "",
    status: STATUS.SUBMITTED,
    due_date: dueDate,
    current_location: "Submitted",
    assigned_user_id: initialAssignedUserId,
    submitted_by_user_id: submittedByUser.id,
    needs_service: needsService,
    needs_bodywork: needsBodywork,
    recall_checked: false,
    recall_open: false,
    recall_completed: false,
    fueled: false,
    qc_required: toBoolean(qc_required),
    qc_completed: false,
    service_status: needsService ? "pending" : "not_needed",
    bodywork_status: needsBodywork ? "pending" : "not_needed",
    service_notes: needsService ? String(service_notes || derivedFlags.serviceNotes || "") : "",
    bodywork_notes: needsBodywork ? String(bodywork_notes || derivedFlags.bodyworkNotes || "") : "",
    notes: enrichNotes ? combinedNotes : String(payload.notes ?? ""),
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
      userId: actorUser?.id ?? submittedByUser.id,
      actionType,
      fieldChanged: "status",
      oldValue: "",
      newValue: statusLabel
    });
    await addAuditEntry(connection, {
      vehicleId: vehicle.id,
      userId: actorUser?.id ?? submittedByUser.id,
      actionType,
      fieldChanged: "integration_source",
      oldValue: "",
      newValue: resolvedSource
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    vehicle,
    warning: submittedByResolution.matched
      ? null
      : `Salesperson match not found. Assigned to fallback user ${submittedByUser.name}.`
  };
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
  const authHeader = req.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    req.currentUser = null;
    next();
    return;
  }

  try {
    const payload = verifyAuthToken(authHeader.slice(7).trim());
    const user = await getUser(payload.sub);
    req.currentUser = user?.is_active ? sanitizeUser(user) : null;
  } catch {
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
  const email = normalizeEmail(req.body?.email);

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  const user = await getUserByEmail(email);
  if (!user || !user.is_active) {
    return res.status(401).json({ message: "Invalid email." });
  }

  res.json({
    token: signAuthToken(user),
    user: sanitizeUser(user)
  });
});

app.post("/api/auth/logout", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.currentUser });
});

app.post("/api/integrations/bopchipboard/get-ready", requireBopchipboardKey, async (req, res) => {
  const result = await createVehicleRecord({
    actorUser: null,
    payload: req.body,
    allowAlternateSubmitter: true,
    actionType: "vehicle_created_integration",
    statusLabel: "Get Ready Submitted via bopchipboard",
    integrationSource: "bopchipboard",
    enrichNotes: true
  });

  res.status(201).json(result);
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
  const { search, view = "mine", include_archived = "false" } = req.query;
  const requestedRole = typeof req.query.role === "string" && req.query.role !== "all" ? req.query.role : req.currentUser.role;
  const role = requestedRole === "admin" ? "manager" : requestedRole;
  const includeArchived = include_archived === "true" && isAdmin(req.currentUser);
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
  const auditEntries = await listAuditEntries({ limit: 1000 });
  const timelineByVehicleId = new Map();
  auditEntries.forEach((entry) => {
    if (!entry.vehicle_id) {
      return;
    }

    if (!timelineByVehicleId.has(entry.vehicle_id)) {
      timelineByVehicleId.set(entry.vehicle_id, []);
    }

    timelineByVehicleId.get(entry.vehicle_id).push(decorateAuditEntry(entry, usersById, new Map()));
  });

  const decorated = filteredRows.map((vehicle) =>
    decorateVehicle(vehicle, usersById, timelineByVehicleId.get(vehicle.id) ?? [], actionDefinitions, req.currentUser.id)
  );

  let filtered = decorated.filter((vehicle) => includeArchived || !vehicle.is_archived).filter((vehicle) => {
    if (isAdmin(req.currentUser)) {
      return vehicle.status !== STATUS.READY || includeArchived;
    }

    if (role === "salesperson") {
      return includeAllSalespersonVehicles || vehicle.submitted_by_user_id === req.currentUser.id;
    }

    return (
      getQueueForRole(vehicle, role, actionDefinitions, req.currentUser.id) ||
      (role === "manager" && vehicle.assigned_role === role) ||
      (vehicle.assigned_role === role && (role !== "detailer" || vehicle.status !== STATUS.DETAIL_STARTED || vehicle.assigned_user_id === req.currentUser.id))
    );
  });

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

app.get("/api/search/vehicles", async (req, res) => {
  const normalizedSearch = String(req.query.q ?? "").trim().toLowerCase();

  if (!normalizedSearch) {
    return res.json({ vehicles: [] });
  }

  const [users, actionDefinitionsRaw, vehiclesRaw] = await Promise.all([
    listUsers(),
    listActionDefinitions(),
    listVehicles()
  ]);
  const usersById = new Map(users.map((user) => [user.id, sanitizeUser(user)]));
  const actionDefinitions = actionDefinitionsRaw.map(normalizeActionDefinition);
  const vehicles = vehiclesRaw.map(normalizeVehicle).map((vehicle) =>
    decorateVehicle(vehicle, usersById, [], actionDefinitions, req.currentUser.id)
  );

  const matches = vehicles
    .filter((vehicle) => getVehicleSearchText(vehicle).includes(normalizedSearch))
    .sort((left, right) => new Date(left.due_date).getTime() - new Date(right.due_date).getTime())
    .slice(0, 12);

  res.json({ vehicles: matches });
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

app.patch("/api/vehicles/:id/archive", requireManager, async (req, res) => {
  const vehicleRow = await getVehicle(req.params.id);

  if (!vehicleRow) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  const vehicle = normalizeVehicle(vehicleRow);
  if (vehicle.is_archived) {
    return res.status(400).json({ message: "This vehicle has already been archived." });
  }

  const nextVehicle = await updateVehicleWithAudit(
    vehicle.id,
    {
      is_archived: true,
      archived_at: new Date().toISOString()
    },
    req.currentUser.id,
    "vehicle_archived"
  );

  res.json({ vehicle: nextVehicle });
});

app.patch("/api/vehicles/:id/unarchive", requireAdmin, async (req, res) => {
  const vehicleRow = await getVehicle(req.params.id);

  if (!vehicleRow) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  const vehicle = normalizeVehicle(vehicleRow);
  if (!vehicle.is_archived) {
    return res.status(400).json({ message: "This vehicle is not archived." });
  }

  const nextVehicle = await updateVehicleWithAudit(
    vehicle.id,
    {
      is_archived: false,
      archived_at: null
    },
    req.currentUser.id,
    "vehicle_unarchived"
  );

  res.json({ vehicle: nextVehicle });
});

app.post("/api/vehicles", async (req, res) => {
  const result = await createVehicleRecord({
    actorUser: req.currentUser,
    payload: req.body,
    allowAlternateSubmitter: hasManagerAccess(req.currentUser)
  });

  res.status(201).json({ vehicle: result.vehicle });
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

app.patch("/api/vehicles/:id/due-date", async (req, res) => {
  const { due_date } = req.body;
  const vehicleRow = await getVehicle(req.params.id);

  if (!vehicleRow) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  if (!["admin", "manager", "salesperson"].includes(req.currentUser.role)) {
    return res.status(403).json({ message: "Only Salespeople, Managers, and Admins can change the due date." });
  }

  const nextDueDate = new Date(due_date);
  if (!due_date || Number.isNaN(nextDueDate.getTime())) {
    return res.status(400).json({ message: "A valid due date and time is required." });
  }

  const vehicle = normalizeVehicle(vehicleRow);
  const nextVehicle = await updateVehicleWithAudit(
    vehicle.id,
    {
      due_date: nextDueDate.toISOString()
    },
    req.currentUser.id,
    "due_date_update"
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
    .filter((vehicle) => !vehicle.is_archived)
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
    .filter((vehicle) => !vehicle.is_archived)
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
  console.log(`Get Ready API listening on ${port} with ${authTokenTtlDays}-day auth tokens`);
});
