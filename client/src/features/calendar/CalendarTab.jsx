export default function CalendarTab({
  calendarVehicles,
  calendarView,
  setCalendarView,
  agendaSections,
  weekDays,
  openVehicle,
  getCalendarStatusTone,
  formatFieldLabel,
  fmtDate,
  getVehicleTimeTone,
  getVehicleTimeLabel
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2>Due Date Calendar</h2>
        </div>
        <span className="pill">{calendarVehicles.length}</span>
      </div>

      <div className="view-toggle compact">
        <button type="button" className={`tab-btn ${calendarView === "agenda" ? "active" : ""}`} onClick={() => setCalendarView("agenda")}>
          Agenda
        </button>
        <button type="button" className={`tab-btn ${calendarView === "week" ? "active" : ""}`} onClick={() => setCalendarView("week")}>
          7 Day
        </button>
      </div>

      {calendarView === "agenda" ? (
        <div className="calendar-agenda">
          {agendaSections.length > 0 ? agendaSections.map((section) => (
            <div key={section.dateKey} className="calendar-day-card">
              <div className="action-section-head">
                <h3>{section.label}</h3>
                <span className="pill">{section.items.length}</span>
              </div>
              <div className="calendar-entry-list">
                {section.items.map((vehicle) => (
                  <button type="button" key={`agenda-${vehicle.id}`} className={`calendar-entry ${getCalendarStatusTone(vehicle)}`} onClick={() => openVehicle(vehicle.id)}>
                    <div>
                      <strong>{vehicle.stock_number} | {vehicle.year} {vehicle.make} {vehicle.model}</strong>
                      <p>{vehicle.current_location} | {formatFieldLabel(vehicle.status)}</p>
                    </div>
                    <div className="calendar-entry-meta">
                      <span>{fmtDate(vehicle.due_date)}</span>
                      <span className={`status-chip ${getVehicleTimeTone(vehicle)}`}>{getVehicleTimeLabel(vehicle)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )) : <div className="empty-inline">No units match the current calendar filters.</div>}
        </div>
      ) : (
        <div className="calendar-week-grid">
          {weekDays.map((day) => (
            <div key={day.key} className="calendar-week-column">
              <div className="calendar-week-head">
                <h3>{day.label}</h3>
                <span>{day.items.length}</span>
              </div>
              <div className="calendar-entry-list">
                {day.items.length > 0 ? day.items.map((vehicle) => (
                  <button type="button" key={`week-${vehicle.id}`} className={`calendar-entry ${getCalendarStatusTone(vehicle)}`} onClick={() => openVehicle(vehicle.id)}>
                    <strong>{vehicle.stock_number}</strong>
                    <p>{vehicle.make} {vehicle.model}</p>
                    <span>{fmtDate(vehicle.due_date)}</span>
                  </button>
                )) : <div className="calendar-empty">No units</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
