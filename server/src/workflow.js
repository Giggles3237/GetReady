export const STATUS = {
  SUBMITTED: "submitted",
  TO_DETAIL: "to_detail",
  DETAIL_STARTED: "detail_started",
  DETAIL_FINISHED: "detail_finished",
  REMOVED_FROM_DETAIL: "removed_from_detail",
  SERVICE: "service",
  QC: "qc",
  READY: "ready"
};

export const STATUS_META = {
  [STATUS.SUBMITTED]: { label: "Get Ready Submitted", pipeline: "Submitted", nextRole: "bmw_genius" },
  [STATUS.TO_DETAIL]: { label: "To Detail", pipeline: "At Detail", nextRole: "detailer" },
  [STATUS.DETAIL_STARTED]: { label: "Detail Started", pipeline: "In Detail", nextRole: "detailer" },
  [STATUS.DETAIL_FINISHED]: { label: "Detail Finished", pipeline: "Detail Complete", nextRole: "bmw_genius" },
  [STATUS.REMOVED_FROM_DETAIL]: { label: "Vehicle Removed from Detail", pipeline: "Warehouse QC", nextRole: "service_advisor" },
  [STATUS.SERVICE]: { label: "Service / Body Work", pipeline: "Service", nextRole: "service_advisor" },
  [STATUS.QC]: { label: "Final QC", pipeline: "Warehouse QC", nextRole: "manager" },
  [STATUS.READY]: { label: "Ready / Complete", pipeline: "Ready", nextRole: null }
};

export const ROLE_LABELS = {
  admin: "Admin",
  salesperson: "Salesperson",
  manager: "Manager",
  bmw_genius: "BMW Genius",
  detailer: "Detailer",
  service_advisor: "Service Advisor"
};

export const DEFAULT_ACTION_DEFINITIONS = [
  { key: STATUS.TO_DETAIL, label: "Take Car To Detail", role: "bmw_genius", type: "status", enabled: true },
  { key: STATUS.DETAIL_STARTED, label: "Start Detail", role: "detailer", type: "status", enabled: true },
  { key: STATUS.DETAIL_FINISHED, label: "Finish Detail", role: "detailer", type: "status", enabled: true },
  { key: STATUS.REMOVED_FROM_DETAIL, label: "Remove From Detail", role: "bmw_genius", type: "status", enabled: true },
  { key: "complete_qc", label: "Complete QC", role: "manager", type: "flag", enabled: true },
  { key: "start_service", label: "Service Started", role: "service_advisor", type: "flag", enabled: true },
  { key: "complete_service", label: "Complete Service", role: "service_advisor", type: "flag", enabled: true },
  { key: "start_bodywork", label: "Body Work Started", role: "service_advisor", type: "flag", enabled: true },
  { key: "complete_bodywork", label: "Complete Body Work", role: "service_advisor", type: "flag", enabled: true },
  { key: "toggle_recall", label: "Recalls Checked", role: "service_advisor", type: "flag", enabled: true },
  { key: "complete_recall", label: "Recall Completed", role: "service_advisor", type: "flag", enabled: true },
  { key: "toggle_fueled", label: "Fuel The Car", role: "bmw_genius", type: "flag", enabled: true },
  { key: STATUS.READY, label: "Mark Ready", role: "manager", type: "status", enabled: true }
];

function canRoleHandleAction(actionKey, role) {
  if (!role) {
    return false;
  }

  if ([STATUS.TO_DETAIL, STATUS.REMOVED_FROM_DETAIL, "toggle_fueled"].includes(actionKey)) {
    return ["admin", "salesperson", "manager", "bmw_genius"].includes(role);
  }

  if ([STATUS.DETAIL_STARTED, STATUS.DETAIL_FINISHED].includes(actionKey)) {
    return ["admin", "manager", "detailer", "bmw_genius"].includes(role);
  }

  if (["start_service", "complete_service", "start_bodywork", "complete_bodywork", "toggle_recall", "complete_recall"].includes(actionKey)) {
    return ["admin", "service_advisor", "manager"].includes(role);
  }

  if (actionKey === "complete_qc") {
    return ["admin", "manager"].includes(role);
  }

  if (actionKey === STATUS.READY) {
    return ["admin", "salesperson", "manager"].includes(role);
  }

  return false;
}

