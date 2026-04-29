import { getAuditEntryDisplay } from "../../utils/appHelpers";

export default function AdminTab({
  loadAdminData,
  temporaryPassword,
  adminSection,
  setAdminSection,
  adminActions,
  updateAdminAction,
  setAdminActions,
  roleOptions,
  showInactiveUsers,
  setShowInactiveUsers,
  createAdminUser,
  newUser,
  setNewUser,
  visibleManagedUsers,
  expandedUserId,
  setExpandedUserId,
  setUsers,
  updateAdminUser,
  resetAdminPassword,
  fmtDate,
  archivedVehicles,
  openVehicle,
  unarchiveVehicle,
  auditFeed
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Administration</h2>
        </div>
        <button type="button" className="secondary-btn" onClick={loadAdminData}>Refresh Admin Data</button>
      </div>

      {temporaryPassword ? <div className="temp-password-banner">{temporaryPassword}</div> : null}

      <div className="admin-nav">
        <button type="button" className={`tab-btn ${adminSection === "users" ? "active" : ""}`} onClick={() => setAdminSection("users")}>Users</button>
        <button type="button" className={`tab-btn ${adminSection === "archived" ? "active" : ""}`} onClick={() => setAdminSection("archived")}>Archived Units</button>
        <button type="button" className={`tab-btn ${adminSection === "audit" ? "active" : ""}`} onClick={() => setAdminSection("audit")}>Audit</button>
        <button type="button" className={`tab-btn ${adminSection === "steps" ? "active" : ""}`} onClick={() => setAdminSection("steps")}>Step Labels</button>
      </div>

      {adminSection === "steps" ? (
        <div className="admin-list">
          {adminActions.map((action) => (
            <div key={action.key} className="admin-card">
              <div className="admin-card-head">
                <strong>{action.key}</strong>
                <label className="toggle-line">
                  <input type="checkbox" checked={action.enabled} onChange={(event) => updateAdminAction(action.key, { enabled: event.target.checked })} />
                  Enabled
                </label>
              </div>
              <label>
                Action Label
                <input
                  value={action.label}
                  onChange={(event) => setAdminActions((current) => current.map((item) => item.key === action.key ? { ...item, label: event.target.value } : item))}
                  onBlur={(event) => updateAdminAction(action.key, { label: event.target.value })}
                />
              </label>
              <label>
                Assigned Role
                <select value={action.role} onChange={(event) => updateAdminAction(action.key, { role: event.target.value })}>
                  {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <p className="admin-meta">Type: {action.type}</p>
            </div>
          ))}
        </div>
      ) : null}

      {adminSection === "users" ? (
        <div className="admin-list">
          <div className="admin-filter-row">
            <button type="button" className={`tab-btn ${!showInactiveUsers ? "active" : ""}`} onClick={() => setShowInactiveUsers(false)}>
              Active Users
            </button>
            <button type="button" className={`tab-btn ${showInactiveUsers ? "active" : ""}`} onClick={() => setShowInactiveUsers(true)}>
              Show Inactive
            </button>
          </div>

          <form className="admin-card" onSubmit={createAdminUser}>
            <div className="admin-card-head">
              <strong>Add User</strong>
            </div>
            <label>
              Name
              <input value={newUser.name} onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label>
              Email
              <input type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} required />
            </label>
            <label>
              Role
              <select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value }))}>
                {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button className="primary-btn" type="submit">Create User</button>
          </form>

          <div className="user-list">
            <div className="user-list-head">
              <span>Name</span>
              <span>Title</span>
              <span>Status</span>
            </div>
            {visibleManagedUsers.map((managedUser) => (
              <div key={managedUser.id} className={`user-record ${managedUser.is_active ? "" : "inactive-user"}`}>
                <button type="button" className="user-row" onClick={() => setExpandedUserId((current) => current === managedUser.id ? null : managedUser.id)}>
                  <strong>{managedUser.name}</strong>
                  <span>{roleOptions.find((option) => option.value === managedUser.role)?.label}</span>
                  <label className="toggle-line user-toggle" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={managedUser.is_active}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setUsers((current) => current.map((item) => item.id === managedUser.id ? { ...item, is_active: checked } : item));
                        updateAdminUser(managedUser.id, { is_active: checked });
                      }}
                    />
                    {managedUser.is_active ? "Active" : "Inactive"}
                  </label>
                </button>

                {expandedUserId === managedUser.id ? (
                  <div className="user-detail-row">
                    <div className="user-detail-copy">
                      <p><strong>Email:</strong> {managedUser.email}</p>
                      <p><strong>Created:</strong> {fmtDate(managedUser.created_at)}</p>
                      <p><strong>Last Updated:</strong> {fmtDate(managedUser.updated_at)}</p>
                    </div>
                    <div className="admin-inline-actions">
                      <button type="button" className="secondary-btn" onClick={() => resetAdminPassword(managedUser.id, managedUser.email)}>
                        Reset Password
                      </button>
                      <select
                        value={managedUser.role}
                        onChange={(event) => {
                          const roleValue = event.target.value;
                          setUsers((current) => current.map((item) => item.id === managedUser.id ? { ...item, role: roleValue } : item));
                          updateAdminUser(managedUser.id, { role: roleValue });
                        }}
                      >
                        {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {adminSection === "archived" ? (
        <div className="admin-list">
          {archivedVehicles.length > 0 ? archivedVehicles.map((vehicle) => (
            <div key={vehicle.id} className="admin-card inactive-user">
              <div className="admin-card-head">
                <div>
                  <strong>{vehicle.stock_number} | {vehicle.year} {vehicle.make} {vehicle.model}</strong>
                  <p className="admin-meta">{vehicle.current_location} | Archived</p>
                </div>
                <div className="admin-inline-actions">
                  <button type="button" className="secondary-btn" onClick={() => openVehicle(vehicle.id)}>View</button>
                  <button type="button" className="primary-btn" onClick={() => unarchiveVehicle(vehicle.id)}>Unarchive</button>
                </div>
              </div>
            </div>
          )) : <div className="empty-inline">No archived vehicles found.</div>}
        </div>
      ) : null}

      {adminSection === "audit" ? (
        <div className="audit-feed">
          {auditFeed.map((entry) => {
            const display = getAuditEntryDisplay(entry);
            return (
              <div key={entry.id} className="audit-row">
                <strong>{display.title}</strong>
                <span>{fmtDate(entry.created_at)}</span>
                <span>{entry.user?.name ?? "Unknown User"} | {entry.vehicle?.stock_number ?? "System"}</span>
                {display.detail ? <p>{display.detail}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
