import { useEffect, useState } from "react";
import { getAuditEntryDisplay } from "../../utils/appHelpers";

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

const progressOptions = [
  { value: "not_needed", label: "Not Needed" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" }
];

export default function VehicleDetailModal({
  selectedVehicle,
  onClose,
  completionEntry,
  fmtDate,
  formatFieldLabel,
  canEditDueDate,
  dueDateEdit,
  setDueDateEdit,
  updateVehicleDueDate,
  toDateTimeLocalValue,
  getServiceDisplayLabel,
  getBodyworkDisplayLabel,
  completionIndicators,
  hasManagerAccess,
  canAccessAdmin,
  unarchiveVehicle,
  archiveVehicle,
  availableActions,
  performAction,
  updateStatus,
  updateFlags,
  saveManagerCorrections,
  completedSteps
}) {
  const [corrections, setCorrections] = useState(null);
  const [showCorrectionPanel, setShowCorrectionPanel] = useState(false);

  useEffect(() => {
    if (!selectedVehicle) {
      setCorrections(null);
      setShowCorrectionPanel(false);
      return;
    }

    setShowCorrectionPanel(false);
    setCorrections({
      status: selectedVehicle.status,
      needs_service: Boolean(selectedVehicle.needs_service),
      service_status: selectedVehicle.service_status,
      needs_bodywork: Boolean(selectedVehicle.needs_bodywork),
      bodywork_status: selectedVehicle.bodywork_status,
      fueled: Boolean(selectedVehicle.fueled),
      qc_required: Boolean(selectedVehicle.qc_required),
      qc_completed: Boolean(selectedVehicle.qc_completed),
      recall_checked: Boolean(selectedVehicle.recall_checked),
      recall_open: Boolean(selectedVehicle.recall_open),
      recall_completed: Boolean(selectedVehicle.recall_completed)
    });
  }, [selectedVehicle]);

  if (!selectedVehicle) {
    return null;
  }

  function setCorrection(field, value) {
    setCorrections((current) => {
      const next = { ...current, [field]: value };

      if (field === "needs_service" && !value) {
        next.service_status = "not_needed";
      } else if (field === "needs_service" && value && next.service_status === "not_needed") {
        next.service_status = "pending";
      }

      if (field === "needs_bodywork" && !value) {
        next.bodywork_status = "not_needed";
      } else if (field === "needs_bodywork" && value && next.bodywork_status === "not_needed") {
        next.bodywork_status = "pending";
      }

      if (field === "qc_required" && !value) {
        next.qc_completed = false;
      }

      if (field === "recall_checked" && !value) {
        next.recall_open = false;
        next.recall_completed = false;
      }

      if (field === "recall_open") {
        if (value) {
          next.recall_checked = true;
        } else {
          next.recall_completed = false;
        }
      }

      if (field === "recall_completed" && value) {
        next.recall_checked = true;
        next.recall_open = true;
      }

      return next;
    });
  }

  return (
    <div className="detail-overlay">
      <section className="detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vehicle Detail</p>
            <h2>{selectedVehicle.stock_number} | {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</h2>
          </div>
          <button type="button" className="secondary-btn" onClick={onClose}>Close</button>
        </div>

        <div className="detail-card">
          {selectedVehicle.is_archived ? (
            <div className="completion-banner">
              <strong>Archived Vehicle</strong>
              <span>This unit is hidden from active displays but still preserved in the audit history.</span>
            </div>
          ) : null}
          {selectedVehicle.status === "ready" ? (
            <div className="completion-banner">
              <strong>Front Line Ready</strong>
              <span>
                {completionEntry
                  ? `Completed by ${completionEntry.user?.name ?? "Unknown User"} on ${fmtDate(completionEntry.created_at)}`
                  : "This unit has been marked complete."}
              </span>
            </div>
          ) : null}
          <p><strong>Status:</strong> {formatFieldLabel(selectedVehicle.status)}</p>
          <div className="due-edit-row">
            <div>
              <strong>Due:</strong>
              <span>{fmtDate(selectedVehicle.due_date)}</span>
            </div>
            {canEditDueDate && !selectedVehicle.is_archived ? (
              <div className="due-edit-controls">
                <input type="datetime-local" value={dueDateEdit} onChange={(event) => setDueDateEdit(event.target.value)} />
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => updateVehicleDueDate(selectedVehicle.id)}
                  disabled={!dueDateEdit || dueDateEdit === toDateTimeLocalValue(selectedVehicle.due_date)}
                >
                  Save Due Date
                </button>
              </div>
            ) : null}
          </div>
          <p><strong>Notes:</strong> {selectedVehicle.notes || "None"}</p>
          {selectedVehicle.needs_service ? <p><strong>{getServiceDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.service_notes || "No service notes"}</p> : null}
          {selectedVehicle.needs_bodywork ? <p><strong>{getBodyworkDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.bodywork_notes || "No body work notes"}</p> : null}
          {completionIndicators.length > 0 ? (
            <div className="indicator-grid">
              {completionIndicators.map((indicator) => (
                <span key={indicator.label} className="indicator-chip complete">
                  {indicator.label}
                </span>
              ))}
            </div>
          ) : null}
          {hasManagerAccess ? (
            <div className="detail-actions-row">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setShowCorrectionPanel((current) => !current)}
              >
                {showCorrectionPanel ? "Hide Adjustments" : "Edit Workflow"}
              </button>
              {selectedVehicle.is_archived && canAccessAdmin ? (
                <button type="button" className="primary-btn" onClick={() => unarchiveVehicle(selectedVehicle.id)}>
                  Unarchive Vehicle
                </button>
              ) : (
                <button type="button" className="danger-btn" onClick={() => archiveVehicle(selectedVehicle.id)}>
                  Archive Vehicle
                </button>
              )}
            </div>
          ) : null}
        </div>

        <div className="detail-card">
          <h3>{selectedVehicle.status === "ready" ? "Completion Summary" : "Available Actions"}</h3>
          {selectedVehicle.status === "ready" ? (
            <div className="completion-summary">
              <p><strong>Completed By:</strong> {completionEntry?.user?.name ?? "Unknown User"}</p>
              <p><strong>Completed At:</strong> {completionEntry ? fmtDate(completionEntry.created_at) : "Unknown"}</p>
            </div>
          ) : (
            <div className="action-grid">
              {availableActions.length > 0 ? availableActions.map((action) => (
                <button
                  type="button"
                  key={action.key}
                  className="next-step-btn"
                  onClick={() => performAction(selectedVehicle.id, action.key, updateStatus, updateFlags)}
                >
                  {action.label}
                </button>
              )) : <p className="step-helper">No actions are available right now.</p>}
            </div>
          )}
        </div>

        {hasManagerAccess && corrections && showCorrectionPanel ? (
          <div className="detail-card">
            <div className="section-heading compact">
              <div>
                <h3>Workflow Editor</h3>
                <p className="step-helper">
                  Adjust the live workflow fields directly if someone tapped the wrong step.
                </p>
              </div>
              <button
                type="button"
                className="primary-btn"
                onClick={() => saveManagerCorrections(selectedVehicle.id, corrections)}
              >
                Save Changes
              </button>
            </div>

            <div className="manager-correction-grid">
              <label>
                Current Status
                <select value={corrections.status} onChange={(event) => setCorrection("status", event.target.value)}>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{formatFieldLabel(status)}</option>
                  ))}
                </select>
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.fueled}
                  onChange={(event) => setCorrection("fueled", event.target.checked)}
                />
                Fueled
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.qc_required}
                  onChange={(event) => setCorrection("qc_required", event.target.checked)}
                />
                QC Required
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.qc_completed}
                  disabled={!corrections.qc_required}
                  onChange={(event) => setCorrection("qc_completed", event.target.checked)}
                />
                QC Completed
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.needs_service}
                  onChange={(event) => setCorrection("needs_service", event.target.checked)}
                />
                Needs Service
              </label>

              <label>
                Service Status
                <select
                  value={corrections.service_status}
                  disabled={!corrections.needs_service}
                  onChange={(event) => setCorrection("service_status", event.target.value)}
                >
                  {progressOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.needs_bodywork}
                  onChange={(event) => setCorrection("needs_bodywork", event.target.checked)}
                />
                Needs Body Work
              </label>

              <label>
                Body Work Status
                <select
                  value={corrections.bodywork_status}
                  disabled={!corrections.needs_bodywork}
                  onChange={(event) => setCorrection("bodywork_status", event.target.value)}
                >
                  {progressOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.recall_checked}
                  onChange={(event) => setCorrection("recall_checked", event.target.checked)}
                />
                Recalls Checked
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.recall_open}
                  onChange={(event) => setCorrection("recall_open", event.target.checked)}
                />
                Recall Open
              </label>

              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={corrections.recall_completed}
                  onChange={(event) => setCorrection("recall_completed", event.target.checked)}
                />
                Recall Completed
              </label>
            </div>
          </div>
        ) : null}

        <div className="detail-card">
          <h3>Completed Steps</h3>
          {completedSteps.length > 0 ? (
            <div className="timeline">
              {completedSteps.map((step) => (
                <div key={step.key} className="timeline-item">
                  <strong>{step.label}</strong>
                  <span>{step.entry.user?.name ?? "Unknown User"} | {fmtDate(step.entry.created_at)}</span>
                </div>
              ))}
            </div>
          ) : <p className="step-helper">No completed steps have been logged yet.</p>}
        </div>

        <div className="detail-card">
          <h3>Activity Log</h3>
          <div className="timeline">
            {selectedVehicle.timeline.map((entry) => {
              const display = getAuditEntryDisplay(entry);
              return (
                <div key={entry.id} className="timeline-item">
                  <strong>{display.title}</strong>
                  <span>{fmtDate(entry.created_at)} | {entry.user?.name ?? "Unknown User"}</span>
                  {display.detail ? <p>{display.detail}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
