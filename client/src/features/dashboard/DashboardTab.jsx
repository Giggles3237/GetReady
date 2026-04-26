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
          ) : <div />}

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
            <div className="vehicle-grid">
              {overdueActionVehicles.map((vehicle) => (
                <VehicleCard
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
                <div className="vehicle-grid">
                  {section.items.map((vehicle) => (
                    <VehicleCard
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
              <div className="vehicle-grid">
                {mySubmittedVehicles.map((vehicle) => (
                  <VehicleCard
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

function VehicleCard({
  vehicle,
  role,
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

  return (
    <button
      type="button"
      className={`vehicle-card ${overdue ? "overdue" : ""} ${submittedView ? "" : "actionable"} ${emphasized ? "emphasized" : ""}`}
      onClick={() => openVehicle(vehicle.id)}
    >
      <div className="vehicle-topline">
        <span className="stock">{vehicle.stock_number}</span>
        <span className={`status-chip ${getVehicleTimeTone(vehicle)}`}>{getVehicleTimeLabel(vehicle)}</span>
      </div>
      {nextAction ? (
        <div className={`next-action-banner ${overdue ? "danger" : ""}`}>
          <span className="next-action-label">Next Action</span>
          <strong>{nextAction.label}</strong>
        </div>
      ) : null}
      <div className="vehicle-highlight-row">
        <span className="vehicle-action-kicker">{formatCompactStatus(vehicle.status)}</span>
        <span className="vehicle-location-chip">{vehicle.current_location}</span>
      </div>
      <h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3>
      <p className="vehicle-color-copy">{vehicle.color}</p>
      <div className="meta-row">
        <span>Due {fmtDate(vehicle.due_date)}</span>
        <span>{vehicle.assigned_to_name || "Unassigned"}</span>
      </div>
      {role === "detailer" ? <div className={`time-left-chip ${getVehicleTimeTone(vehicle)}`}>{getVehicleTimeLabel(vehicle)}</div> : null}
      <div className="workflow-row">
        {getWorkflowBadges(vehicle).map((badge) => <Flag key={`${vehicle.id}-${badge.label}`} label={badge.label} tone={badge.tone} />)}
      </div>
    </button>
  );
}

function formatCompactStatus(status) {
  return String(status || "pending").replaceAll("_", " ");
}
