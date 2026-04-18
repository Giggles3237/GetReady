import express from "express";
import cors from "cors";
import { v4 as uuid } from "uuid";
import { actionDefinitions, auditLogs, hydrateVehicle, users, vehicles } from "./data/seed.js";
import {
  ROLE_LABELS,
  STATUS,
  STATUS_META,
  buildActionList,
  canTransition,
  computeBlockingIssues,
  deriveAssignedRole,
  getPipelineColumn,
  formatStatus,
  syncWorkflowState
} from "./workflow.js";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

function getUser(userId) {
  return users.find((user) => user.id === userId);
}

function isManagerUser(userId) {
  return getUser(userId)?.role === "manager";
}

function getVehicle(vehicleId) {
  return vehicles.find((vehicle) => vehicle.id === vehicleId);
}

function addAuditEntry({ vehicleId, userId, actionType, fieldChanged, oldValue, newValue }) {
  auditLogs.unshift({
    id: uuid(),
    vehicle_id: vehicleId,
    user_id: userId,
    action_type: actionType,
    field_changed: fieldChanged,
    old_value: String(oldValue ?? ""),
    new_value: String(newValue ?? ""),
    created_at: new Date().toISOString()
  });
}

function inferLocation(vehicle) {
  if (vehicle.status === STATUS.SUBMITTED) return "Sales Lot";
  if (vehicle.status === STATUS.TO_DETAIL) return "Detail Queue";
  if (vehicle.status === STATUS.DETAIL_STARTED) return "Detail Bay";
  if (vehicle.status === STATUS.DETAIL_FINISHED) return "Detail Complete";
  if (vehicle.status === STATUS.REMOVED_FROM_DETAIL) return "Post Detail Staging";
  if (vehicle.status === STATUS.SERVICE) return "Service Drive";
  if (vehicle.status === STATUS.QC) return "QC Lane";
  if (vehicle.status === STATUS.READY) return "Front Line";
  return vehicle.current_location ?? "Unknown";
}

function updateVehicle(vehicle, changes, userId, actionType = "field_update") {
  Object.entries(changes).forEach(([field, newValue]) => {
    const oldValue = vehicle[field];
    if (oldValue !== newValue) {
      addAuditEntry({
        vehicleId: vehicle.id,
        userId,
        actionType,
        fieldChanged: field,
        oldValue,
        newValue
      });
      vehicle[field] = newValue;
    }
  });
  syncWorkflowState(vehicle);
  vehicle.current_location = inferLocation(vehicle);
  vehicle.assigned_role = deriveAssignedRole(vehicle);
  vehicle.updated_at = new Date().toISOString();
  vehicle.actions = buildActionList(vehicle, actionDefinitions);
}

function decorateVehicle(vehicle) {
  const hydrated = hydrateVehicle(vehicle, actionDefinitions);
  return {
    ...hydrated,
    pipeline: getPipelineColumn(hydrated),
    blockers: computeBlockingIssues(hydrated),
    assigned_user: users.find((user) => user.id === hydrated.assigned_user_id) ?? null,
    submitted_by: users.find((user) => user.id === hydrated.submitted_by_user_id) ?? null,
    timeline: auditLogs
      .filter((entry) => entry.vehicle_id === hydrated.id)
      .map((entry) => ({
        ...entry,
        user: users.find((user) => user.id === entry.user_id) ?? null
      }))
  };
}

function decorateVehicleForUser(vehicle, userId = null) {
  const hydrated = hydrateVehicle(vehicle, actionDefinitions, userId);
  return {
    ...hydrated,
    pipeline: getPipelineColumn(hydrated),
    blockers: computeBlockingIssues(hydrated),
    assigned_user: users.find((user) => user.id === hydrated.assigned_user_id) ?? null,
    submitted_by: users.find((user) => user.id === hydrated.submitted_by_user_id) ?? null,
    timeline: auditLogs
      .filter((entry) => entry.vehicle_id === hydrated.id)
      .map((entry) => ({
        ...entry,
        user: users.find((user) => user.id === entry.user_id) ?? null
      }))
  };
}

function getQueueForRole(vehicle, role, userId = null) {
  const actions = buildActionList(vehicle, actionDefinitions, userId);
  return actions.some((action) => action.role === role);
}

function decorateAuditEntry(entry) {
  return {
    ...entry,
    user: users.find((user) => user.id === entry.user_id) ?? null,
    vehicle: vehicles.find((vehicle) => vehicle.id === entry.vehicle_id) ?? null,
    scope: entry.vehicle_id ? "vehicle" : "system"
  };
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "get-ready-api" });
});

app.get("/api/users", (_req, res) => {
  res.json({ users });
});

