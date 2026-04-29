import { useState } from "react";
import Flag from "../../components/ui/Flag";

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
  temporaryPassword,
  overdueActionVehicles,
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
  pipelineColumns,
  grouped
}) {
  const [expandedVehicleId, setExpandedVehicleId] = useState(null);

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
        {temporaryPassword ? <div className="temp-password-banner">{temporaryPassword}</div> : null}

        {overdueActionVehicles.length > 0 ? (
          <div className="action-section overdue-section">
            <div className="action-section-head">
              <div>
                <p className="eyebrow">Urgent</p>
                <h3>Overdue Units</h3>
              </div>
              <span className="pill overdue-pill">{overdueActionVehicles.length}</span>
            </div>
            <div className="dashboard-list">
              {overdueActionVehicles.map((vehicle) => (
                <DashboardListRow
                  key={`overdue-${vehicle.id}`}
                  vehicle={vehicle}
                  role={role}
                  isExpanded={expandedVehicleId === vehicle.id}
                  onToggle={() => setExpandedVehicleId((current) => current === vehicle.id ? null : vehicle.id)}
                  openVehicle={openVehicle}
                  isOverdue={isOverdue}
                  getVehicleTimeTone={getVehicleTimeTone}
                  getVehicleTimeLabel={getVehicleTimeLabel}
                  getNextActionForRole={getNextActionForRole}
                  fmtDate={fmtDate}
                  getWorkflowBadges={getWorkflowBadges}
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
                  <h3>{section.label}</h3>
                  <span className="pill">{section.items.length}</span>
                </div>
                <div className="dashboard-list">
                  {section.items.map((vehicle) => (
                    <DashboardListRow
                      key={vehicle.id}
                      vehicle={vehicle}
                      role={role}
                      isExpanded={expandedVehicleId === vehicle.id}
                      onToggle={() => setExpandedVehicleId((current) => current === vehicle.id ? null : vehicle.id)}
                      openVehicle={openVehicle}
                      isOverdue={isOverdue}
                      getVehicleTimeTone={getVehicleTimeTone}
                      getVehicleTimeLabel={getVehicleTimeLabel}
                      getNextActionForRole={getNextActionForRole}
                      fmtDate={fmtDate}
                      getWorkflowBadges={getWorkflowBadges}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : overdueActionVehicles.length === 0 && !showSalespersonSubmissionSection ? (
          <div className="empty-inline">No units are waiting on your role right now.</div>
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
                    isExpanded={expandedVehicleId === vehicle.id}
                    onToggle={() => setExpandedVehicleId((current) => current === vehicle.id ? null : vehicle.id)}
                    openVehicle={openVehicle}
                    isOverdue={isOverdue}
                    getVehicleTimeTone={getVehicleTimeTone}
                    getVehicleTimeLabel={getVehicleTimeLabel}
                    getNextActionForRole={getNextActionForRole}
                    fmtDate={fmtDate}
                    getWorkflowBadges={getWorkflowBadges}
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
          <div className="kanban">
            {pipelineColumns.map((column) => (
              <div key={column} className="kanban-column">
                <div className="kanban-header">
                  <h3>{column}</h3>
                  <span>{grouped[column]?.length ?? 0}</span>
                </div>
                <div className="kanban-stack">
                  {(grouped[column] ?? []).map((vehicle) => (
                    <button type="button" key={vehicle.id} className="kanban-card" onClick={() => openVehicle(vehicle.id)}>
                      <strong>{vehicle.stock_number}</strong>
                      <span>{vehicle.make} {vehicle.model}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function DashboardListRow({
  vehicle,
  role,
  isExpanded,
  onToggle,
  openVehicle,
  isOverdue,
  getVehicleTimeTone,
  getVehicleTimeLabel,
  getNextActionForRole,
  fmtDate,
  getWorkflowBadges,
  emphasized = false,
  submittedView = false
}) {
  const overdue = isOverdue(vehicle.due_date) && vehicle.status !== "ready";
  const nextAction = getNextActionForRole(vehicle, role);
  const visibleBadges = getWorkflowBadges(vehicle).slice(0, 3);

  return (
    <div className={`dashboard-row ${overdue ? "overdue" : ""} ${submittedView ? "" : "actionable"} ${emphasized ? "emphasized" : ""} ${isExpanded ? "expanded" : ""}`}>
      <button type="button" className="dashboard-row-summary" onClick={onToggle}>
        <div className="dashboard-row-main">
          <strong className="stock">{vehicle.stock_number}</strong>
          <div className="dashboard-row-copy">
            <span className="dashboard-row-title">{vehicle.year} {vehicle.make} {vehicle.model}</span>
            <span className="dashboard-row-subtitle">{formatCompactStatus(vehicle.status)} | {vehicle.current_location}</span>
          </div>
        </div>
        <div className="dashboard-row-meta">
          <span className={`status-chip ${getVehicleTimeTone(vehicle)}`}>{getVehicleTimeLabel(vehicle)}</span>
          <span className="dashboard-row-toggle" aria-hidden="true">{isExpanded ? "−" : "+"}</span>
        </div>
      </button>

      {isExpanded ? (
        <div className="dashboard-row-detail">
          {nextAction ? (
            <div className={`next-action-banner ${overdue ? "danger" : ""}`}>
              <span className="next-action-label">Next Action</span>
              <strong>{nextAction.label}</strong>
            </div>
          ) : null}

          <div className="dashboard-row-info">
            <span>Due {fmtDate(vehicle.due_date)}</span>
            <span>{vehicle.assigned_to_name || "Unassigned"}</span>
            <span>{vehicle.color}</span>
          </div>

          <div className="workflow-row">
            {visibleBadges.map((badge) => <Flag key={`${vehicle.id}-${badge.label}`} label={badge.label} tone={badge.tone} />)}
          </div>

          {role === "detailer" ? <div className={`time-left-chip ${getVehicleTimeTone(vehicle)}`}>{getVehicleTimeLabel(vehicle)}</div> : null}

          <div className="dashboard-row-actions">
            <button type="button" className="secondary-btn" onClick={() => openVehicle(vehicle.id)}>
              View Details
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatCompactStatus(status) {
  return String(status || "pending").replaceAll("_", " ");
}
