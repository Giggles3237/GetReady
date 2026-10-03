import { useEffect, useMemo, useState } from "react";
import { formatFieldLabel, formatStockNumber, toDateTimeLocalValue } from "../../utils/appHelpers";

const statusOptions = [
  "submitted",
  "to_detail",
  "detail_started",
  "detail_finished",
  "removed_from_detail",
  "service",
  "qc",
  "ready"
];

const workStatusOptions = ["not_needed", "pending", "in_progress", "completed"];

const booleanColumns = [
  { key: "needs_service", label: "Svc" },
  { key: "needs_bodywork", label: "Body" },
  { key: "recall_checked", label: "Recall Checked" },
  { key: "recall_open", label: "Recall Open" },
  { key: "recall_completed", label: "Recall Done" },
  { key: "fueled", label: "Fuel" },
  { key: "qc_required", label: "QC Req" },
  { key: "qc_completed", label: "QC Done" }
];

function buildDraft(vehicle) {
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

function getChangedFields(vehicle, draft) {
  const original = buildDraft(vehicle);
  const changes = {};

  Object.entries(draft).forEach(([key, value]) => {
    if (String(original[key] ?? "") === String(value ?? "")) {
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

export default function SpreadsheetTab({
  vehicles,
  users,
  error,
  successMessage,
  loadSpreadsheet,
  saveSpreadsheetVehicle,
  openVehicle
}) {
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState("");
  const [savingIds, setSavingIds] = useState([]);

  useEffect(() => {
    setDrafts(Object.fromEntries(vehicles.map((vehicle) => [vehicle.id, buildDraft(vehicle)])));
  }, [vehicles]);

  const activeUsers = useMemo(() => users.filter((user) => user.is_active), [users]);
  const salespersonUsers = useMemo(() => activeUsers.filter((user) => user.role === "salesperson"), [activeUsers]);
  const savingIdSet = useMemo(() => new Set(savingIds), [savingIds]);

  const filteredVehicles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...vehicles].sort((left, right) => new Date(left.due_date).getTime() - new Date(right.due_date).getTime());

    if (!normalized) {
      return sorted;
    }

    return sorted.filter((vehicle) => [
      vehicle.stock_number,
      vehicle.year,
      vehicle.make,
      vehicle.model,
      vehicle.color,
      vehicle.status,
      vehicle.submitted_by?.name,
      vehicle.assigned_user?.name,
      vehicle.notes,
      vehicle.service_notes,
      vehicle.bodywork_notes
    ].join(" ").toLowerCase().includes(normalized));
  }, [vehicles, query]);

  const dirtyRows = useMemo(() => vehicles.filter((vehicle) => {
    const draft = drafts[vehicle.id];
    return draft && Object.keys(getChangedFields(vehicle, draft)).length > 0;
  }), [vehicles, drafts]);

  function updateDraft(vehicleId, field, value) {
    setDrafts((current) => ({
      ...current,
      [vehicleId]: {
        ...current[vehicleId],
        [field]: value
      }
    }));
  }

  function resetRow(vehicle) {
    setDrafts((current) => ({
      ...current,
      [vehicle.id]: buildDraft(vehicle)
    }));
  }

  async function saveRow(vehicle) {
    const draft = drafts[vehicle.id];
    const changes = getChangedFields(vehicle, draft);

    if (Object.keys(changes).length === 0 || savingIdSet.has(vehicle.id)) {
      return;
    }

    setSavingIds((current) => [...current, vehicle.id]);
    try {
      await saveSpreadsheetVehicle(vehicle.id, changes);
    } finally {
      setSavingIds((current) => current.filter((id) => id !== vehicle.id));
    }
  }

  async function saveAll() {
    for (const vehicle of dirtyRows) {
      await saveRow(vehicle);
    }
  }

  return (
    <section className="panel spreadsheet-panel">
      <div className="section-heading spreadsheet-heading">
        <div>
          <p className="eyebrow">Manager Tools</p>
          <h2>Get Ready Spreadsheet</h2>
        </div>
        <div className="spreadsheet-actions">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter rows..." aria-label="Filter spreadsheet rows" />
          <button type="button" className="secondary-btn" onClick={loadSpreadsheet}>Refresh</button>
          <button type="button" className="primary-btn" disabled={dirtyRows.length === 0 || savingIds.length > 0} onClick={saveAll}>
            Save {dirtyRows.length || ""}
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {successMessage ? <div className="success-banner">{successMessage}</div> : null}

      <div className="spreadsheet-summary">
        <span><strong>{filteredVehicles.length}</strong> visible</span>
        <span><strong>{dirtyRows.length}</strong> unsaved</span>
      </div>

      <div className="spreadsheet-wrap">
        <table className="spreadsheet-table">
          <thead>
            <tr>
              <th className="sticky-col">Stock</th>
              <th>Year</th>
              <th>Make</th>
              <th>Model</th>
              <th>Color</th>
              <th>Due</th>
              <th>Status</th>
              <th>Sales</th>
              <th>Assigned</th>
              {booleanColumns.map((column) => <th key={column.key}>{column.label}</th>)}
              <th>Service</th>
              <th>Bodywork</th>
              <th>Notes</th>
              <th>Service Notes</th>
              <th>Body Notes</th>
              <th>Row</th>
            </tr>
          </thead>
          <tbody>
            {filteredVehicles.map((vehicle) => {
              const draft = drafts[vehicle.id] ?? buildDraft(vehicle);
              const isDirty = Object.keys(getChangedFields(vehicle, draft)).length > 0;
              const isSaving = savingIdSet.has(vehicle.id);

              return (
                <tr key={vehicle.id} className={isDirty ? "dirty" : ""}>
                  <td className="sticky-col stock-cell">
                    <input value={draft.stock_number} onChange={(event) => updateDraft(vehicle.id, "stock_number", event.target.value)} aria-label={`Stock number for ${formatStockNumber(vehicle.stock_number)}`} />
                    <button type="button" onClick={() => openVehicle(vehicle.id)}>Open</button>
                  </td>
                  <td><input className="cell-year" type="number" value={draft.year} onChange={(event) => updateDraft(vehicle.id, "year", event.target.value)} /></td>
                  <td><input value={draft.make} onChange={(event) => updateDraft(vehicle.id, "make", event.target.value)} /></td>
                  <td><input value={draft.model} onChange={(event) => updateDraft(vehicle.id, "model", event.target.value)} /></td>
                  <td><input value={draft.color} onChange={(event) => updateDraft(vehicle.id, "color", event.target.value)} /></td>
                  <td><input className="cell-datetime" type="datetime-local" value={draft.due_date} onChange={(event) => updateDraft(vehicle.id, "due_date", event.target.value)} /></td>
                  <td>
                    <select value={draft.status} onChange={(event) => updateDraft(vehicle.id, "status", event.target.value)}>
                      {statusOptions.map((status) => <option key={status} value={status}>{formatFieldLabel(status)}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={draft.submitted_by_user_id} onChange={(event) => updateDraft(vehicle.id, "submitted_by_user_id", event.target.value)}>
                      <option value="">Unassigned</option>
                      {salespersonUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={draft.assigned_user_id} onChange={(event) => updateDraft(vehicle.id, "assigned_user_id", event.target.value)}>
                      <option value="">Unassigned</option>
                      {activeUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                  </td>
                  {booleanColumns.map((column) => (
                    <td key={column.key} className="checkbox-cell">
                      <input
                        type="checkbox"
                        checked={draft[column.key]}
                        onChange={(event) => updateDraft(vehicle.id, column.key, event.target.checked)}
                        aria-label={`${column.label} for ${formatStockNumber(vehicle.stock_number)}`}
                      />
                    </td>
                  ))}
                  <td>
                    <select value={draft.service_status} onChange={(event) => updateDraft(vehicle.id, "service_status", event.target.value)}>
                      {workStatusOptions.map((status) => <option key={status} value={status}>{formatFieldLabel(status)}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={draft.bodywork_status} onChange={(event) => updateDraft(vehicle.id, "bodywork_status", event.target.value)}>
                      {workStatusOptions.map((status) => <option key={status} value={status}>{formatFieldLabel(status)}</option>)}
                    </select>
                  </td>
                  <td><textarea value={draft.notes} onChange={(event) => updateDraft(vehicle.id, "notes", event.target.value)} /></td>
                  <td><textarea value={draft.service_notes} onChange={(event) => updateDraft(vehicle.id, "service_notes", event.target.value)} /></td>
                  <td><textarea value={draft.bodywork_notes} onChange={(event) => updateDraft(vehicle.id, "bodywork_notes", event.target.value)} /></td>
                  <td className="row-actions">
                    <button type="button" className="primary-btn" disabled={!isDirty || isSaving} onClick={() => saveRow(vehicle)}>
                      {isSaving ? "Saving" : "Save"}
                    </button>
                    <button type="button" className="secondary-btn" disabled={!isDirty || isSaving} onClick={() => resetRow(vehicle)}>Reset</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
