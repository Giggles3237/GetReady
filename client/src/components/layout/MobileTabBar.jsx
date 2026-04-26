export default function MobileTabBar({ canAccessAdmin, canAccessReports, activeTab, onSelectDashboard, onSelectCalendar, onSelectReports, onSelectAdmin }) {
  if (canAccessAdmin) {
    return (
      <div className="mobile-tabbar mobile-tabbar-four">
        <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={onSelectDashboard}>Dashboard</button>
        <button type="button" className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`} onClick={onSelectCalendar}>Calendar</button>
        <button type="button" className={`tab-btn ${activeTab === "reports" ? "active" : ""}`} onClick={onSelectReports}>Reports</button>
        <button type="button" className={`tab-btn ${activeTab === "admin" ? "active" : ""}`} onClick={onSelectAdmin}>Admin</button>
      </div>
    );
  }

  if (canAccessReports) {
    return (
      <div className="mobile-tabbar">
        <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={onSelectDashboard}>Dashboard</button>
        <button type="button" className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`} onClick={onSelectCalendar}>Calendar</button>
        <button type="button" className={`tab-btn ${activeTab === "reports" ? "active" : ""}`} onClick={onSelectReports}>Reports</button>
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
