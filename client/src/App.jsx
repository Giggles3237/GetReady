import { useState } from "react";
import AuthScreen from "./components/auth/AuthScreen";
import PasswordChangeScreen from "./components/auth/PasswordChangeScreen";
import NoticeModal from "./components/ui/NoticeModal";
import MobileTabBar from "./components/layout/MobileTabBar";
import { pipelineColumns, roleOptions } from "./constants";
import AdminTab from "./features/admin/AdminTab";
import CalendarTab from "./features/calendar/CalendarTab";
import DashboardTab from "./features/dashboard/DashboardTab";
import ReportsTab from "./features/reports/ReportsTab";
import SubmissionModal from "./features/vehicles/SubmissionModal";
import VehicleDetailModal from "./features/vehicles/VehicleDetailModal";
import { useAppData } from "./hooks/useAppData";
import { useSession } from "./hooks/useSession";
import {
  fmtDate,
  formatFieldLabel,
  getBodyworkDisplayLabel,
  getCalendarStatusTone,
  getNextActionForRole,
  getSearchResultState,
  getServiceDisplayLabel,
  getVehicleTimeLabel,
  getVehicleTimeTone,
  getWorkflowBadges,
  isOverdue,
  performAction,
  toDateTimeLocalValue
} from "./utils/appHelpers";

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [adminSection, setAdminSection] = useState("steps");
  const {
    authReady,
    authUser,
    loginForm,
    setLoginForm,
    passwordForm,
    setPasswordForm,
    error: sessionError,
    handleLogin,
    handlePasswordChange,
    handleLogout
  } = useSession();

  const role = authUser?.role ?? "salesperson";
  const dashboardRole = role === "admin" ? "manager" : role;
  const canAccessReports = ["admin", "manager"].includes(role);
  const canAccessAdmin = role === "admin";

  const {
    setUsers,
    summary,
    selectedVehicle,
    setSelectedVehicle,
    showSubmissionModal,
    setShowSubmissionModal,
    search,
    setSearch,
    searchOpen,
    setSearchOpen,
    searchResults,
    salespersonView,
    setSalespersonView,
    calendarView,
    setCalendarView,
    showCompleted,
    setShowCompleted,
    archiveNotice,
    setArchiveNotice,
    showInactiveUsers,
    setShowInactiveUsers,
    expandedUserId,
    setExpandedUserId,
    dueDateEdit,
    setDueDateEdit,
    successMessage,
    setSuccessMessage,
    adminActions,
    setAdminActions,
    auditFeed,
    archivedVehicles,
    reportsOverview,
    temporaryPassword,
    newUser,
    setNewUser,
    submission,
    setSubmission,
    error: appError,
    setError,
    salespersonUsers,
    assignableUsers,
    visibleManagedUsers,
    hasManagerAccess,
    canEditDueDate,
    loadDashboard,
    openVehicle,
    updateStatus,
    updateFlags,
    updateVehicleDueDate,
    archiveVehicle,
    unarchiveVehicle,
    createVehicle,
    loadAdminData,
    loadReports,
    updateAdminAction,
    createAdminUser,
    updateAdminUser,
    resetAdminPassword,
    grouped,
    overdueActionVehicles,
    mySubmittedVehicles,
    calendarVehicles,
    agendaSections,
    weekDays,
    actionSections,
    availableActions,
    showSalespersonSubmissionSection,
    completionEntry,
    completedSteps,
    completionIndicators,
    resetAppState
  } = useAppData({ authUser, canAccessAdmin, dashboardRole, role });

  const error = sessionError || appError;

  if (!authReady) {
    return <div className="auth-shell"><section className="auth-card"><h1>Loading...</h1></section></div>;
  }

  if (!authUser) {
    return <AuthScreen loginForm={loginForm} setLoginForm={setLoginForm} onSubmit={handleLogin} error={error} />;
  }

  if (authUser.must_change_password) {
    return (
      <PasswordChangeScreen
        passwordForm={passwordForm}
        setPasswordForm={setPasswordForm}
        onSubmit={handlePasswordChange}
        error={error}
        user={authUser}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="top-menu">
        <div className="brand-bar">
          <span className="brand-mark">BMW</span>
          <span className="brand-title">Get Ready</span>
        </div>

        <div className="tab-row">
          <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            Dashboard
          </button>
          <button type="button" className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`} onClick={() => setActiveTab("calendar")}>
            Calendar
          </button>
          {canAccessReports ? (
            <button
              type="button"
              className={`tab-btn ${activeTab === "reports" ? "active" : ""}`}
              onClick={() => loadReports().then(() => setActiveTab("reports")).catch((err) => setError(err.message))}
            >
              Reports
            </button>
          ) : null}
          {canAccessAdmin ? (
            <button type="button" className={`tab-btn ${activeTab === "admin" ? "active" : ""}`} onClick={() => { setActiveTab("admin"); loadAdminData(); }}>
              Admin
            </button>
          ) : null}
        </div>

        <div className="top-actions">
          {summary ? (
            <div className="top-stats">
              <span>Action <strong>{summary.needsAction}</strong></span>
              <span>Overdue <strong>{summary.overdue}</strong></span>
              <span>Ready <strong>{summary.ready}</strong></span>
            </div>
          ) : null}
          <div className="session-meta-line">
            <strong>{authUser.name}</strong>
            <span>{roleOptions.find((option) => option.value === authUser.role)?.label}</span>
          </div>
          <button type="button" className="secondary-btn" onClick={() => loadDashboard().catch((err) => setError(err.message))}>
            Refresh
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              setSuccessMessage("");
              setError("");
              setSubmission((current) => ({
                ...current,
                submitted_by_user_id: hasManagerAccess ? (current.submitted_by_user_id || authUser.id) : authUser.id
              }));
              setShowSubmissionModal(true);
            }}
          >
            New Get Ready
          </button>
          <button type="button" className="secondary-btn signout-btn" onClick={() => handleLogout(resetAppState)}>Sign Out</button>
        </div>
      </header>

      <main className="workspace">
        <div className={`quick-search ${searchOpen ? "open" : ""}`}>
          <button
            type="button"
            className="search-icon-btn"
            aria-label="Search vehicles"
            onClick={() => setSearchOpen((current) => !current)}
          />
          {searchOpen ? (
            <div className="search-popover">
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search stock, model, color, notes..."
              />
              {search.trim() ? (
                <div className="search-results">
                  {searchResults.length > 0 ? searchResults.map((vehicle) => (
                    <button
                      type="button"
                      key={`search-${vehicle.id}`}
                      className="search-result"
                      onClick={() => {
                        setSearchOpen(false);
                        setSearch("");
                        openVehicle(vehicle.id).catch((err) => setError(err.message));
                      }}
                    >
                      <strong>{vehicle.stock_number}</strong>
                      <span>{vehicle.year} {vehicle.make} {vehicle.model} | {vehicle.color || "No color"}</span>
                      <small>
                        <b>{getSearchResultState(vehicle)}</b> | {formatFieldLabel(vehicle.status)} | Due {fmtDate(vehicle.due_date)}
                      </small>
                    </button>
                  )) : <div className="search-empty">No matches found.</div>}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {activeTab === "dashboard" ? (
          <DashboardTab
            roleOptions={roleOptions}
            dashboardRole={dashboardRole}
            authUser={authUser}
            role={role}
            salespersonView={salespersonView}
            setSalespersonView={setSalespersonView}
            showCompleted={showCompleted}
            setShowCompleted={setShowCompleted}
            error={error}
            successMessage={successMessage}
            temporaryPassword={temporaryPassword}
            overdueActionVehicles={overdueActionVehicles}
            actionSections={actionSections}
            showSalespersonSubmissionSection={showSalespersonSubmissionSection}
            mySubmittedVehicles={mySubmittedVehicles}
            openVehicle={(vehicleId) => openVehicle(vehicleId).catch((err) => setError(err.message))}
            isOverdue={isOverdue}
            getVehicleTimeTone={getVehicleTimeTone}
            getVehicleTimeLabel={getVehicleTimeLabel}
            getNextActionForRole={getNextActionForRole}
            fmtDate={fmtDate}
            getWorkflowBadges={getWorkflowBadges}
            hasManagerAccess={hasManagerAccess}
            pipelineColumns={pipelineColumns}
            grouped={grouped}
          />
        ) : activeTab === "calendar" ? (
          <CalendarTab
            calendarVehicles={calendarVehicles}
            calendarView={calendarView}
            setCalendarView={setCalendarView}
            agendaSections={agendaSections}
            weekDays={weekDays}
            openVehicle={(vehicleId) => openVehicle(vehicleId).catch((err) => setError(err.message))}
            getCalendarStatusTone={getCalendarStatusTone}
            formatFieldLabel={formatFieldLabel}
            fmtDate={fmtDate}
            getVehicleTimeTone={getVehicleTimeTone}
            getVehicleTimeLabel={getVehicleTimeLabel}
          />
        ) : activeTab === "reports" ? (
          <ReportsTab
            reportsOverview={reportsOverview}
            loadReports={() => loadReports().catch((err) => setError(err.message))}
          />
        ) : (
          <AdminTab
            loadAdminData={() => loadAdminData().catch((err) => setError(err.message))}
            temporaryPassword={temporaryPassword}
            adminSection={adminSection}
            setAdminSection={setAdminSection}
            adminActions={adminActions}
            updateAdminAction={(actionKey, changes) => updateAdminAction(actionKey, changes).catch((err) => setError(err.message))}
            setAdminActions={setAdminActions}
            roleOptions={roleOptions}
            showInactiveUsers={showInactiveUsers}
            setShowInactiveUsers={setShowInactiveUsers}
            createAdminUser={(event) => createAdminUser(event).catch((err) => setError(err.message))}
            newUser={newUser}
            setNewUser={setNewUser}
            visibleManagedUsers={visibleManagedUsers}
            expandedUserId={expandedUserId}
            setExpandedUserId={setExpandedUserId}
            setUsers={setUsers}
            updateAdminUser={(targetUserId, changes) => updateAdminUser(targetUserId, changes).catch((err) => setError(err.message))}
            resetAdminPassword={(targetUserId, email) => resetAdminPassword(targetUserId, email).catch((err) => setError(err.message))}
            fmtDate={fmtDate}
            archivedVehicles={archivedVehicles}
            openVehicle={(vehicleId) => openVehicle(vehicleId).catch((err) => setError(err.message))}
            unarchiveVehicle={(vehicleId) => unarchiveVehicle(vehicleId).catch((err) => setError(err.message))}
            auditFeed={auditFeed}
          />
        )}
      </main>

      <MobileTabBar
        canAccessAdmin={canAccessAdmin}
        canAccessReports={canAccessReports}
        activeTab={activeTab}
        onSelectDashboard={() => setActiveTab("dashboard")}
        onSelectCalendar={() => setActiveTab("calendar")}
        onSelectReports={() => loadReports().then(() => setActiveTab("reports")).catch((err) => setError(err.message))}
        onSelectAdmin={() => { setActiveTab("admin"); loadAdminData().catch((err) => setError(err.message)); }}
      />

      <SubmissionModal
        isOpen={showSubmissionModal}
        onClose={() => setShowSubmissionModal(false)}
        createVehicle={(event) => createVehicle(event).catch((err) => {
          setSuccessMessage("");
          setError(err.message);
        })}
        hasManagerAccess={hasManagerAccess}
        submission={submission}
        setSubmission={setSubmission}
        authUser={authUser}
        salespersonUsers={salespersonUsers}
        assignableUsers={assignableUsers}
        roleOptions={roleOptions}
      />

      <VehicleDetailModal
        selectedVehicle={selectedVehicle}
        onClose={() => setSelectedVehicle(null)}
        completionEntry={completionEntry}
        fmtDate={fmtDate}
        formatFieldLabel={formatFieldLabel}
        canEditDueDate={canEditDueDate}
        dueDateEdit={dueDateEdit}
        setDueDateEdit={setDueDateEdit}
        updateVehicleDueDate={(vehicleId) => updateVehicleDueDate(vehicleId).catch((err) => setError(err.message))}
        toDateTimeLocalValue={toDateTimeLocalValue}
        getServiceDisplayLabel={getServiceDisplayLabel}
        getBodyworkDisplayLabel={getBodyworkDisplayLabel}
        completionIndicators={completionIndicators}
        hasManagerAccess={hasManagerAccess}
        canAccessAdmin={canAccessAdmin}
        unarchiveVehicle={(vehicleId) => unarchiveVehicle(vehicleId).catch((err) => setError(err.message))}
        archiveVehicle={(vehicleId) => archiveVehicle(vehicleId).catch((err) => setError(err.message))}
        availableActions={availableActions}
        performAction={performAction}
        updateStatus={(vehicleId, status) => updateStatus(vehicleId, status).catch((err) => setError(err.message))}
        updateFlags={(vehicleId, changes) => updateFlags(vehicleId, changes).catch((err) => setError(err.message))}
        completedSteps={completedSteps}
      />

      <NoticeModal notice={archiveNotice} onClose={() => setArchiveNotice(null)} />
    </div>
  );
}
