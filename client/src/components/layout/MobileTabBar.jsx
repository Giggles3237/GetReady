export default function MobileTabBar({
  canAccessAdmin,
  canAccessReports,
  canAccessSpreadsheet,
  activeTab,
  onSelectDashboard,
  onSelectCalendar,
  onSelectReports,
  onSelectSpreadsheet,
  onSelectAdmin
}) {
  if (canAccessAdmin) {
    return (
      <div className="mobile-tabbar mobile-tabbar-five">
        <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={onSelectDashboard}>Dashboard</button>
        <button type="button" className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`} onClick={onSelectCalendar}>Calendar</button>
        <button type="button" className={`tab-btn ${activeTab === "reports" ? "active" : ""}`} onClick={onSelectReports}>Reports</button>
        <button type="button" className={`tab-btn ${activeTab === "spreadsheet" ? "active" : ""}`} onClick={onSelectSpreadsheet}>Sheet</button>
        <button type="button" className={`tab-btn ${activeTab === "admin" ? "active" : ""}`} onClick={onSelectAdmin}>Admin</button>
      </div>
    );
  }

  if (canAccessReports || canAccessSpreadsheet) {
    return (
      <div className="mobile-tabbar mobile-tabbar-four">
        <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={onSelectDashboard}>Dashboard</button>
        <button type="button" className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`} onClick={onSelectCalendar}>Calendar</button>
        {canAccessReports ? <button type="button" className={`tab-btn ${activeTab === "reports" ? "active" : ""}`} onClick={onSelectReports}>Reports</button> : null}
        {canAccessSpreadsheet ? <button type="button" className={`tab-btn ${activeTab === "spreadsheet" ? "active" : ""}`} onClick={onSelectSpreadsheet}>Sheet</button> : null}
      </div>
    );
  }

  return (
    <div className="mobile-tabbar mobile-tabbar-two">
      <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={onSelectDashboard}>Dashboard</button>
      <button type="button" className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`} onClick={onSelectCalendar}>Calendar</button>
    </div>
  );
}