export function formatStatus(status) {
  return STATUS_META[status]?.label ?? status;
}

export function getPipelineColumn(vehicle) {
  if (vehicle.status === STATUS.READY) {
    return "Ready";
  }

  if (vehicle.qc_required && !vehicle.qc_completed && vehicle.status !== STATUS.SUBMITTED && vehicle.status !== STATUS.TO_DETAIL && vehicle.status !== STATUS.DETAIL_STARTED && vehicle.status !== STATUS.DETAIL_FINISHED) {
    const serviceDone = !vehicle.needs_service || vehicle.service_status === "completed";
    const bodyDone = !vehicle.needs_bodywork || vehicle.bodywork_status === "completed";
    if (serviceDone && bodyDone) {
      return "Warehouse QC";
    }
  }

  if ((vehicle.needs_service && vehicle.service_status !== "completed") || (vehicle.needs_bodywork && vehicle.bodywork_status !== "completed")) {
    if ([STATUS.REMOVED_FROM_DETAIL, STATUS.SERVICE, STATUS.QC].includes(vehicle.status)) {
      return "Service";
    }
  }

  return STATUS_META[vehicle.status]?.pipeline ?? "Submitted";
}

export function computeBlockingIssues(vehicle) {
  const blockers = [];

  if (vehicle.status === STATUS.READY) {
    return blockers;
  }

  if (![STATUS.DETAIL_FINISHED, STATUS.REMOVED_FROM_DETAIL, STATUS.SERVICE, STATUS.QC, STATUS.READY].includes(vehicle.status)) {
    blockers.push("Detail must be completed before the unit can be ready.");
  }

  if (![STATUS.REMOVED_FROM_DETAIL, STATUS.SERVICE, STATUS.QC, STATUS.READY].includes(vehicle.status)) {
    blockers.push("Vehicle must be removed from detail before completion.");
  }

  if (vehicle.needs_service && vehicle.service_status !== "completed") {
    blockers.push("Service work is required and still incomplete.");
  }

  if (vehicle.needs_bodywork && vehicle.bodywork_status !== "completed") {
    blockers.push("Body work is required and still incomplete.");
  }

  if (vehicle.qc_required && !vehicle.qc_completed) {
    blockers.push("Final QC is required before the unit can be marked ready.");
  }

  return blockers;
}

export function canTransition(vehicle, nextStatus) {
  if (!STATUS_META[nextStatus]) {
    return { allowed: false, message: "Unknown status." };
  }

  if (nextStatus === STATUS.READY) {
    const blockers = computeBlockingIssues(vehicle);
    if (blockers.length > 0) {
      return { allowed: false, message: blockers[0], blockers };
    }
  }

  if (nextStatus === STATUS.DETAIL_STARTED && vehicle.status !== STATUS.TO_DETAIL) {
    return { allowed: false, message: "Detail can only start after the vehicle is moved to detail." };
  }

  if (nextStatus === STATUS.DETAIL_FINISHED && vehicle.status !== STATUS.DETAIL_STARTED) {
    return { allowed: false, message: "Detail must be started before it can be finished." };
  }

  if (nextStatus === STATUS.REMOVED_FROM_DETAIL && vehicle.status !== STATUS.DETAIL_FINISHED) {
    return { allowed: false, message: "Vehicle can only be removed from detail after detail is finished." };
  }

  return { allowed: true };
}

export function deriveAssignedRole(vehicle) {
  if (vehicle.status === STATUS.READY) {
    return null;
  }

  if (vehicle.status === STATUS.SUBMITTED) {
    return "bmw_genius";
  }

  if ([STATUS.TO_DETAIL, STATUS.DETAIL_STARTED].includes(vehicle.status)) {
    return "detailer";
  }

  if (vehicle.status === STATUS.DETAIL_FINISHED) {
    return "bmw_genius";
  }

  if (vehicle.needs_service || vehicle.needs_bodywork) {
    if (vehicle.service_status !== "completed" || vehicle.bodywork_status !== "completed") {
      return "service_advisor";
    }
  }

  if (vehicle.qc_required && !vehicle.qc_completed) {
    return "manager";
  }

  return "bmw_genius";
}

