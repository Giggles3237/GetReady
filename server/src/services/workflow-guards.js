import { STATUS } from "../workflow.js";

const statusOrder = {
  [STATUS.SUBMITTED]: 1,
  [STATUS.TO_DETAIL]: 2,
  [STATUS.DETAIL_STARTED]: 3,
  [STATUS.DETAIL_FINISHED]: 4,
  [STATUS.REMOVED_FROM_DETAIL]: 5,
  [STATUS.SERVICE]: 6,
  [STATUS.QC]: 7,
  [STATUS.READY]: 8
};

export function isStatusUndo(currentStatus, nextStatus) {
  return (statusOrder[nextStatus] ?? 0) < (statusOrder[currentStatus] ?? 0);
}

export function getProtectedUndoField(vehicle, changes) {
  const checks = [
    { field: "recall_checked", blocked: vehicle.recall_checked === true && changes.recall_checked === false },
    { field: "recall_open", blocked: vehicle.recall_open === true && changes.recall_open === false },
    { field: "recall_completed", blocked: vehicle.recall_completed === true && changes.recall_completed === false },
    { field: "fueled", blocked: vehicle.fueled === true && changes.fueled === false },
    { field: "qc_completed", blocked: vehicle.qc_completed === true && changes.qc_completed === false },
    { field: "service_status", blocked: vehicle.service_status === "completed" && changes.service_status && changes.service_status !== "completed" },
    { field: "bodywork_status", blocked: vehicle.bodywork_status === "completed" && changes.bodywork_status && changes.bodywork_status !== "completed" }
  ];

  return checks.find((item) => item.blocked)?.field ?? null;
}
