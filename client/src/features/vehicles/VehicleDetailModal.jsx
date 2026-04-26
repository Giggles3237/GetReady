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
  completedSteps
}) {
  if (!selectedVehicle) {
    return null;
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
          <h3>Audit Timeline</h3>
          <div className="timeline">
            {selectedVehicle.timeline.map((entry) => (
              <div key={entry.id} className="timeline-item">
                <strong>{fmtDate(entry.created_at)}</strong>
                <span>{entry.user?.name ?? "Unknown User"}</span>
                <p>{formatFieldLabel(entry.field_changed)}: {String(entry.old_value || "empty")} to {String(entry.new_value || "empty")}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
