export default function ReportsTab({ reportsOverview, loadReports }) {
  const summary = reportsOverview?.summary;
  const trend = reportsOverview?.trend ?? [];
  const byPipeline = reportsOverview?.byPipeline ?? [];
  const workloadByRole = reportsOverview?.workloadByRole ?? [];
  const focus = reportsOverview?.focus ?? [];
  const maxTrendValue = Math.max(1, ...trend.flatMap((day) => [day.submitted, day.completed]));
  const maxPipelineValue = Math.max(1, ...byPipeline.map((item) => item.count));
  const maxWorkloadValue = Math.max(1, ...workloadByRole.map((item) => item.count));

  return (
    <section className="panel reports-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>Operations Overview</h2>
        </div>
        <button type="button" className="secondary-btn" onClick={loadReports}>Refresh Report</button>
      </div>

      {!reportsOverview ? (
        <div className="empty-inline">Load the report to see volume, bottlenecks, team workload, and on-time performance.</div>
      ) : (
        <div className="reports-layout">
          <div className="reports-summary-grid">
            <MetricCard label="Active Units" value={summary.activeUnits} helper="Open units still moving through workflow" />
            <MetricCard label="Overdue Units" value={summary.overdueUnits} helper="Units past due and not yet ready" tone="danger" />
            <MetricCard label="Completed 7 Days" value={summary.completedLast7Days} helper="Units marked ready in the last week" />
            <MetricCard label="On-Time Rate" value={`${summary.onTimeRate30Days}%`} helper="Completed by due date in the last 30 days" />
            <MetricCard label="Avg Completion" value={`${summary.averageCompletionDays30Days}d`} helper="Average submit-to-ready time over the last 30 days" />
            <MetricCard label="Ready Units" value={summary.readyUnits} helper="Currently ready and still visible" />
          </div>

          <div className="reports-two-column">
            <div className="report-card">
              <div className="report-card-head">
                <h3>7 Day Trend</h3>
                <span className="pill">Submitted vs Completed</span>
              </div>
              <div className="report-trend-list">
                {trend.map((day) => (
                  <div key={day.date} className="report-trend-row">
                    <strong>{formatShortDate(day.date)}</strong>
                    <div className="report-trend-bars">
                      <div className="report-trend-bar report-trend-bar-submitted" style={{ width: `${(day.submitted / maxTrendValue) * 100}%` }}>
                        <span>{day.submitted}</span>
                      </div>
                      <div className="report-trend-bar report-trend-bar-completed" style={{ width: `${(day.completed / maxTrendValue) * 100}%` }}>
                        <span>{day.completed}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="report-card">
              <div className="report-card-head">
                <h3>Pipeline Bottlenecks</h3>
                <span className="pill">Current Open Units</span>
              </div>
              <div className="report-stat-list">
                {byPipeline.map((item) => (
                  <StatBar key={item.label} label={item.label} count={item.count} maxValue={maxPipelineValue} />
                ))}
              </div>
            </div>
          </div>

          <div className="reports-two-column">
            <div className="report-card">
              <div className="report-card-head">
                <h3>Team Workload</h3>
                <span className="pill">Assigned Roles</span>
              </div>
              <div className="report-stat-list">
                {workloadByRole.map((item) => (
                  <StatBar key={item.role} label={item.label} count={item.count} maxValue={maxWorkloadValue} />
                ))}
              </div>
            </div>

            <div className="report-card">
              <div className="report-card-head">
                <h3>Attention Areas</h3>
                <span className="pill">Open Work Flags</span>
              </div>
              <div className="report-focus-grid">
                {focus.map((item) => (
                  <div key={item.label} className="report-focus-chip">
                    <strong>{item.count}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MetricCard({ label, value, helper, tone = "default" }) {
  return (
    <div className={`report-metric-card report-metric-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

function StatBar({ label, count, maxValue }) {
  return (
    <div className="report-stat-row">
      <div className="report-stat-copy">
        <strong>{label}</strong>
        <span>{count}</span>
      </div>
      <div className="report-stat-track">
        <div className="report-stat-fill" style={{ width: `${(count / Math.max(1, maxValue)) * 100}%` }} />
      </div>
    </div>
  );
}

function formatShortDate(value) {
  return new Date(value).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}
