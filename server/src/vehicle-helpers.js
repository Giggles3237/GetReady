import {
  buildActionList,
  computeBlockingIssues,
  deriveAssignedRole,
  getPipelineColumn,
  roleCanHandleAction,
  STATUS
} from "./workflow.js";

export function sanitizeUser(user) {
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

export function inferLocation(vehicle) {
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

export function normalizeVehicle(row) {
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

export function normalizeActionDefinition(row) {
  return {
    key: row.action_key,
    label: row.label,
    role: row.role,
    type: row.action_type,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order)
  };
}

export function decorateAuditEntry(entry, usersById, vehiclesById) {
  return {
    ...entry,
    user: usersById.get(entry.user_id) ?? null,
    vehicle: entry.vehicle_id ? vehiclesById.get(entry.vehicle_id) ?? null : null,
    scope: entry.vehicle_id ? "vehicle" : "system"
  };
}

export function decorateVehicle(vehicle, usersById, timelineEntries, actionDefinitions, currentUserId = null) {
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

export function getQueueForRole(vehicle, role, actionDefinitions, userId = null) {
  return buildActionList(vehicle, actionDefinitions, userId, role).some((action) => roleCanHandleAction(action.key, role));
}

export function getVehicleSearchText(vehicle) {
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
