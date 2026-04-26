import { v4 as uuid } from "uuid";
import { insertAuditLog } from "../db.js";

export async function addAuditEntry(connection, { vehicleId = null, userId, actionType, fieldChanged, oldValue, newValue }) {
  await insertAuditLog(connection, {
    id: uuid(),
    vehicle_id: vehicleId || null,
    user_id: userId,
    action_type: actionType,
    field_changed: fieldChanged,
    old_value: oldValue == null ? null : String(oldValue),
    new_value: newValue == null ? null : String(newValue)
  });
}
