import { STATUS, STATUS_META, canTransition } from "../workflow.js";

export const MAX_BULK_STATUS_VEHICLES = 50;

export function normalizeBulkStatusRequest(payload = {}) {
  const status = String(payload.status ?? "").trim();
  if (!STATUS_META[status]) {
    throw Object.assign(new Error("Choose a valid target status."), { statusCode: 400 });
  }

  if (status === STATUS.DETAIL_STARTED) {
    throw Object.assign(
      new Error("Detail Started must be claimed by the detailer handling each vehicle."),
      { statusCode: 400 }
    );
  }

  if (!Array.isArray(payload.vehicle_ids)) {
    throw Object.assign(new Error("Choose at least one vehicle."), { statusCode: 400 });
  }

  const vehicleIds = [...new Set(
    payload.vehicle_ids
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];

  if (vehicleIds.length === 0) {
    throw Object.assign(new Error("Choose at least one vehicle."), { statusCode: 400 });
  }

  if (vehicleIds.length > MAX_BULK_STATUS_VEHICLES) {
    throw Object.assign(
      new Error(`Bulk status changes are limited to ${MAX_BULK_STATUS_VEHICLES} vehicles at a time.`),
      { statusCode: 400 }
    );
  }

  return { vehicleIds, status };
}

export function getBulkStatusDecision(vehicle, status) {
  if (vehicle.is_archived) {
    return { allowed: false, message: "Archived vehicles cannot be changed." };
  }

  if (vehicle.status === status) {
    return { allowed: false, message: "Vehicle is already at that status." };
  }

  return canTransition(vehicle, status);
}
