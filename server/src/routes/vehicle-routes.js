import { getVehicle, listActionDefinitions, listAuditEntries, listUsers, listVehicles } from "../db.js";
import { STATUS, STATUS_META, canTransition, deriveAssignedRole, getPipelineColumn } from "../workflow.js";
import { shouldShowOnDashboard } from "../services/dashboard-visibility.js";
import {
  decorateAuditEntry,
  decorateVehicle,
  getQueueForRole,
  getVehicleSearchText,
  normalizeActionDefinition,
  normalizeVehicle,
  sanitizeUser
} from "../vehicle-helpers.js";

const managerCorrectionBooleanFields = new Set([
  "needs_service",
  "needs_bodywork",
  "recall_checked",
  "recall_open",
  "recall_completed",
  "fueled",
  "qc_required",
  "qc_completed"
]);

const managerCorrectionEnumFields = {
  status: new Set(Object.values(STATUS)),
  service_status: new Set(["not_needed", "pending", "in_progress", "completed"]),
  bodywork_status: new Set(["not_needed", "pending", "in_progress", "completed"])
};

function normalizeManagerCorrections(payload, vehicle) {
  const normalized = {};

  for (const [field, value] of Object.entries(payload ?? {})) {
    if (managerCorrectionBooleanFields.has(field) && typeof value === "boolean") {
      normalized[field] = value;
      continue;
    }

    if (managerCorrectionEnumFields[field]?.has(value)) {
      normalized[field] = value;
    }
  }

  if (Object.keys(normalized).length === 0) {
    throw Object.assign(new Error("No valid correction fields were provided."), { statusCode: 400 });
  }

  const needsService = normalized.needs_service ?? vehicle.needs_service;
  const needsBodywork = normalized.needs_bodywork ?? vehicle.needs_bodywork;
  const qcRequired = normalized.qc_required ?? vehicle.qc_required;

  if (!needsService) {
    normalized.needs_service = false;
    normalized.service_status = "not_needed";
    normalized.service_notes = "";
  } else if (!normalized.service_status && vehicle.service_status === "not_needed") {
    normalized.service_status = "pending";
  }

  if (!needsBodywork) {
    normalized.needs_bodywork = false;
    normalized.bodywork_status = "not_needed";
    normalized.bodywork_notes = "";
  } else if (!normalized.bodywork_status && vehicle.bodywork_status === "not_needed") {
    normalized.bodywork_status = "pending";
  }

  const nextRecall = {
    recall_checked: normalized.recall_checked ?? vehicle.recall_checked,
    recall_open: normalized.recall_open ?? vehicle.recall_open,
    recall_completed: normalized.recall_completed ?? vehicle.recall_completed
  };

  if (nextRecall.recall_completed) {
    nextRecall.recall_checked = true;
    nextRecall.recall_open = true;
  } else if (nextRecall.recall_open) {
    nextRecall.recall_checked = true;
  } else if (!nextRecall.recall_checked) {
    nextRecall.recall_open = false;
    nextRecall.recall_completed = false;
  }

  if (Object.keys(normalized).some((field) => field.startsWith("recall_"))) {
    Object.assign(normalized, nextRecall);
  }

  if (!qcRequired) {
    normalized.qc_required = false;
    normalized.qc_completed = false;
  }

  return normalized;
}

export function registerVehicleRoutes(app, {
  isAdmin,
  hasManagerAccess,
  requireAdmin,
  requireManager,
  createVehicleRecord,
  updateVehicleWithAudit,
  isStatusUndo,
  getProtectedUndoField
}) {
  app.get("/api/users", async (_req, res) => {
    const users = (await listUsers()).map(sanitizeUser);
    res.json({ users });
  });

  app.get("/api/vehicles", async (req, res) => {
    const { search, view = "mine", include_archived = "false", include_completed = "false" } = req.query;
    const requestedRole = typeof req.query.role === "string" && req.query.role !== "all" ? req.query.role : req.currentUser.role;
    const role = requestedRole === "admin" ? "manager" : requestedRole;
    const includeArchived = include_archived === "true" && isAdmin(req.currentUser);
    const includeCompleted = include_completed === "true";
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
        return includeCompleted || shouldShowOnDashboard(vehicle) || includeArchived;
      }

      if (includeCompleted && vehicle.status === STATUS.READY) {
        if (role === "manager") {
          return true;
        }

        if (role === "salesperson") {
          return includeAllSalespersonVehicles || vehicle.submitted_by_user_id === req.currentUser.id;
        }
      }

      return (
        getQueueForRole(vehicle, role, actionDefinitions, req.currentUser.id) ||
        (role === "manager" && vehicle.assigned_role === role) ||
        (role === "salesperson" && (includeAllSalespersonVehicles || vehicle.submitted_by_user_id === req.currentUser.id)) ||
        (vehicle.assigned_role === role && (role !== "detailer" || vehicle.status !== STATUS.DETAIL_STARTED || vehicle.assigned_user_id === req.currentUser.id))
      );
    });

    filtered = filtered.filter((vehicle) => includeArchived || includeCompleted || shouldShowOnDashboard(vehicle));

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

  app.patch("/api/vehicles/:id/corrections", requireManager, async (req, res) => {
    const vehicleRow = await getVehicle(req.params.id);

    if (!vehicleRow) {
      return res.status(404).json({ message: "Vehicle not found." });
    }

    const vehicle = normalizeVehicle(vehicleRow);

    try {
      const normalized = normalizeManagerCorrections(req.body, vehicle);
      const nextVehicle = await updateVehicleWithAudit(vehicle.id, normalized, req.currentUser.id, "manager_correction");
      res.json({ vehicle: nextVehicle });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ message: error.message || "Unable to save corrections." });
    }
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
}
