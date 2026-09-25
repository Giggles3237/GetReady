import { useEffect, useMemo, useState } from "react";
import { formatStockNumber, getAuditEntryDisplay } from "../../utils/appHelpers";

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

const statusProgress = {
  submitted: 12,
  to_detail: 26,
  detail_started: 40,
  detail_finished: 54,
  removed_from_detail: 66,
  service: 76,
  qc: 88,
  ready: 100
};

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
  addVehicleComment,
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
  const [comment, setComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  useEffect(() => {
    if (!selectedVehicle) {
      setCorrections(null);
      setShowCorrectionPanel(false);
      setComment("");
      return;
    }

    setShowCorrectionPanel(false);
    setComment("");
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

  const comments = useMemo(
    () => selectedVehicle?.timeline?.filter((entry) => entry.field_changed === "comment") ?? [],
    [selectedVehicle]
  );
  const activity = useMemo(
    () => selectedVehicle?.timeline?.filter((entry) => entry.field_changed !== "comment") ?? [],
    [selectedVehicle]
  );

  if (!selectedVehicle) {
    return null;
  }

  function setCorrection(field, value) {
    setCorrections((current) => {
      const next = { ...current, [field]: value };

      if (field === "needs_service" && !value) next.service_status = "not_needed";
      if (field === "needs_service" && value && next.service_status === "not_needed") next.service_status = "pending";
      if (field === "needs_bodywork" && !value) next.bodywork_status = "not_needed";
      if (field === "needs_bodywork" && value && next.bodywork_status === "not_needed") next.bodywork_status = "pending";
      if (field === "qc_required" && !value) next.qc_completed = false;
      if (field === "recall_checked" && !value) {
        next.recall_open = false;
        next.recall_completed = false;
      }
      if (field === "recall_open") {
        if (value) next.recall_checked = true;
        else next.recall_completed = false;
      }
      if (field === "recall_completed" && value) {
        next.recall_checked = true;
        next.recall_open = true;
      }

      return next;
    });
  }

  async function submitComment(event) {
    event.preventDefault();
    const value = comment.trim();
    if (!value || commentBusy) return;

    setCommentBusy(true);
    try {
      await addVehicleComment(selectedVehicle.id, value);
      setComment("");
    } finally {
      setCommentBusy(false);
    }
  }

  function runAction(event) {
    const actionKey = event.target.value;
    if (!actionKey) return;
    performAction(selectedVehicle.id, actionKey, updateStatus, updateFlags);
    event.target.value = "";
  }

  const vehicleTitle = `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`;
  const workflowPercent = statusProgress[selectedVehicle.status] ?? 8;

  return (
    <div className="detail-overlay" onClick={onClose}>
      <section className="detail-modal vehicle-detail-screen" onClick={(event) => event.stopPropagation()}>
        <header className="vehicle-detail-header">
          <div>
            <p className="eyebrow">Vehicle Detail / Get Ready</p>
            <h2>{formatStockNumber(selectedVehicle.stock_number)}</h2>
            <p className="vehicle-detail-title">{vehicleTitle} · {selectedVehicle.color}</p>
          </div>
          <div className="vehicle-detail-header-actions">
            {hasManagerAccess ? (
              <button type="button" className="secondary-btn" onClick={() => setShowCorrectionPanel((current) => !current)}>
                {showCorrectionPanel ? "Done" : "Edit"}
              </button>
            ) : null}
            <button type="button" className="detail-close-btn" onClick={onClose} aria-label="Close vehicle detail">×</button>
          </div>
        </header>

        <div className="vehicle-detail-body">
          {selectedVehicle.is_archived ? (
            <div className="completion-banner">
              <strong>Archived Vehicle</strong>
              <span>Hidden from active displays with history preserved.</span>
            </div>
          ) : null}
          {selectedVehicle.status === "ready" ? (
            <div className="completion-banner">
              <strong>Vehicle Delivered</strong>
              <span>{completionEntry ? `Completed by ${completionEntry.user?.name ?? "Unknown User"} on ${fmtDate(completionEntry.created_at)}` : "This unit is complete."}</span>
            </div>
          ) : null}

          <div className="vehicle-people-grid">
            <div>
              <span>Salesperson</span>
              <strong>{selectedVehicle.submitted_by?.name ?? "Unassigned"}</strong>
            </div>
            <div>
              <span>Assigned To</span>
              <strong>{selectedVehicle.assigned_user?.name ?? formatFieldLabel(selectedVehicle.assigned_role)}</strong>
            </div>
          </div>

          <section className="workflow-position-panel">
            <div className="workflow-position-row">
              <div>
                <span>Workflow Position</span>
                <strong>{formatFieldLabel(selectedVehicle.status)}</strong>
              </div>
              {availableActions.length > 0 ? (
                <select className="workflow-action-select" defaultValue="" onChange={runAction} aria-label="Choose next workflow action">
                  <option value="" disabled>Choose next action</option>
                  {availableActions.map((action) => <option key={action.key} value={action.key}>{action.label}</option>)}
                </select>
              ) : <span className="workflow-complete-label">Workflow complete</span>}
            </div>
            <div className="workflow-progress" aria-label={`${workflowPercent}% complete`}>
              <span style={{ width: `${workflowPercent}%` }} />
            </div>
          </section>

          {!selectedVehicle.fueled ? (
            <section className="fuel-check-panel">
              <div>
                <strong>Fuel check</strong>
                <span>This unit still needs gas.</span>
              </div>
              <button type="button" className="secondary-btn" onClick={() => updateFlags(selectedVehicle.id, { fueled: true })}>Set to Yes</button>
            </section>
          ) : (
            <section className="fuel-check-panel complete">
              <div><strong>Fuel check</strong><span>Fuel confirmed.</span></div>
              <span className="indicator-chip complete">Complete</span>
            </section>
          )}

          <section className="shared-notes-section">
            <div className="shared-notes-heading">
              <div><h3>Shared comments</h3><p>Visible to every teammate working on this unit.</p></div>
              <span className="comment-count">{comments.length} {comments.length === 1 ? "comment" : "comments"}</span>
            </div>
            <div className="comment-list">
              {comments.length > 0 ? comments.map((entry) => (
                <article key={entry.id} className="comment-item">
                  <div><strong>{entry.user?.name ?? "Unknown User"}</strong><span>{fmtDate(entry.created_at)}</span></div>
                  <p>{entry.new_value}</p>
                </article>
              )) : <div className="comments-empty">No comments yet. Add the first handoff detail.</div>}
            </div>
            <form className="comment-composer" onSubmit={submitComment}>
              <input value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="Add a handoff comment..." aria-label="New vehicle comment" />
              <button type="submit" disabled={!comment.trim() || commentBusy} aria-label="Post comment">{commentBusy ? "…" : "→"}</button>
            </form>
          </section>

          {selectedVehicle.notes || selectedVehicle.needs_service || selectedVehicle.needs_bodywork ? (
            <section className="vehicle-existing-notes">
              <h3>Vehicle notes</h3>
              {selectedVehicle.notes ? <p>{selectedVehicle.notes}</p> : null}
              {selectedVehicle.needs_service ? <p><strong>{getServiceDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.service_notes || "No service notes"}</p> : null}
              {selectedVehicle.needs_bodywork ? <p><strong>{getBodyworkDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.bodywork_notes || "No body work notes"}</p> : null}
            </section>
          ) : null}

          {showCorrectionPanel && corrections ? (
            <section className="workflow-editor-panel">
              <div className="section-heading compact">
                <div><h3>Workflow Editor</h3><p className="step-helper">Correct workflow fields and due date.</p></div>
                <button type="button" className="primary-btn" onClick={() => saveManagerCorrections(selectedVehicle.id, corrections)}>Save Changes</button>
              </div>
              {canEditDueDate ? (
                <div className="due-edit-controls">
                  <input type="datetime-local" value={dueDateEdit} onChange={(event) => setDueDateEdit(event.target.value)} />
                  <button type="button" className="secondary-btn" onClick={() => updateVehicleDueDate(selectedVehicle.id)} disabled={!dueDateEdit || dueDateEdit === toDateTimeLocalValue(selectedVehicle.due_date)}>Save Due Date</button>
                </div>
              ) : null}
              <div className="manager-correction-grid">
                <label>Current Status<select value={corrections.status} onChange={(event) => setCorrection("status", event.target.value)}>{statusOptions.map((status) => <option key={status} value={status}>{formatFieldLabel(status)}</option>)}</select></label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.fueled} onChange={(event) => setCorrection("fueled", event.target.checked)} />Fueled</label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.qc_required} onChange={(event) => setCorrection("qc_required", event.target.checked)} />QC Required</label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.qc_completed} disabled={!corrections.qc_required} onChange={(event) => setCorrection("qc_completed", event.target.checked)} />QC Completed</label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.needs_service} onChange={(event) => setCorrection("needs_service", event.target.checked)} />Needs Service</label>
                <label>Service Status<select value={corrections.service_status} disabled={!corrections.needs_service} onChange={(event) => setCorrection("service_status", event.target.value)}>{progressOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.needs_bodywork} onChange={(event) => setCorrection("needs_bodywork", event.target.checked)} />Needs Body Work</label>
                <label>Body Work Status<select value={corrections.bodywork_status} disabled={!corrections.needs_bodywork} onChange={(event) => setCorrection("bodywork_status", event.target.value)}>{progressOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.recall_checked} onChange={(event) => setCorrection("recall_checked", event.target.checked)} />Recalls Checked</label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.recall_open} onChange={(event) => setCorrection("recall_open", event.target.checked)} />Recall Open</label>
                <label className="toggle-line"><input type="checkbox" checked={corrections.recall_completed} onChange={(event) => setCorrection("recall_completed", event.target.checked)} />Recall Completed</label>
              </div>
              <div className="detail-actions-row">
                {selectedVehicle.is_archived && canAccessAdmin ? <button type="button" className="primary-btn" onClick={() => unarchiveVehicle(selectedVehicle.id)}>Unarchive Vehicle</button> : <button type="button" className="danger-btn" onClick={() => archiveVehicle(selectedVehicle.id)}>Archive Vehicle</button>}
              </div>
            </section>
          ) : null}

          <details className="vehicle-history">
            <summary>History and completed steps</summary>
            {completionIndicators.length > 0 ? <div className="indicator-grid">{completionIndicators.map((indicator) => <span key={indicator.label} className="indicator-chip complete">{indicator.label}</span>)}</div> : null}
            {completedSteps.map((step) => <div key={step.key} className="timeline-item"><strong>{step.label}</strong><span>{step.entry.user?.name ?? "Unknown User"} · {fmtDate(step.entry.created_at)}</span></div>)}
            {activity.map((entry) => {
              const display = getAuditEntryDisplay(entry);
              return <div key={entry.id} className="timeline-item"><strong>{display.title}</strong><span>{fmtDate(entry.created_at)} · {entry.user?.name ?? "Unknown User"}</span>{display.detail ? <p>{display.detail}</p> : null}</div>;
            })}
          </details>
        </div>

        <footer className="vehicle-detail-footer">{selectedVehicle.status === "ready" ? "Vehicle Delivered" : `Due ${fmtDate(selectedVehicle.due_date)}`}</footer>
      </section>
    </div>
  );
}
