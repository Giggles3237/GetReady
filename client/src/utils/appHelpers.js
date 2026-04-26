const statusProgressOrder = {
  submitted: 1,
  to_detail: 2,
  detail_started: 3,
  detail_finished: 4,
  removed_from_detail: 5,
  service: 6,
  qc: 7,
  ready: 8
};

export function fmtDate(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

export function fmtDayLabel(value) {
  return new Date(value).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function shouldShowOnDashboard(vehicle, now = new Date()) {
  if (!vehicle || vehicle.is_archived) {
    return false;
  }

  if (vehicle.status !== "ready") {
    return true;
  }

  const dueDate = new Date(vehicle.due_date);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  return startOfDay(now).getTime() <= startOfDay(dueDate).getTime();
}

export function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function isSameDay(left, right) {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function getTimeLeftLabel(value) {
  const diffMs = new Date(value).getTime() - Date.now();
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const totalMinutes = Math.round(absMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return overdue ? `Overdue by ${parts.join(" ")}` : `${parts.join(" ")} left`;
}

function getFrozenTimeLeftLabel(dueDate, completedAt) {
  const diffMs = new Date(dueDate).getTime() - new Date(completedAt).getTime();
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const totalMinutes = Math.round(absMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return overdue ? `Done ${parts.join(" ")} late` : `${parts.join(" ")} early`;
}

function getTimeLeftTone(value) {
  const diffMs = new Date(value).getTime() - Date.now();
  if (diffMs < 0) return "danger";
  if (diffMs <= 1000 * 60 * 60 * 2) return "danger";
  if (diffMs <= 1000 * 60 * 60 * 8) return "warn";
  return "normal";
}

export function getVehicleTimeLabel(vehicle) {
  if (vehicle.status === "ready" && vehicle.completion_entry?.created_at) {
    return getFrozenTimeLeftLabel(vehicle.due_date, vehicle.completion_entry.created_at);
  }

  return getTimeLeftLabel(vehicle.due_date);
}

export function getVehicleTimeTone(vehicle) {
  if (vehicle.status === "ready" && vehicle.completion_entry?.created_at) {
    return new Date(vehicle.due_date).getTime() - new Date(vehicle.completion_entry.created_at).getTime() < 0 ? "danger" : "normal";
  }

  return getTimeLeftTone(vehicle.due_date);
}

export function getCalendarStatusTone(vehicle) {
  if (vehicle.status === "ready") return "done";
  if (isOverdue(vehicle.due_date)) return "danger";
  if (vehicle.pipeline === "Service") return "warn";
  return "normal";
}

export function isOverdue(value) {
  return new Date(value).getTime() < Date.now();
}

export function getDueSortValue(vehicle) {
  return new Date(vehicle.due_date).getTime();
}

export function getSearchResultState(vehicle) {
  if (vehicle.is_archived) {
    return "Archived";
  }

  if (vehicle.status === "ready") {
    return "Completed";
  }

  return "Active";
}

export function getNextActionForRole(vehicle, role) {
  return vehicle.actions.find((action) => action.role === role) ?? null;
}

export function getRoleActionPriority(role, actionKey) {
  if (role === "bmw_genius") {
    if (actionKey === "to_detail") return 1;
    if (actionKey === "detail_started") return 2;
    if (actionKey === "detail_finished") return 3;
    if (actionKey === "removed_from_detail") return 4;
    if (actionKey === "toggle_fueled") return 5;
  }

  return 99;
}

export function formatFieldLabel(value) {
  return value.replaceAll("_", " ");
}

export function performAction(vehicleId, actionKey, updateStatus, updateFlags) {
  if (actionKey === "toggle_fueled") return updateFlags(vehicleId, { fueled: true });
  if (actionKey === "toggle_recall") return updateFlags(vehicleId, { recall_checked: true });
  if (actionKey === "complete_recall") return updateFlags(vehicleId, { recall_completed: true });
  if (actionKey === "start_service") return updateFlags(vehicleId, { service_status: "in_progress" });
  if (actionKey === "complete_service") return updateFlags(vehicleId, { service_status: "completed" });
  if (actionKey === "start_bodywork") return updateFlags(vehicleId, { bodywork_status: "in_progress" });
  if (actionKey === "complete_bodywork") return updateFlags(vehicleId, { bodywork_status: "completed" });
  if (actionKey === "complete_qc") return updateFlags(vehicleId, { qc_completed: true });
  return updateStatus(vehicleId, actionKey);
}

export function getServiceDisplayLabel(vehicle) {
  if (!vehicle.needs_service) {
    return "";
  }

  if (vehicle.service_status === "completed") {
    return "Service Complete";
  }

  if (vehicle.service_status === "in_progress") {
    return "Service Started";
  }

  return "Needs Service";
}

export function getBodyworkDisplayLabel(vehicle) {
  if (!vehicle.needs_bodywork) {
    return "";
  }

  if (vehicle.bodywork_status === "completed") {
    return "Body Work Complete";
  }

  if (vehicle.bodywork_status === "in_progress") {
    return "Body Work Started";
  }

  return "Needs Body Work";
}

function getDetailDisplayLabel(vehicle) {
  if (["submitted", "to_detail"].includes(vehicle.status)) {
    return "Needs Detail";
  }

  if (vehicle.status === "detail_started") {
    return "Detail Started";
  }

  if (statusProgressOrder[vehicle.status] >= statusProgressOrder.detail_finished) {
    return "Detail Done";
  }

  return "Needs Detail";
}

function getFuelDisplayLabel(vehicle) {
  if (vehicle.fueled) {
    return "Fueled";
  }

  if (vehicle.status === "detail_started") {
    return "Fuel Pending";
  }

  return "Needs Fuel";
}

export function getWorkflowBadges(vehicle) {
  const badges = [];

  const detailLabel = getDetailDisplayLabel(vehicle);
  badges.push({
    label: detailLabel === "Detail Done" ? "Detail Complete" : detailLabel,
    tone: detailLabel === "Detail Done" ? "complete" : detailLabel === "Detail Started" ? "progress" : "pending"
  });

  const fuelLabel = getFuelDisplayLabel(vehicle);
  badges.push({
    label: fuelLabel,
    tone: fuelLabel === "Fueled" ? "complete" : fuelLabel === "Fuel Pending" ? "progress" : "pending"
  });

  if (vehicle.recall_completed) {
    badges.push({ label: "Recall Complete", tone: "complete" });
  } else if (vehicle.recall_open) {
    badges.push({ label: "Open Recall", tone: "danger" });
  } else if (vehicle.recall_checked) {
    badges.push({ label: "Recalls Checked", tone: "progress" });
  } else {
    badges.push({ label: "Needs Recall Check", tone: "pending" });
  }

  if (vehicle.needs_service) {
    const serviceLabel = getServiceDisplayLabel(vehicle).replace("Complete", "Done");
    badges.push({
      label: serviceLabel,
      tone: vehicle.service_status === "completed" ? "complete" : vehicle.service_status === "in_progress" ? "progress" : "pending"
    });
  }

  if (vehicle.needs_bodywork) {
    const bodyworkLabel = getBodyworkDisplayLabel(vehicle).replace("Complete", "Done");
    badges.push({
      label: bodyworkLabel,
      tone: vehicle.bodywork_status === "completed" ? "complete" : vehicle.bodywork_status === "in_progress" ? "progress" : "pending"
    });
  }

  return badges;
}

export function getCompletionIndicators(vehicle) {
  const indicators = [];

  if (statusProgressOrder[vehicle.status] >= statusProgressOrder.detail_finished) {
    indicators.push({ label: "Detailed", complete: true });
  }

  if (vehicle.fueled) {
    indicators.push({ label: "Fueled", complete: true });
  }

  if (vehicle.needs_bodywork && vehicle.bodywork_status === "completed") {
    indicators.push({ label: "Body Work Complete", complete: true });
  }

  if (vehicle.needs_service && vehicle.service_status === "completed") {
    indicators.push({ label: "Service Complete", complete: true });
  }

  return indicators;
}

export function getCompletionEntry(vehicle) {
  if (vehicle.completion_entry) {
    return vehicle.completion_entry;
  }

  if (vehicle.status !== "ready" || !vehicle.timeline) {
    return null;
  }

  return [...vehicle.timeline]
    .reverse()
    .find((entry) => entry.field_changed === "status" && String(entry.new_value).toLowerCase() === "ready") ?? null;
}

export function getCompletedStepEntries(vehicle) {
  if (!vehicle.timeline) {
    return [];
  }

  const definitions = [
    { key: "detail_finished", label: "Detail Completed", match: (entry) => entry.field_changed === "status" && entry.new_value === "detail_finished" },
    { key: "removed_from_detail", label: "Removed From Detail", match: (entry) => entry.field_changed === "status" && entry.new_value === "removed_from_detail" },
    { key: "fueled", label: "Fueled", match: (entry) => entry.field_changed === "fueled" && String(entry.new_value).toLowerCase() === "true" },
    { key: "recall_checked", label: "Recalls Checked", match: (entry) => entry.field_changed === "recall_checked" && String(entry.new_value).toLowerCase() === "true" },
    { key: "service_completed", label: "Service Completed", match: (entry) => entry.field_changed === "service_status" && entry.new_value === "completed" },
    { key: "bodywork_completed", label: "Body Work Completed", match: (entry) => entry.field_changed === "bodywork_status" && entry.new_value === "completed" },
    { key: "qc_completed", label: "QC Completed", match: (entry) => entry.field_changed === "qc_completed" && String(entry.new_value).toLowerCase() === "true" },
    { key: "ready", label: "Front Line Ready", match: (entry) => entry.field_changed === "status" && entry.new_value === "ready" }
  ];

  return definitions
    .map((definition) => {
      const entry = [...vehicle.timeline].reverse().find(definition.match);
      return entry ? { key: definition.key, label: definition.label, entry } : null;
    })
    .filter(Boolean);
}

export function groupVehiclesByAction(vehicles, role) {
  const grouped = new Map();

  vehicles.forEach((vehicle) => {
    const action = getNextActionForRole(vehicle, role);
    if (!action) {
      return;
    }

    const key = action.label;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(vehicle);
  });

  return Array.from(grouped.entries()).map(([label, items]) => ({ label, items }));
}
