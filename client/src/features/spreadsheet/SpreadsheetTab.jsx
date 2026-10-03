import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatFieldLabel, formatStockNumber } from "../../utils/appHelpers";
import {
  buildSpreadsheetDraft,
  getSpreadsheetChanges,
  reconcileSpreadsheetDrafts
} from "./spreadsheetDrafts";

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
  const editVersionRef = useRef(0);
  const editVersionsRef = useRef({});
  const savingIdsRef = useRef(new Set());

  useEffect(() => {
    setDrafts((current) => reconcileSpreadsheetDrafts(vehicles, current, editVersionsRef.current));
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
    return draft && Object.keys(getSpreadsheetChanges(vehicle, draft)).length > 0;
  }), [vehicles, drafts]);

  function updateDraft(vehicleId, field, value) {
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    const serverValue = vehicle ? buildSpreadsheetDraft(vehicle)[field] : undefined;
    const rowVersions = { ...(editVersionsRef.current[vehicleId] ?? {}) };

    if (!savingIdsRef.current.has(vehicleId) && String(value ?? "") === String(serverValue ?? "")) {
      delete rowVersions[field];
    } else {
      editVersionRef.current += 1;
      rowVersions[field] = editVersionRef.current;
    }
    editVersionsRef.current = {
      ...editVersionsRef.current,
      [vehicleId]: rowVersions
    };

    setDrafts((current) => ({
      ...current,
      [vehicleId]: {
        ...current[vehicleId],
        [field]: value
      }
    }));
  }

  function resetRow(vehicle) {
    const nextEditVersions = { ...editVersionsRef.current };
    delete nextEditVersions[vehicle.id];
    editVersionsRef.current = nextEditVersions;
    setDrafts((current) => ({
      ...current,
      [vehicle.id]: buildSpreadsheetDraft(vehicle)
    }));
  }

  function snapshotSave(vehicle) {
    return {
      vehicleId: vehicle.id,
      changes: getSpreadsheetChanges(vehicle, drafts[vehicle.id]),
      editVersions: { ...(editVersionsRef.current[vehicle.id] ?? {}) }
    };
  }

  async function saveChanges({ vehicleId, changes, editVersions }) {
    if (Object.keys(changes).length === 0 || savingIdsRef.current.has(vehicleId)) {
      return;
    }

    savingIdsRef.current.add(vehicleId);
    setSavingIds((current) => [...current, vehicleId]);
    try {
      const savedVehicle = await saveSpreadsheetVehicle(vehicleId, changes);
      const savedDraft = savedVehicle ? buildSpreadsheetDraft(savedVehicle) : null;
      const currentVersions = { ...(editVersionsRef.current[vehicleId] ?? {}) };
      const acceptedFields = Object.keys(changes).filter((field) => currentVersions[field] === editVersions[field]);

      acceptedFields.forEach((field) => {
        delete currentVersions[field];
      });
      editVersionsRef.current = {
        ...editVersionsRef.current,
        [vehicleId]: currentVersions
      };

      if (savedDraft) {
        setDrafts((current) => ({
          ...current,
          [vehicleId]: {
            ...current[vehicleId],
            ...Object.fromEntries(acceptedFields.map((field) => [field, savedDraft[field]]))
          }
        }));
      }
    } finally {
      savingIdsRef.current.delete(vehicleId);
      setSavingIds((current) => current.filter((id) => id !== vehicleId));
    }
  }

  async function saveRow(vehicle) {
    try {
      await saveChanges(snapshotSave(vehicle));
    } catch {
      // The parent reports the request error; keep the draft available for retry.
    }
  }

  async function saveAll() {
    const pendingSaves = dirtyRows.map(snapshotSave);

    for (const pendingSave of pendingSaves) {
      try {
        await saveChanges(pendingSave);
      } catch {
        // Continue saving the remaining snapshot; failed rows stay dirty for retry.
      }
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
              const draft = drafts[vehicle.id] ?? buildSpreadsheetDraft(vehicle);
              const isDirty = Object.keys(getSpreadsheetChanges(vehicle, draft)).length > 0;
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
