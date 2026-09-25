import { useEffect, useMemo, useState } from "react";
import { formatFieldLabel, formatStockNumber, toDateTimeLocalValue } from "../../utils/appHelpers";

const bulkStatusOptions = [
  "submitted",
  "to_detail",
  "detail_finished",
  "removed_from_detail",
  "service",
  "qc",
  "ready"
];

export default function DashboardTab({
  roleOptions,
  dashboardRole,
  authUser,
  role,
  salespersonView,
  setSalespersonView,
  showCompleted,
  setShowCompleted,
  error,
  successMessage,
  overdueActionVehicles,
  completedVehicles,
  actionSections,
  showSalespersonSubmissionSection,
  mySubmittedVehicles,
  openVehicle,
  isOverdue,
  getVehicleTimeTone,
  getVehicleTimeLabel,
  getNextActionForRole,
  fmtDate,
  getWorkflowBadges,
  hasManagerAccess,
  canEditDueDate,
  performAction,
  updateStatus,
  updateFlags,
  addVehicleComment,
  updateVehicleDueDate,
  pipelineColumns,
  grouped,
  bulkUpdateStatus
}) {
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectedVehicleIdSet = useMemo(() => new Set(selectedVehicleIds), [selectedVehicleIds]);
  const visibleManagerVehicleIds = useMemo(
    () => pipelineColumns.flatMap((column) => (grouped[column] ?? []).map((vehicle) => vehicle.id)),
    [grouped, pipelineColumns]
  );

  useEffect(() => {
    const visibleIds = new Set(visibleManagerVehicleIds);
    setSelectedVehicleIds((current) => current.filter((vehicleId) => visibleIds.has(vehicleId)));
  }, [visibleManagerVehicleIds]);

  function toggleVehicle(vehicleId) {
    setSelectedVehicleIds((current) => current.includes(vehicleId)
      ? current.filter((id) => id !== vehicleId)
      : [...current, vehicleId]);
  }

  function toggleColumn(vehicles) {
    const columnIds = vehicles.map((vehicle) => vehicle.id);
    const allSelected = columnIds.length > 0 && columnIds.every((vehicleId) => selectedVehicleIdSet.has(vehicleId));
    setSelectedVehicleIds((current) => {
      const next = new Set(current);
      columnIds.forEach((vehicleId) => allSelected ? next.delete(vehicleId) : next.add(vehicleId));
      return [...next];
    });
  }

  async function applyBulkStatus() {
    if (!bulkStatus || selectedVehicleIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Change ${selectedVehicleIds.length} selected vehicle${selectedVehicleIds.length === 1 ? "" : "s"} to ${formatFieldLabel(bulkStatus)}? Normal workflow rules and notifications will apply.`
    );
    if (!confirmed) {
      return;
    }

    setBulkBusy(true);
    try {
      const result = await bulkUpdateStatus(selectedVehicleIds, bulkStatus);
      if (result) {
        setSelectedVehicleIds([]);
        setBulkStatus("");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Role Dashboard</p>
            <h2>{roleOptions.find((option) => option.value === dashboardRole)?.label} Next Actions</h2>
          </div>
          <span className="pill dashboard-user-pill">{authUser.name}</span>
        </div>

        <div className="dashboard-controls">
          {role === "salesperson" ? (
            <div className="view-toggle compact dashboard-toggle-group">
              <button type="button" className={`tab-btn ${salespersonView === "mine" ? "active" : ""}`} onClick={() => setSalespersonView("mine")}>
                Just Mine
              </button>
              <button type="button" className={`tab-btn ${salespersonView === "all" ? "active" : ""}`} onClick={() => setSalespersonView("all")}>
                Everyone
              </button>
            </div>
          ) : null}

          <label className="toggle-line dashboard-completed-toggle">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
            <span>Show Completed Units</span>
          </label>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {successMessage ? <div className="success-banner">{successMessage}</div> : null}
        {overdueActionVehicles.length > 0 ? (
          <div className="action-section overdue-section">
            <div className="action-section-head">
              <div className="action-section-title">
                <div>
                <p className="eyebrow">Urgent</p>
                <h3>Overdue Units</h3>
                </div>
              </div>
              <span className="pill overdue-pill">{overdueActionVehicles.length}</span>
            </div>
            <div className="dashboard-list">
              {overdueActionVehicles.map((vehicle) => (
                <DashboardListRow
                  key={`overdue-${vehicle.id}`}
                  vehicle={vehicle}
                  role={role}
                  openVehicle={openVehicle}
                  isOverdue={isOverdue}
                  getVehicleTimeTone={getVehicleTimeTone}
                  getVehicleTimeLabel={getVehicleTimeLabel}
                  getNextActionForRole={getNextActionForRole}
                  fmtDate={fmtDate}
                  getWorkflowBadges={getWorkflowBadges}
                  performAction={performAction}
                  updateStatus={updateStatus}
                  updateFlags={updateFlags}
                  addVehicleComment={addVehicleComment}
                  canEditDueDate={canEditDueDate}
                  updateVehicleDueDate={updateVehicleDueDate}
                  emphasized
                />
              ))}
            </div>
          </div>
        ) : null}

        {actionSections.length > 0 ? (
          <div className="action-sections">
            {actionSections.map((section) => (
              <div key={section.label} className="action-section">
                <div className="action-section-head">
                  <div className="action-section-title">
                    <h3>{section.label}</h3>
                  </div>
                  <span className="pill">{section.items.length}</span>
                </div>
                <div className="dashboard-list">
                  {section.items.map((vehicle) => (
                    <DashboardListRow
                      key={vehicle.id}
                      vehicle={vehicle}
                      role={role}
                      openVehicle={openVehicle}
                      isOverdue={isOverdue}
                      getVehicleTimeTone={getVehicleTimeTone}
                      getVehicleTimeLabel={getVehicleTimeLabel}
                      getNextActionForRole={getNextActionForRole}
                      fmtDate={fmtDate}
                      getWorkflowBadges={getWorkflowBadges}
                      performAction={performAction}
                      updateStatus={updateStatus}
                      updateFlags={updateFlags}
                      addVehicleComment={addVehicleComment}
                      canEditDueDate={canEditDueDate}
                      updateVehicleDueDate={updateVehicleDueDate}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : overdueActionVehicles.length === 0 && completedVehicles.length === 0 && !showSalespersonSubmissionSection ? (
          <div className="empty-inline">No units are waiting on your role right now.</div>
        ) : null}

        {hasManagerAccess && showCompleted && completedVehicles.length > 0 ? (
          <div className="action-sections completed-archive-section">
            <div className="action-section">
              <div className="action-section-head">
                <div className="action-section-title">
                  <div>
                    <p className="eyebrow">Ready to clean up</p>
                    <h3>Completed Units</h3>
                  </div>
                </div>
                <span className="pill">{completedVehicles.length}</span>
              </div>
              <div className="dashboard-list">
                {completedVehicles.map((vehicle) => (
                  <DashboardListRow
                    key={`completed-${vehicle.id}`}
                    vehicle={vehicle}
                    role={role}
                    openVehicle={openVehicle}
                    isOverdue={isOverdue}
                    getVehicleTimeTone={getVehicleTimeTone}
                    getVehicleTimeLabel={getVehicleTimeLabel}
                    getNextActionForRole={getNextActionForRole}
                    fmtDate={fmtDate}
                    getWorkflowBadges={getWorkflowBadges}
                    performAction={performAction}
                    updateStatus={updateStatus}
                    updateFlags={updateFlags}
                    addVehicleComment={addVehicleComment}
                    canEditDueDate={canEditDueDate}
                    updateVehicleDueDate={updateVehicleDueDate}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {showSalespersonSubmissionSection ? (
          <div className="action-sections submission-section">
            <div className="action-section">
              <div className="action-section-head">
                <h3>My Get Readies</h3>
                <span className="pill">{mySubmittedVehicles.length}</span>
              </div>
              <div className="dashboard-list">
                {mySubmittedVehicles.map((vehicle) => (
                  <DashboardListRow
                    key={`submitted-${vehicle.id}`}
                    vehicle={vehicle}
                    role={role}
                    openVehicle={openVehicle}
                    isOverdue={isOverdue}
                    getVehicleTimeTone={getVehicleTimeTone}
                    getVehicleTimeLabel={getVehicleTimeLabel}
                    getNextActionForRole={getNextActionForRole}
                    fmtDate={fmtDate}
                    getWorkflowBadges={getWorkflowBadges}
                    performAction={performAction}
                    updateStatus={updateStatus}
                    updateFlags={updateFlags}
                    addVehicleComment={addVehicleComment}
                    canEditDueDate={canEditDueDate}
                    updateVehicleDueDate={updateVehicleDueDate}
                    submittedView
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {hasManagerAccess ? (
        <section className="panel manager-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Manager View</p>
              <h2>Pipeline Board</h2>
            </div>
          </div>
          <div className="bulk-status-toolbar" aria-label="Bulk vehicle status controls">
            <div className="bulk-status-summary">
              <strong>{selectedVehicleIds.length} selected</strong>
              <span>Select vehicles below, then choose their new status.</span>
            </div>
            <label className="bulk-status-field">
              <span>New status</span>
              <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
                <option value="">Choose status...</option>
                {bulkStatusOptions.map((status) => (
                  <option key={status} value={status}>{formatFieldLabel(status)}</option>
                ))}
              </select>
            </label>
            <div className="bulk-status-actions">
              <button
                type="button"
                className="primary-btn"
                disabled={bulkBusy || !bulkStatus || selectedVehicleIds.length === 0 || selectedVehicleIds.length > 50}
                onClick={applyBulkStatus}
              >
                {bulkBusy ? "Updating..." : "Apply Status"}
              </button>
              <button
                type="button"
                className="secondary-btn"
                disabled={bulkBusy || selectedVehicleIds.length === 0}
                onClick={() => setSelectedVehicleIds([])}
              >
                Clear
              </button>
            </div>
            <small>Maximum 50 vehicles per batch. Invalid transitions are skipped and reported.</small>
          </div>
          <div className="kanban">
            {pipelineColumns.map((column) => {
              const columnVehicles = grouped[column] ?? [];
              const allColumnVehiclesSelected = columnVehicles.length > 0
                && columnVehicles.every((vehicle) => selectedVehicleIdSet.has(vehicle.id));

              return (
              <div key={column} className="kanban-column">
                <div className="kanban-header">
                  <label className="kanban-select-column">
                    <input
                      type="checkbox"
                      checked={allColumnVehiclesSelected}
                      disabled={columnVehicles.length === 0}
                      onChange={() => toggleColumn(columnVehicles)}
                      aria-label={`Select all vehicles in ${column}`}
                    />
                    <h3>{column}</h3>
                  </label>
                  <span>{grouped[column]?.length ?? 0}</span>
                </div>
                <div className="kanban-stack">
                  {columnVehicles.map((vehicle) => (
                    <div key={vehicle.id} className={`kanban-card-row ${selectedVehicleIdSet.has(vehicle.id) ? "selected" : ""}`}>
                      <label className="kanban-card-select">
                        <input
                          type="checkbox"
                          checked={selectedVehicleIdSet.has(vehicle.id)}
                          onChange={() => toggleVehicle(vehicle.id)}
                          aria-label={`Select ${formatStockNumber(vehicle.stock_number)}`}
                        />
                        <span className="sr-only">Select vehicle</span>
                      </label>
                      <button type="button" className="kanban-card" onClick={() => openVehicle(vehicle.id)}>
                        <strong>{formatStockNumber(vehicle.stock_number)}</strong>
                        <span className="kanban-card-model">{vehicle.make} {vehicle.model}</span>
                        <span className="kanban-card-meta">{vehicle.year} · {vehicle.color}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );})}
          </div>
        </section>
      ) : null}
    </>
  );
}

function DashboardListRow({
  vehicle,
  role,
  openVehicle,
  isOverdue,
  getVehicleTimeTone,
  getVehicleTimeLabel,
  getNextActionForRole,
  fmtDate,
  performAction,
  updateStatus,
  updateFlags,
  addVehicleComment,
  canEditDueDate,
  updateVehicleDueDate,
  emphasized = false,
  submittedView = false,
}) {
  const overdue = isOverdue(vehicle.due_date) && vehicle.status !== "ready";
  const nextAction = getNextActionForRole(vehicle, role);
  const inlineActions = vehicle.actions?.filter((action) => action.role === role) ?? [];
  const commentCount = vehicle.timeline?.filter((entry) => entry.field_changed === "comment").length ?? 0;
  const comments = vehicle.timeline?.filter((entry) => entry.field_changed === "comment") ?? [];
  const [showComments, setShowComments] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDueDate, setShowDueDate] = useState(false);
  const [dueDateValue, setDueDateValue] = useState(toDateTimeLocalValue(vehicle.due_date));

  useEffect(() => {
    setDueDateValue(toDateTimeLocalValue(vehicle.due_date));
  }, [vehicle.due_date]);

  async function runInlineAction(event) {
    const actionKey = event.target.value;
    if (!actionKey) return;
    setBusy(true);
    try {
      await performAction(vehicle.id, actionKey, updateStatus, updateFlags);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function submitInlineComment(event) {
    event.preventDefault();
    const value = comment.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await addVehicleComment(vehicle.id, value);
      setComment("");
    } finally {
      setBusy(false);
    }
  }

  async function saveInlineDueDate(event) {
    event.preventDefault();
    if (!dueDateValue || busy) return;
    setBusy(true);
    try {
      await updateVehicleDueDate(vehicle.id, dueDateValue);
      setShowDueDate(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`dashboard-row ${overdue ? "overdue" : ""} ${submittedView ? "" : "actionable"} ${emphasized ? "emphasized" : ""}`}>
      <div className="dashboard-row-button">
        <div className="vehicle-card-topline">
          <button type="button" className="vehicle-card-open" onClick={() => openVehicle(vehicle.id)}>
            <strong className="stock">{formatStockNumber(vehicle.stock_number)}</strong>
            <span className="vehicle-type-chip">Customer Delivery</span>
          </button>
          {inlineActions.length > 0 ? (
            <select className="vehicle-inline-action" defaultValue="" disabled={busy} onChange={runInlineAction} aria-label={`Update workflow for ${formatStockNumber(vehicle.stock_number)}`}>
              <option value="" disabled>{busy ? "Updating..." : nextAction?.label ?? "Next action"}</option>
              {inlineActions.map((action) => <option key={action.key} value={action.key}>{action.label}</option>)}
            </select>
          ) : <span className="vehicle-next-action">{formatCompactStatus(vehicle.status)}</span>}
        </div>

        <button type="button" className="vehicle-card-main" onClick={() => openVehicle(vehicle.id)}>
          <h4 className="vehicle-card-title">{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.color}</h4>
        </button>
        <span className="vehicle-card-status">Status: {formatCompactStatus(vehicle.status)}</span>

        <div className="vehicle-card-people">
          <div><span>Sales</span><strong>{vehicle.submitted_by?.name ?? "Unassigned"}</strong></div>
          <div><span>Assigned</span><strong>{vehicle.assigned_user?.name ?? formatCompactStatus(vehicle.assigned_role)}</strong></div>
        </div>

        <div className="vehicle-card-footer">
          <div>
            {canEditDueDate ? <button type="button" className="vehicle-due-button" onClick={() => setShowDueDate((current) => !current)}>{fmtDate(vehicle.due_date)}</button> : <span>{fmtDate(vehicle.due_date)}</span>}
            <strong className={`status-chip ${getVehicleTimeTone(vehicle)}`}>{getVehicleTimeLabel(vehicle)}</strong>
          </div>
          <button type="button" className={`vehicle-card-comments ${showComments ? "active" : ""}`} onClick={() => setShowComments((current) => !current)}>Comments {commentCount}</button>
          <button type="button" className={`vehicle-card-fuel ${vehicle.fueled ? "complete" : ""}`} disabled={busy} onClick={() => updateFlags(vehicle.id, { fueled: !vehicle.fueled })}><i />Gas: {vehicle.fueled ? "Yes" : "No"}</button>
        </div>

        {showDueDate ? (
          <form className="inline-due-editor" onSubmit={saveInlineDueDate}>
            <input type="datetime-local" value={dueDateValue} onChange={(event) => setDueDateValue(event.target.value)} />
            <button type="submit" disabled={busy || !dueDateValue}>Save</button>
          </form>
        ) : null}

        {showComments ? (
          <div className="inline-comments">
            <div className="inline-comment-list">
              {comments.length > 0 ? comments.map((entry) => (
                <div key={entry.id}><strong>{entry.user?.name ?? "Unknown"}</strong><p>{entry.new_value}</p></div>
              )) : <span>No comments yet.</span>}
            </div>
            <form onSubmit={submitInlineComment}>
              <input value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="Add a comment..." aria-label={`Comment on ${formatStockNumber(vehicle.stock_number)}`} />
              <button type="submit" disabled={busy || !comment.trim()} aria-label="Post comment">→</button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatCompactStatus(status) {
  return String(status || "pending").replaceAll("_", " ");
}