app.post("/api/admin/users", (req, res) => {
  const { name, role, userId } = req.body;

  if (!userId || !getUser(userId) || !isManagerUser(userId)) {
    return res.status(403).json({ message: "Only a Manager can administer users." });
  }

  if (!name || !role || !ROLE_LABELS[role]) {
    return res.status(400).json({ message: "Name and valid role are required." });
  }

  const newUser = {
    id: uuid(),
    name: String(name).trim(),
    role
  };

  users.push(newUser);
  addAuditEntry({
    vehicleId: "",
    userId,
    actionType: "admin_user_create",
    fieldChanged: `user:${newUser.id}:created`,
    oldValue: "",
    newValue: `${newUser.name} (${newUser.role})`
  });

  res.status(201).json({ user: newUser, users });
});

app.patch("/api/admin/users/:id", (req, res) => {
  const { name, role, userId } = req.body;
  const targetUser = getUser(req.params.id);

  if (!userId || !getUser(userId) || !isManagerUser(userId)) {
    return res.status(403).json({ message: "Only a Manager can administer users." });
  }

  if (!targetUser) {
    return res.status(404).json({ message: "User not found." });
  }

  if (typeof name === "string" && name.trim() && targetUser.name !== name.trim()) {
    addAuditEntry({
      vehicleId: "",
      userId,
      actionType: "admin_user_update",
      fieldChanged: `user:${targetUser.id}:name`,
      oldValue: targetUser.name,
      newValue: name.trim()
    });
    targetUser.name = name.trim();
  }

  if (typeof role === "string" && ROLE_LABELS[role] && targetUser.role !== role) {
    addAuditEntry({
      vehicleId: "",
      userId,
      actionType: "admin_user_update",
      fieldChanged: `user:${targetUser.id}:role`,
      oldValue: targetUser.role,
      newValue: role
    });
    targetUser.role = role;
  }

  res.json({ user: targetUser, users });
});

app.get("/api/admin/actions", (_req, res) => {
  res.json({ actions: actionDefinitions });
});

app.patch("/api/admin/actions/:key", (req, res) => {
  const { userId, label, role, enabled } = req.body;
  const action = actionDefinitions.find((item) => item.key === req.params.key);

  if (!action) {
    return res.status(404).json({ message: "Action not found." });
  }

  if (!userId || !getUser(userId)) {
    return res.status(400).json({ message: "A valid user is required." });
  }

  const changes = {};
  if (typeof label === "string" && label.trim()) {
    changes.label = label.trim();
  }
  if (typeof role === "string" && ROLE_LABELS[role]) {
    changes.role = role;
  }
  if (typeof enabled === "boolean") {
    changes.enabled = enabled;
  }

  Object.entries(changes).forEach(([field, newValue]) => {
    const oldValue = action[field];
    if (oldValue !== newValue) {
      addAuditEntry({
        vehicleId: "",
        userId,
        actionType: "admin_action_update",
        fieldChanged: `action:${action.key}:${field}`,
        oldValue,
        newValue
      });
      action[field] = newValue;
    }
  });

  res.json({ action, actions: actionDefinitions });
});

app.get("/api/admin/audit", (req, res) => {
  const { userId, vehicleId, limit = 100 } = req.query;

  let entries = auditLogs.map(decorateAuditEntry);

  if (userId) {
    entries = entries.filter((entry) => entry.user_id === userId);
  }

  if (vehicleId) {
    entries = entries.filter((entry) => entry.vehicle_id === vehicleId);
  }

  res.json({ audit: entries.slice(0, Number(limit)) });
});

