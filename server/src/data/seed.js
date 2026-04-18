import { v4 as uuid } from "uuid";
import { DEFAULT_ACTION_DEFINITIONS, STATUS, buildActionList, deriveAssignedRole } from "../workflow.js";

const now = Date.now();

export const users = [
  { id: "u-sales-1", name: "Chris Lasko", role: "salesperson" },
  { id: "u-mgr-1", name: "Morgan Tate", role: "manager" },
  { id: "u-genius-1", name: "Avery Stone", role: "bmw_genius" },
  { id: "u-detail-1", name: "Leo Rivers", role: "detailer" },
  { id: "u-service-1", name: "Jordan Price", role: "service_advisor" }
];

export const vehicles = [
  {
    id: "v-1001",
    stock_number: "GR10245",
    year: 2023,
    make: "BMW",
    model: "X5 xDrive40i",
    color: "Black Sapphire",
    status: STATUS.SUBMITTED,
    due_date: new Date(now + 1000 * 60 * 60 * 24).toISOString(),
    current_location: "Sales Lot",
    assigned_user_id: "u-genius-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: false,
    needs_bodywork: false,
    recall_checked: false,
    recall_open: false,
    recall_completed: false,
    fueled: false,
    qc_required: false,
    qc_completed: false,
    service_status: "not_needed",
    bodywork_status: "not_needed",
    service_notes: "",
    bodywork_notes: "",
    notes: "Trade-in arriving from used inventory."
  },
  {
    id: "v-1002",
    stock_number: "GR10246",
    year: 2022,
    make: "BMW",
    model: "330i",
    color: "Alpine White",
    status: STATUS.TO_DETAIL,
    due_date: new Date(now + 1000 * 60 * 60 * 8).toISOString(),
    current_location: "Detail Queue",
    assigned_user_id: "u-detail-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: true,
    needs_bodywork: false,
    recall_checked: true,
    recall_open: false,
    recall_completed: false,
    fueled: false,
    qc_required: true,
    qc_completed: false,
    service_status: "pending",
    bodywork_status: "not_needed",
    service_notes: "Needs tire sensor diagnosis before front line.",
    bodywork_notes: "",
    notes: "Needs tire sensor check before front line."
  },
  {
    id: "v-1003",
    stock_number: "GR10247",
    year: 2021,
    make: "BMW",
    model: "X3 M40i",
    color: "Phytonic Blue",
    status: STATUS.DETAIL_STARTED,
    due_date: new Date(now + 1000 * 60 * 60 * 36).toISOString(),
    current_location: "Detail Bay 2",
    assigned_user_id: "u-detail-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: false,
    needs_bodywork: true,
    recall_checked: false,
    recall_open: false,
    recall_completed: false,
    fueled: true,
    qc_required: false,
    qc_completed: false,
    service_status: "not_needed",
    bodywork_status: "pending",
    service_notes: "",
    bodywork_notes: "Minor rear bumper repair approved.",
    notes: "Minor rear bumper repair approved."
  },
  {
    id: "v-1004",
    stock_number: "GR10248",
    year: 2024,
    make: "BMW",
    model: "i4 eDrive40",
    color: "Brooklyn Grey",
    status: STATUS.REMOVED_FROM_DETAIL,
    due_date: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
    current_location: "Service Drive",
    assigned_user_id: "u-service-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: true,
    needs_bodywork: false,
    recall_checked: true,
    recall_open: true,
    recall_completed: false,
    fueled: true,
    qc_required: true,
    qc_completed: false,
    service_status: "in_progress",
    bodywork_status: "not_needed",
    service_notes: "Software update and inspection still open.",
    bodywork_notes: "",
    notes: "Software update and inspection still open."
  },
  {
    id: "v-1005",
    stock_number: "GR10249",
    year: 2020,
    make: "BMW",
    model: "540i xDrive",
    color: "Carbon Black",
    status: STATUS.QC,
    due_date: new Date(now + 1000 * 60 * 60 * 4).toISOString(),
    current_location: "Delivery Prep",
    assigned_user_id: "u-mgr-1",
    submitted_by_user_id: "u-sales-1",
    needs_service: false,
    needs_bodywork: false,
    recall_checked: true,
    recall_open: false,
    recall_completed: false,
    fueled: true,
    qc_required: true,
    qc_completed: false,
    service_status: "not_needed",
    bodywork_status: "not_needed",
    service_notes: "",
    bodywork_notes: "",
    notes: "Waiting on final manager walkaround."
  }
].map((vehicle) => ({
  ...vehicle,
  assigned_role: deriveAssignedRole(vehicle),
  created_at: new Date(now - 1000 * 60 * 60 * 12).toISOString(),
  updated_at: new Date(now - 1000 * 60 * 20).toISOString()
}));

export const auditLogs = [
  {
    id: uuid(),
    vehicle_id: "v-1004",
    user_id: "u-genius-1",
    action_type: "status_change",
    field_changed: "status",
    old_value: "Detail Finished",
    new_value: "Vehicle Removed from Detail",
    created_at: new Date(now - 1000 * 60 * 90).toISOString()
  },
  {
    id: uuid(),
    vehicle_id: "v-1005",
    user_id: "u-service-1",
    action_type: "flag_update",
    field_changed: "qc_required",
    old_value: "false",
    new_value: "true",
    created_at: new Date(now - 1000 * 60 * 60).toISOString()
  }
];

export const actionDefinitions = DEFAULT_ACTION_DEFINITIONS.map((action) => ({ ...action }));

export function hydrateVehicle(vehicle, actions = actionDefinitions, currentUserId = null) {
  return {
    ...vehicle,
    assigned_role: deriveAssignedRole(vehicle),
    actions: buildActionList(vehicle, actions, currentUserId)
  };
}