export function syncWorkflowState(vehicle) {
  const detailDone = [STATUS.DETAIL_FINISHED, STATUS.REMOVED_FROM_DETAIL, STATUS.SERVICE, STATUS.QC, STATUS.READY].includes(vehicle.status);
  const removedFromDetail = [STATUS.REMOVED_FROM_DETAIL, STATUS.SERVICE, STATUS.QC, STATUS.READY].includes(vehicle.status);
  const serviceDone = !vehicle.needs_service || vehicle.service_status === "completed";
  const bodyDone = !vehicle.needs_bodywork || vehicle.bodywork_status === "completed";

  if (vehicle.status === STATUS.READY) {
    return vehicle;
  }

  if (vehicle.qc_completed && detailDone && removedFromDetail && serviceDone && bodyDone) {
    vehicle.status = STATUS.READY;
    return vehicle;
  }

  if (vehicle.qc_required && detailDone && removedFromDetail && serviceDone && bodyDone) {
    vehicle.status = STATUS.QC;
    return vehicle;
  }

  if (removedFromDetail && (!serviceDone || !bodyDone)) {
    vehicle.status = STATUS.SERVICE;
    return vehicle;
  }

  return vehicle;
}

function isActionAvailable(vehicle, action, currentUserId = null, currentUserRole = null) {
  if (!action.enabled) {
    return false;
  }

  if (currentUserRole && !canRoleHandleAction(action.key, currentUserRole)) {
    return false;
  }

  if (action.key === STATUS.TO_DETAIL) {
    return vehicle.status === STATUS.SUBMITTED;
  }

  if (action.key === STATUS.DETAIL_STARTED) {
    return vehicle.status === STATUS.TO_DETAIL;
  }

  if (action.key === STATUS.DETAIL_FINISHED) {
    const isDetailOwner = !currentUserId || vehicle.assigned_user_id === currentUserId;
    const canBypassDetailOwnership = ["admin", "manager", "bmw_genius"].includes(currentUserRole);
    return vehicle.status === STATUS.DETAIL_STARTED && (isDetailOwner || canBypassDetailOwnership);
  }

  if (action.key === STATUS.REMOVED_FROM_DETAIL) {
    return vehicle.status === STATUS.DETAIL_FINISHED;
  }

  if (action.key === "complete_qc") {
    const removedFromDetail = [STATUS.REMOVED_FROM_DETAIL, STATUS.SERVICE, STATUS.QC, STATUS.READY].includes(vehicle.status);
    const serviceDone = !vehicle.needs_service || vehicle.service_status === "completed";
    const bodyDone = !vehicle.needs_bodywork || vehicle.bodywork_status === "completed";
    return vehicle.qc_required && !vehicle.qc_completed && removedFromDetail && serviceDone && bodyDone;
  }

  if (action.key === "start_service") {
    return vehicle.needs_service && vehicle.service_status === "pending";
  }

  if (action.key === "complete_service") {
    return vehicle.needs_service && vehicle.service_status === "in_progress";
  }

  if (action.key === "start_bodywork") {
    return vehicle.needs_bodywork && vehicle.bodywork_status === "pending";
  }

  if (action.key === "complete_bodywork") {
    return vehicle.needs_bodywork && vehicle.bodywork_status === "in_progress";
  }

  if (action.key === "toggle_recall") {
    return !vehicle.recall_checked && !vehicle.recall_open && !vehicle.recall_completed;
  }

  if (action.key === "complete_recall") {
    return vehicle.recall_open && !vehicle.recall_completed;
  }

  if (action.key === "toggle_fueled") {
    return !vehicle.fueled && vehicle.status !== STATUS.DETAIL_STARTED;
  }

  if (action.key === STATUS.READY) {
    return canTransition(vehicle, STATUS.READY).allowed;
  }

  return false;
}

export function buildActionList(vehicle, actionDefinitions = DEFAULT_ACTION_DEFINITIONS, currentUserId = null, currentUserRole = null) {
  const actions = [];
  actionDefinitions.forEach((action) => {
    if (!isActionAvailable(vehicle, action, currentUserId, currentUserRole)) {
      return;
    }

    actions.push({
      ...action,
      role: currentUserRole ?? action.role
    });
  });

  return actions;
}

export function roleCanHandleAction(actionKey, role) {
  return canRoleHandleAction(actionKey, role);
}