app.get("/api/vehicles", (req, res) => {
  const { role, userId, search } = req.query;
  const normalizedSearch = String(search ?? "").trim().toLowerCase();

  let filtered = vehicles.map((vehicle) => decorateVehicleForUser(vehicle, userId ? String(userId) : null));

  if (role && role !== "all") {
    filtered = filtered.filter((vehicle) => getQueueForRole(vehicle, role, userId ? String(userId) : null) || vehicle.assigned_role === role && (role !== "detailer" || vehicle.status !== STATUS.DETAIL_STARTED || vehicle.assigned_user_id === userId));
  }

  if (userId && userId !== "all") {
    filtered = filtered.filter((vehicle) => vehicle.assigned_user_id === userId);
  }

  if (normalizedSearch) {
    filtered = filtered.filter((vehicle) =>
      [
        vehicle.stock_number,
        vehicle.make,
        vehicle.model,
        vehicle.color,
        vehicle.status
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }

  res.json({ vehicles: filtered });
});

app.get("/api/vehicles/:id", (req, res) => {
  const vehicle = getVehicle(req.params.id);
  if (!vehicle) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  res.json({ vehicle: decorateVehicleForUser(vehicle, req.query.userId ? String(req.query.userId) : null) });
});

app.post("/api/vehicles", (req, res) => {
  const {
    stock_number,
    year,
    make,
    model,
    color,
    due_date,
    submitted_by_user_id,
    needs_service = false,
    needs_bodywork = false,
    service_notes = "",
    bodywork_notes = "",
    qc_required = false,
    notes = ""
  } = req.body;

  if (!stock_number || !year || !make || !model || !due_date || !submitted_by_user_id) {
    return res.status(400).json({ message: "Missing required vehicle fields." });
  }

  if (vehicles.some((vehicle) => vehicle.stock_number.toLowerCase() === String(stock_number).toLowerCase())) {
    return res.status(409).json({ message: "That stock number already exists." });
  }

  const vehicle = {
    id: uuid(),
    stock_number,
    year,
    make,
    model,
    color,
    status: STATUS.SUBMITTED,
    due_date,
    current_location: "Submitted",
    assigned_user_id: null,
    submitted_by_user_id,
    needs_service,
    needs_bodywork,
    recall_checked: false,
    recall_open: false,
    recall_completed: false,
    fueled: false,
    qc_required,
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

  vehicles.unshift(vehicle);
  addAuditEntry({
    vehicleId: vehicle.id,
    userId: submitted_by_user_id,
    actionType: "vehicle_created",
    fieldChanged: "status",
    oldValue: "",
    newValue: "Get Ready Submitted"
  });

  res.status(201).json({ vehicle: decorateVehicle(vehicle) });
});

app.patch("/api/vehicles/:id/status", (req, res) => {
  const { status, userId } = req.body;
  const vehicle = getVehicle(req.params.id);

  if (!vehicle) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  if (!userId || !getUser(userId)) {
    return res.status(400).json({ message: "A valid user is required." });
  }

  if (isStatusUndo(vehicle.status, status) && !isManagerUser(userId)) {
    return res.status(403).json({ message: "Only a Manager can undo a completed status step." });
  }

  const transition = canTransition(vehicle, status);
  if (!transition.allowed) {
    return res.status(400).json({ message: transition.message, blockers: transition.blockers ?? [] });
  }

  updateVehicle(
    vehicle,
    {
      status,
      assigned_user_id: status === STATUS.DETAIL_STARTED ? userId : vehicle.assigned_user_id,
      assigned_role: STATUS_META[status]?.nextRole ?? deriveAssignedRole(vehicle)
    },
    userId,
    "status_change"
  );

  res.json({ vehicle: decorateVehicle(vehicle) });
});

app.patch("/api/vehicles/:id/flags", (req, res) => {
  const { userId, ...changes } = req.body;
  const vehicle = getVehicle(req.params.id);

  if (!vehicle) {
    return res.status(404).json({ message: "Vehicle not found." });
  }

  if (!userId || !getUser(userId)) {
    return res.status(400).json({ message: "A valid user is required." });
  }

  const normalized = { ...changes };
  const protectedUndoField = getProtectedUndoField(vehicle, normalized);

  if (protectedUndoField && !isManagerUser(userId)) {
    return res.status(403).json({ message: `Only a Manager can undo ${protectedUndoField.replaceAll("_", " ")} once it is complete.` });
  }

  if (typeof normalized.needs_service === "boolean") {
    normalized.service_status = normalized.needs_service ? vehicle.service_status === "not_needed" ? "pending" : vehicle.service_status : "not_needed";
    if (!normalized.needs_service) {
      normalized.service_notes = "";
    }
  }

  if (typeof normalized.needs_bodywork === "boolean") {
    normalized.bodywork_status = normalized.needs_bodywork ? vehicle.bodywork_status === "not_needed" ? "pending" : vehicle.bodywork_status : "not_needed";
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

  updateVehicle(vehicle, normalized, userId, "flag_update");
  res.json({ vehicle: decorateVehicle(vehicle) });
});

app.get("/api/dashboard/summary", (req, res) => {
  const { role = "manager" } = req.query;
  const decorated = vehicles.map(decorateVehicle);
  const now = Date.now();

  const summary = {
    total: decorated.length,
    overdue: decorated.filter((vehicle) => new Date(vehicle.due_date).getTime() < now && vehicle.status !== STATUS.READY).length,
    ready: decorated.filter((vehicle) => vehicle.status === STATUS.READY).length,
    needsAction: decorated.filter((vehicle) => getQueueForRole(vehicle, role)).length,
    byPipeline: ["Submitted", "At Detail", "In Detail", "Service", "QC", "Ready"].map((column) => ({
      column,
      count: decorated.filter((vehicle) => vehicle.pipeline === column).length
    }))
  };

  res.json({ summary });
});

app.get("/api/dashboard/calendar", (_req, res) => {
  const calendar = vehicles
    .map(decorateVehicle)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
    .map((vehicle) => ({
      id: vehicle.id,
      title: `${vehicle.stock_number} - ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      due_date: vehicle.due_date,
      overdue: new Date(vehicle.due_date).getTime() < Date.now() && vehicle.status !== STATUS.READY,
      status: formatStatus(vehicle.status)
    }));

  res.json({ items: calendar });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    roles: ROLE_LABELS,
    statuses: Object.entries(STATUS_META).map(([key, meta]) => ({ key, ...meta }))
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Unexpected server error." });
});

app.listen(port, () => {
  console.log(`Get Ready API listening on ${port}`);
});
