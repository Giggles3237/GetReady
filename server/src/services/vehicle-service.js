import { v4 as uuid } from "uuid";
import { getPool, getVehicle, getVehicleByStockNumber, insertVehicle, listUsers, replaceVehicle } from "../db.js";
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

function mergeText(existingValue, nextValue) {
  const existing = String(existingValue ?? "").trim();
  const next = String(nextValue ?? "").trim();

  if (!next) {
    return existing;
  }

  if (!existing || existing === next || existing.includes(next)) {
    return existing || next;
  }

  return `${existing}\n\n${next}`;
}

function buildVehicleDraft({
  payload,
  stockNumber,
  dueDate,
  submittedByUser,
  initialAssignedUserId,
  needsService,
  needsBodywork,
  qcRequired,
  serviceNotes,
  bodyworkNotes,
  notes
}) {
  return {
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
    qc_required: toBoolean(qcRequired),
    qc_completed: false,
    service_status: needsService ? "pending" : "not_needed",
    bodywork_status: needsBodywork ? "pending" : "not_needed",
    service_notes: needsService ? String(serviceNotes || "") : "",
    bodywork_notes: needsBodywork ? String(bodyworkNotes || "") : "",
    notes,
    assigned_role: "bmw_genius",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function buildResubmissionChanges(existingVehicle, draftVehicle, { hasAssignedUserOverride }) {
  const shouldRestartWorkflow = existingVehicle.is_archived || existingVehicle.status === STATUS.READY;

  if (shouldRestartWorkflow) {
    return {
      year: draftVehicle.year,
      make: draftVehicle.make,
      model: draftVehicle.model,
      color: draftVehicle.color,
      due_date: draftVehicle.due_date,
      current_location: draftVehicle.current_location,
      assigned_role: draftVehicle.assigned_role,
      assigned_user_id: hasAssignedUserOverride ? draftVehicle.assigned_user_id : null,
      submitted_by_user_id: draftVehicle.submitted_by_user_id,
      needs_service: draftVehicle.needs_service,
      needs_bodywork: draftVehicle.needs_bodywork,
      recall_checked: false,
      recall_open: false,
      recall_completed: false,
      fueled: false,
      qc_required: draftVehicle.qc_required,
      qc_completed: false,
      service_status: draftVehicle.service_status,
      bodywork_status: draftVehicle.bodywork_status,
      service_notes: draftVehicle.service_notes,
      bodywork_notes: draftVehicle.bodywork_notes,
      notes: mergeText(existingVehicle.notes, draftVehicle.notes),
      status: STATUS.SUBMITTED,
      is_archived: false,
      archived_at: null
    };
  }

  const needsService = existingVehicle.needs_service || draftVehicle.needs_service;
  const needsBodywork = existingVehicle.needs_bodywork || draftVehicle.needs_bodywork;
  const qcRequired = existingVehicle.qc_required || draftVehicle.qc_required;

  return {
    year: draftVehicle.year,
    make: draftVehicle.make,
    model: draftVehicle.model,
    color: draftVehicle.color,
    due_date: draftVehicle.due_date,
    assigned_user_id: hasAssignedUserOverride ? draftVehicle.assigned_user_id : existingVehicle.assigned_user_id,
    submitted_by_user_id: draftVehicle.submitted_by_user_id,
    needs_service: needsService,
    needs_bodywork: needsBodywork,
    qc_required: qcRequired,
    service_status: needsService
      ? (existingVehicle.service_status === "not_needed" ? "pending" : existingVehicle.service_status)
      : "not_needed",
    bodywork_status: needsBodywork
      ? (existingVehicle.bodywork_status === "not_needed" ? "pending" : existingVehicle.bodywork_status)
      : "not_needed",
    service_notes: needsService ? mergeText(existingVehicle.service_notes, draftVehicle.service_notes) : "",
    bodywork_notes: needsBodywork ? mergeText(existingVehicle.bodywork_notes, draftVehicle.bodywork_notes) : "",
    notes: mergeText(existingVehicle.notes, draftVehicle.notes)
  };
}

async function resubmitExistingVehicle({
  stockNumber,
  vehicleDraft,
  hasAssignedUserOverride,
  actorUser,
  submittedByUser,
  submittedByResolution,
  resubmissionActionType,
  resubmissionStatusLabel,
  addAuditEntry
}) {
  const existingRow = await getVehicleByStockNumber(stockNumber);
  const existingVehicle = existingRow ? normalizeVehicle(existingRow) : null;

  if (!existingVehicle) {
    return null;
  }

  const nextVehicle = await updateVehicleWithAudit(
    existingVehicle.id,
    buildResubmissionChanges(existingVehicle, vehicleDraft, { hasAssignedUserOverride }),
    actorUser?.id ?? submittedByUser.id,
    resubmissionActionType,
    addAuditEntry,
    [{ fieldChanged: "resubmitted", oldValue: "", newValue: resubmissionStatusLabel }]
  );

  return {
    created: false,
    vehicle: nextVehicle,
    warning: submittedByResolution.matched
      ? null
      : `Salesperson match not found. Assigned to fallback user ${submittedByUser.name}.`
  };
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
  resubmissionActionType = "vehicle_resubmitted",
  statusLabel = "Get Ready Submitted",
  resubmissionStatusLabel = "Get Ready Resubmitted",
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
  const hasAssignedUserOverride = allowAlternateSubmitter && payload.assigned_user_id != null;

  if (!stockNumber || !payload.year || !payload.make || !payload.model || !dueDate) {
    throw Object.assign(new Error("Missing required vehicle fields."), { statusCode: 400 });
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

  const notes = enrichNotes ? combinedNotes : String(payload.notes ?? "");
  const vehicleDraft = buildVehicleDraft({
    payload,
    stockNumber,
    dueDate,
    submittedByUser,
    initialAssignedUserId,
    needsService,
    needsBodywork,
    qcRequired: qc_required,
    serviceNotes: service_notes || derivedFlags.serviceNotes || "",
    bodyworkNotes: bodywork_notes || derivedFlags.bodyworkNotes || "",
    notes
  });

  const existingVehicleResult = await resubmitExistingVehicle({
    stockNumber,
    vehicleDraft,
    hasAssignedUserOverride,
    actorUser,
    submittedByUser,
    submittedByResolution,
    resubmissionActionType,
    resubmissionStatusLabel,
    addAuditEntry
  });
  if (existingVehicleResult) {
    return existingVehicleResult;
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await insertVehicle(connection, vehicleDraft);
    await addAuditEntry(connection, {
      vehicleId: vehicleDraft.id,
      userId: actorUser?.id ?? submittedByUser.id,
      actionType,
      fieldChanged: "status",
      oldValue: "",
      newValue: statusLabel
    });
    await addAuditEntry(connection, {
      vehicleId: vehicleDraft.id,
      userId: actorUser?.id ?? submittedByUser.id,
      actionType,
      fieldChanged: "integration_source",
      oldValue: "",
      newValue: resolvedSource
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();

    if (error?.code === "ER_DUP_ENTRY") {
      const duplicateResult = await resubmitExistingVehicle({
        stockNumber,
        vehicleDraft,
        hasAssignedUserOverride,
        actorUser,
        submittedByUser,
        submittedByResolution,
        resubmissionActionType,
        resubmissionStatusLabel,
        addAuditEntry
      });
      if (duplicateResult) {
        return duplicateResult;
      }
    }

    throw error;
  } finally {
    connection.release();
  }

  return {
    created: true,
    vehicle: vehicleDraft,
    warning: submittedByResolution.matched
      ? null
      : `Salesperson match not found. Assigned to fallback user ${submittedByUser.name}.`
  };
}

export async function updateVehicleWithAudit(vehicleId, changes, userId, actionType, addAuditEntry, extraAuditEntries = []) {
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

    for (const entry of extraAuditEntries) {
      await addAuditEntry(connection, {
        vehicleId: currentVehicle.id,
        userId,
        actionType,
        ...entry
      });
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
