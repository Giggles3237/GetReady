export const MAX_BULK_ARCHIVE_VEHICLES = 50;

export function normalizeBulkArchiveRequest(payload = {}) {
  if (!Array.isArray(payload.vehicle_ids)) {
    throw Object.assign(new Error("Choose at least one vehicle to archive."), { statusCode: 400 });
  }

  const vehicleIds = [...new Set(
    payload.vehicle_ids
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  )];

  if (vehicleIds.length === 0) {
    throw Object.assign(new Error("Choose at least one vehicle to archive."), { statusCode: 400 });
  }

  if (vehicleIds.length > MAX_BULK_ARCHIVE_VEHICLES) {
    throw Object.assign(
      new Error(`Bulk archive is limited to ${MAX_BULK_ARCHIVE_VEHICLES} vehicles at a time.`),
      { statusCode: 400 }
    );
  }

  return { vehicleIds };
}

export function getBulkArchiveDecision(vehicle) {
  if (vehicle.is_archived) {
    return { allowed: false, message: "Vehicle has already been archived." };
  }

  return { allowed: true };
}
