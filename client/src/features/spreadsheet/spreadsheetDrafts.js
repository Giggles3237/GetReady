import { toDateTimeLocalValue } from "../../utils/appHelpers";

export function buildSpreadsheetDraft(vehicle) {
  return {
    stock_number: vehicle.stock_number ?? "",
    year: vehicle.year ?? "",
    make: vehicle.make ?? "",
    model: vehicle.model ?? "",
    color: vehicle.color ?? "",
    due_date: toDateTimeLocalValue(vehicle.due_date),
    status: vehicle.status ?? "submitted",
    submitted_by_user_id: vehicle.submitted_by_user_id ?? "",
    assigned_user_id: vehicle.assigned_user_id ?? "",
    needs_service: Boolean(vehicle.needs_service),
    needs_bodywork: Boolean(vehicle.needs_bodywork),
    recall_checked: Boolean(vehicle.recall_checked),
    recall_open: Boolean(vehicle.recall_open),
    recall_completed: Boolean(vehicle.recall_completed),
    fueled: Boolean(vehicle.fueled),
    qc_required: Boolean(vehicle.qc_required),
    qc_completed: Boolean(vehicle.qc_completed),
    service_status: vehicle.service_status ?? "not_needed",
    bodywork_status: vehicle.bodywork_status ?? "not_needed",
    notes: vehicle.notes ?? "",
    service_notes: vehicle.service_notes ?? "",
    bodywork_notes: vehicle.bodywork_notes ?? ""
  };
}

function valuesMatch(left, right) {
  return String(left ?? "") === String(right ?? "");
}

export function getSpreadsheetChanges(vehicle, draft) {
  const original = buildSpreadsheetDraft(vehicle);
  const changes = {};

  Object.entries(draft).forEach(([key, value]) => {
    if (valuesMatch(original[key], value)) {
      return;
    }

    if (key === "year") {
      changes[key] = Number(value);
    } else if (key === "due_date") {
      changes[key] = value ? new Date(value).toISOString() : "";
    } else if (key.endsWith("_user_id")) {
      changes[key] = value || null;
    } else {
      changes[key] = value;
    }
  });

  return changes;
}

export function reconcileSpreadsheetDrafts(nextVehicles, currentDrafts, editVersions) {
  return Object.fromEntries(nextVehicles.map((vehicle) => {
    const nextDraft = buildSpreadsheetDraft(vehicle);
    const currentDraft = currentDrafts[vehicle.id];
    const editedFields = editVersions[vehicle.id] ?? {};

    if (!currentDraft) {
      return [vehicle.id, nextDraft];
    }

    const reconciledDraft = { ...nextDraft };

    Object.keys(editedFields).forEach((key) => {
      reconciledDraft[key] = currentDraft[key];
    });

    return [vehicle.id, reconciledDraft];
  }));
}
