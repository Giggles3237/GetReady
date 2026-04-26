import { v4 as uuid } from "uuid";
import { getPool, getVehicle, insertVehicle, listUsers, listVehicles, replaceVehicle } from "../db.js";
import { STATUS, deriveAssignedRole, syncWorkflowState } from "../workflow.js";
import { inferLocation, normalizeVehicle } from "../vehicle-helpers.js";

export function generateTemporaryPassword() {
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

export async function createVehicleRecord({
  actorUser,
  payload,
  allowAlternateSubmitter = false,
  actionType = "vehicle_created",
  statusLabel = "Get Ready Submitted",
  integrationSource = actorUser ? "get-ready-app" : "bopchipboard",
  enrichNotes = false,
  addAuditEntry
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

export async function updateVehicleWithAudit(vehicleId, changes, userId, actionType, addAuditEntry) {
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
