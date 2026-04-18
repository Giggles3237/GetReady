import { useEffect, useMemo, useState } from "react";

const API_URL = "http://localhost:4000/api";

const roleOptions = [
  { value: "salesperson", label: "Salesperson" },
  { value: "manager", label: "Manager" },
  { value: "bmw_genius", label: "BMW Genius" },
  { value: "detailer", label: "Detailer" },
  { value: "service_advisor", label: "Service Advisor" }
];

const pipelineColumns = ["Submitted", "At Detail", "In Detail", "Service", "QC", "Ready"];
const statusSequence = [
  { key: "to_detail", label: "Take Car To Detail", kind: "status" },
  { key: "detail_started", label: "Detail Started", kind: "status" },
  { key: "detail_finished", label: "Detail Finished", kind: "status" },
  { key: "removed_from_detail", label: "Bring Car Up From Detail", kind: "status" },
  { key: "toggle_fueled", label: "Fuel The Car", kind: "flag", field: "fueled" },
  { key: "toggle_recall", label: "Recalls Checked", kind: "flag", field: "recall_checked" },
  { key: "open_recall", label: "OPEN RECALL", kind: "flag", field: "recall_open", manual: true },
  { key: "complete_recall", label: "Recall Completed", kind: "flag", field: "recall_completed" },
  { key: "start_service", label: "Service Started", kind: "flag", field: "service_status", doneValue: "in_progress" },
  { key: "complete_service", label: "Service Complete", kind: "flag", field: "service_status", doneValue: "completed" },
  { key: "start_bodywork", label: "Body Work Started", kind: "flag", field: "bodywork_status", doneValue: "in_progress" },
  { key: "complete_bodywork", label: "Body Work Complete", kind: "flag", field: "bodywork_status", doneValue: "completed" },
  { key: "complete_qc", label: "QC Complete", kind: "flag", field: "qc_completed" },
  { key: "ready", label: "Ready", kind: "status" }
];

const statusProgressOrder = {
  submitted: 1,
  to_detail: 2,
  detail_started: 3,
  detail_finished: 4,
  removed_from_detail: 5,
  service: 6,
  qc: 7,
  ready: 8
};

function fmtDate(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getTimeLeftLabel(value) {
  const diffMs = new Date(value).getTime() - Date.now();
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const totalMinutes = Math.round(absMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return overdue ? `Overdue by ${parts.join(" ")}` : `${parts.join(" ")} left`;
}

function getTimeLeftTone(value) {
  const diffMs = new Date(value).getTime() - Date.now();
  if (diffMs < 0) return "danger";
  if (diffMs <= 1000 * 60 * 60 * 2) return "danger";
  if (diffMs <= 1000 * 60 * 60 * 8) return "warn";
  return "normal";
}

function isOverdue(value) {
  return new Date(value).getTime() < Date.now();
}

function getDueSortValue(vehicle) {
  return new Date(vehicle.due_date).getTime();
}

function getNextActionForRole(vehicle, role) {
  return vehicle.actions.find((action) => action.role === role) ?? null;
}

function getRoleActionPriority(role, actionKey) {
  if (role === "bmw_genius") {
    if (actionKey === "to_detail") return 1;
    if (actionKey === "removed_from_detail") return 2;
    if (actionKey === "toggle_fueled") return 3;
  }

  return 99;
}

function canUndoCompletedField(role, field, value) {
  if (role === "manager") {
    return true;
  }

  if (["recall_checked", "fueled", "qc_completed"].includes(field) && value === true) {
    return false;
  }

  return true;
}

function formatFieldLabel(value) {
  return value.replaceAll("_", " ");
}

function getStepState(vehicle, step) {
  if (step.key === "open_recall") {
    return {
      completed: vehicle.recall_open === true || vehicle.recall_completed === true,
      available: vehicle.recall_checked === true && !vehicle.recall_open && !vehicle.recall_completed
    };
  }

  if (step.kind === "status") {
    const currentIndex = statusProgressOrder[vehicle.status] ?? 0;
    const stepIndex = statusProgressOrder[step.key] ?? 0;
    const available = vehicle.actions.some((action) => action.key === step.key);
    const completed = vehicle.status === step.key || currentIndex > stepIndex;
    return { completed, available };
  }

  if (step.field === "fueled" || step.field === "recall_checked" || step.field === "qc_completed") {
    return {
      completed: vehicle[step.field] === true,
      available: vehicle.actions.some((action) => action.key === step.key)
    };
  }

  if (step.field === "service_status" || step.field === "bodywork_status") {
    return {
      completed: vehicle[step.field] === step.doneValue,
      available: vehicle.actions.some((action) => action.key === step.key)
    };
  }

  return { completed: false, available: false };
}

function getLatestChangeForStep(vehicle, step) {
  const timeline = vehicle.timeline ?? [];

  if (step.kind === "status") {
    return timeline.find((entry) => entry.field_changed === "status" && entry.new_value === step.key);
  }

  if (step.field === "service_status" || step.field === "bodywork_status") {
    return timeline.find((entry) => entry.field_changed === step.field && entry.new_value === step.doneValue);
  }

  return timeline.find((entry) => entry.field_changed === step.field && entry.new_value === "true");
}

function getServiceDisplayLabel(vehicle) {
  if (!vehicle.needs_service) {
    return "";
  }

  if (vehicle.service_status === "completed") {
    return "Service Complete";
  }

  if (vehicle.service_status === "in_progress") {
    return "Service Started";
  }

  return "Needs Service";
}

function getBodyworkDisplayLabel(vehicle) {
  if (!vehicle.needs_bodywork) {
    return "";
  }

  if (vehicle.bodywork_status === "completed") {
    return "Body Work Complete";
  }

  if (vehicle.bodywork_status === "in_progress") {
    return "Body Work Started";
  }

  return "Needs Body Work";
}

function getDetailDisplayLabel(vehicle) {
  if (["submitted", "to_detail"].includes(vehicle.status)) {
    return "Needs Detail";
  }

  if (vehicle.status === "detail_started") {
    return "Detail Started";
  }

  if (statusProgressOrder[vehicle.status] >= statusProgressOrder.detail_finished) {
    return "Detail Done";
  }

  return "Needs Detail";
}

function getFuelDisplayLabel(vehicle) {
  return vehicle.fueled ? "Fueled" : "Needs Fuel";
}

function getWorkflowBadges(vehicle) {
  const badges = [
    getDetailDisplayLabel(vehicle),
    getFuelDisplayLabel(vehicle)
  ];

  if (vehicle.recall_completed) {
    badges.push("Recall Completed");
  } else if (vehicle.recall_open) {
    badges.push("OPEN RECALL");
  } else if (vehicle.recall_checked) {
    badges.push("Recalls Checked");
  } else {
    badges.push("Recalls Need Checked");
  }

  if (vehicle.needs_service) {
    badges.push(getServiceDisplayLabel(vehicle).replace("Complete", "Done"));
  }

  if (vehicle.needs_bodywork) {
    badges.push(getBodyworkDisplayLabel(vehicle).replace("Complete", "Done"));
  }

  return badges;
}

function groupVehiclesByAction(vehicles, role) {
  const grouped = new Map();

  vehicles.forEach((vehicle) => {
    const action = getNextActionForRole(vehicle, role);
    if (!action) {
      return;
    }

    const key = action.label;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(vehicle);
  });

  return Array.from(grouped.entries()).map(([label, items]) => ({ label, items }));
}

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(data.message || "Request failed.");
  }

  return response.json();
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [adminSection, setAdminSection] = useState("steps");
  const [role, setRole] = useState("manager");
  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [summary, setSummary] = useState(null);
  const [calendarItems, setCalendarItems] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [adminActions, setAdminActions] = useState([]);
  const [auditFeed, setAuditFeed] = useState([]);
  const [newUser, setNewUser] = useState({ name: "", role: "salesperson" });
  const [submission, setSubmission] = useState({
    stock_number: "",
    year: "",
    make: "BMW",
    model: "",
    color: "",
    due_date: "",
    needs_service: false,
    needs_bodywork: false,
    service_notes: "",
    bodywork_notes: "",
    qc_required: false,
    notes: ""
  });

  const activeUser = useMemo(() => users.find((user) => user.role === role) ?? users[0] ?? null, [users, role]);

  async function loadDashboard(nextRole = role, nextSearch = search) {
    try {
      setError("");
      const userData = await request("/users");
      const scopedUser = userData.users.find((user) => user.role === nextRole) ?? userData.users[0] ?? null;
      const scopedUserId = scopedUser?.id ? `&userId=${encodeURIComponent(scopedUser.id)}` : "";
      const [vehicleData, summaryData, calendarData] = await Promise.all([
        request(`/vehicles?role=${nextRole}&search=${encodeURIComponent(nextSearch)}${scopedUserId}`),
        request(`/dashboard/summary?role=${nextRole}`),
        request("/dashboard/calendar")
      ]);

      setUsers(userData.users);
      setVehicles(vehicleData.vehicles);
      setSummary(summaryData.summary);
      setCalendarItems(calendarData.items);

      if (selectedVehicle) {
        const refreshed = vehicleData.vehicles.find((vehicle) => vehicle.id === selectedVehicle.id);
        if (refreshed) {
          await openVehicle(refreshed.id);
        } else {
          setSelectedVehicle(null);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    loadDashboard(role, search);
  }, [role]);

  async function openVehicle(vehicleId) {
    try {
      const userIdQuery = activeUser?.id ? `?userId=${encodeURIComponent(activeUser.id)}` : "";
      const data = await request(`/vehicles/${vehicleId}${userIdQuery}`);
      setSelectedVehicle(data.vehicle);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateStatus(vehicleId, status) {
    if (!activeUser) return;
    try {
      await request(`/vehicles/${vehicleId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, userId: activeUser.id })
      });
      await loadDashboard();
      await openVehicle(vehicleId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateFlags(vehicleId, changes) {
    if (!activeUser) return;
    try {
      await request(`/vehicles/${vehicleId}/flags`, {
        method: "PATCH",
        body: JSON.stringify({ ...changes, userId: activeUser.id })
      });
      await loadDashboard();
      await openVehicle(vehicleId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createVehicle(event) {
    event.preventDefault();
    if (!activeUser) return;

    try {
      await request("/vehicles", {
        method: "POST",
        body: JSON.stringify({
          ...submission,
          year: Number(submission.year),
          submitted_by_user_id: activeUser.id,
          due_date: new Date(submission.due_date).toISOString()
        })
      });

      setSubmission({
        stock_number: "",
        year: "",
        make: "BMW",
        model: "",
        color: "",
        due_date: "",
        needs_service: false,
        needs_bodywork: false,
        service_notes: "",
        bodywork_notes: "",
        qc_required: false,
        notes: ""
      });
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadAdminData() {
    try {
      setError("");
      const [actionData, auditData] = await Promise.all([
        request("/admin/actions"),
        request("/admin/audit?limit=150")
      ]);

      setAdminActions(actionData.actions);
      setAuditFeed(auditData.audit);
      setUsers((current) => current.length > 0 ? current : []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAdminAction(actionKey, changes) {
    if (!activeUser) return;
    try {
      const data = await request(`/admin/actions/${actionKey}`, {
        method: "PATCH",
        body: JSON.stringify({ ...changes, userId: activeUser.id })
      });
      setAdminActions(data.actions);
      await loadAdminData();
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createAdminUser(event) {
    event.preventDefault();
    if (!activeUser) return;

    try {
      const data = await request("/admin/users", {
        method: "POST",
        body: JSON.stringify({ ...newUser, userId: activeUser.id })
      });
      setUsers(data.users);
      setNewUser({ name: "", role: "salesperson" });
      await loadAdminData();
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAdminUser(targetUserId, changes) {
    if (!activeUser) return;

    try {
      const data = await request(`/admin/users/${targetUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...changes, userId: activeUser.id })
      });
      setUsers(data.users);
      await loadAdminData();
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  const grouped = useMemo(() => {
    const map = Object.fromEntries(pipelineColumns.map((column) => [column, []]));
    vehicles.forEach((vehicle) => {
      map[vehicle.pipeline ?? "Submitted"].push(vehicle);
    });
    return map;
  }, [vehicles]);

  const prioritizedVehicles = useMemo(() => {
    return [...vehicles].sort((left, right) => {
      const leftAction = getNextActionForRole(left, role);
      const rightAction = getNextActionForRole(right, role);

      if (leftAction && !rightAction) return -1;
      if (!leftAction && rightAction) return 1;

      if (leftAction && rightAction) {
        const actionPriorityDelta =
          getRoleActionPriority(role, leftAction.key) - getRoleActionPriority(role, rightAction.key);
        if (actionPriorityDelta !== 0) {
          return actionPriorityDelta;
        }
      }

      const overdueDelta = Number(isOverdue(left.due_date)) - Number(isOverdue(right.due_date));
      if (overdueDelta !== 0) {
        return overdueDelta * -1;
      }

      return getDueSortValue(left) - getDueSortValue(right);
    });
  }, [vehicles, role]);

  const nextUpVehicles = useMemo(() => {
    return prioritizedVehicles.filter((vehicle) => getNextActionForRole(vehicle, role));
  }, [prioritizedVehicles, role]);

  const actionSections = useMemo(() => {
    return groupVehiclesByAction(nextUpVehicles, role);
  }, [nextUpVehicles, role]);

  const roleSpecificActions = useMemo(() => {
    if (!selectedVehicle) {
      return [];
    }

    return selectedVehicle.actions.filter((action) => action.role === role);
  }, [selectedVehicle, role]);

  return (
    <div className="app-shell">
      <aside className="hero-panel">
        <p className="eyebrow">Chris Lasko</p>
        <h1>Get Ready Tracking System</h1>
        <p className="lead">
          A real-time command center for moving dealership units from submission to front-line ready with clear ownership,
          fast handoffs, and full audit accountability.
        </p>

        <div className="tab-row">
          <button className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            Dashboard
          </button>
          <button
            className={`tab-btn ${activeTab === "admin" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("admin");
              loadAdminData();
            }}
          >
            Admin
          </button>
        </div>

        <div className="control-card">
          <label>
            Role View
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  loadDashboard(role, event.currentTarget.value);
                }
              }}
              placeholder="Stock #, make, model, color..."
            />
          </label>

          <button className="secondary-btn" onClick={() => loadDashboard(role, search)}>
            Refresh Dashboard
          </button>
        </div>

        <form className="control-card" onSubmit={createVehicle}>
          <div className="section-heading">
            <h2>New Submission</h2>
          </div>
          <label>
            Stock Number
            <input value={submission.stock_number} onChange={(event) => setSubmission((current) => ({ ...current, stock_number: event.target.value }))} required />
          </label>
          <label>
            Year
            <input type="number" value={submission.year} onChange={(event) => setSubmission((current) => ({ ...current, year: event.target.value }))} required />
          </label>
          <label>
            Model
            <input value={submission.model} onChange={(event) => setSubmission((current) => ({ ...current, model: event.target.value }))} required />
          </label>
          <label>
            Color
            <input value={submission.color} onChange={(event) => setSubmission((current) => ({ ...current, color: event.target.value }))} />
          </label>
          <label>
            Due Date
            <input type="datetime-local" value={submission.due_date} onChange={(event) => setSubmission((current) => ({ ...current, due_date: event.target.value }))} required />
          </label>
          <label><input type="checkbox" checked={submission.needs_service} onChange={(event) => setSubmission((current) => ({ ...current, needs_service: event.target.checked }))} /> Needs Service</label>
          {submission.needs_service ? (
            <label>
              Service Notes
              <input value={submission.service_notes} onChange={(event) => setSubmission((current) => ({ ...current, service_notes: event.target.value }))} placeholder="Enter service notes..." />
            </label>
          ) : null}
          <label><input type="checkbox" checked={submission.needs_bodywork} onChange={(event) => setSubmission((current) => ({ ...current, needs_bodywork: event.target.checked }))} /> Needs Body Work</label>
          {submission.needs_bodywork ? (
            <label>
              Body Work Notes
              <input value={submission.bodywork_notes} onChange={(event) => setSubmission((current) => ({ ...current, bodywork_notes: event.target.value }))} placeholder="Enter body work notes..." />
            </label>
          ) : null}
          <label><input type="checkbox" checked={submission.qc_required} onChange={(event) => setSubmission((current) => ({ ...current, qc_required: event.target.checked }))} /> QC Required</label>
          <label>
            Notes
            <input value={submission.notes} onChange={(event) => setSubmission((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <button className="primary-btn" type="submit">Submit Unit</button>
        </form>

        {summary && (
          <div className="summary-grid">
            <StatCard label="Needs My Action" value={summary.needsAction} />
            <StatCard label="Overdue" value={summary.overdue} danger />
            <StatCard label="Ready" value={summary.ready} />
            <StatCard label="Total Units" value={summary.total} />
          </div>
        )}

        <div className="calendar-card">
          <div className="section-heading">
            <h2>Due Dates</h2>
          </div>
          <div className="calendar-list">
            {calendarItems.map((item) => (
              <button key={item.id} className={`calendar-item ${item.overdue ? "danger" : ""}`} onClick={() => openVehicle(item.id)}>
                <span>{item.title}</span>
                <strong>{fmtDate(item.due_date)}</strong>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="workspace">
        {activeTab === "dashboard" ? (
        <>
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Role Dashboard</p>
              <h2>{roleOptions.find((option) => option.value === role)?.label} Next Actions</h2>
            </div>
            <span className="pill">{activeUser ? activeUser.name : "Unassigned"}</span>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

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
                      <button key={vehicle.id} className={`vehicle-card ${isOverdue(vehicle.due_date) && vehicle.status !== "ready" ? "overdue" : ""} actionable`} onClick={() => openVehicle(vehicle.id)}>
                        <div className="vehicle-topline">
                          <span className="stock">{vehicle.stock_number}</span>
                          <span className={`status-chip ${getTimeLeftTone(vehicle.due_date)}`}>
                            {getTimeLeftLabel(vehicle.due_date)}
                          </span>
                        </div>
                        <h3>
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </h3>
                        <p>{vehicle.color}</p>
                        <div className="meta-row">
                          <span>Due {fmtDate(vehicle.due_date)}</span>
                          <span>{vehicle.current_location}</span>
                        </div>
                        {role === "detailer" ? (
                          <div className={`time-left-chip ${getTimeLeftTone(vehicle.due_date)}`}>
                            {getTimeLeftLabel(vehicle.due_date)}
                          </div>
                        ) : null}
                        <div className="workflow-row">
                          {getWorkflowBadges(vehicle).map((badge) => (
                            <Flag key={`${vehicle.id}-${badge}`} label={badge} />
                          ))}
                        </div>
                        <div className="flag-row">
                          {!vehicle.recall_checked ? <Flag label="Recall Open" muted /> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-inline">No units are waiting on this role right now.</div>
          )}
        </section>

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
                    <button key={vehicle.id} className="kanban-card" onClick={() => openVehicle(vehicle.id)}>
                      <strong>{vehicle.stock_number}</strong>
                      <span>{vehicle.make} {vehicle.model}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        </>
        ) : (
        <>
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Admin</p>
              <h2>Administration</h2>
            </div>
            <button className="secondary-btn" onClick={loadAdminData}>Refresh Admin Data</button>
          </div>

          <div className="admin-nav">
            <button className={`tab-btn ${adminSection === "steps" ? "active" : ""}`} onClick={() => setAdminSection("steps")}>
              Step Labels
            </button>
            <button className={`tab-btn ${adminSection === "users" ? "active" : ""}`} onClick={() => setAdminSection("users")}>
              Users
            </button>
            <button className={`tab-btn ${adminSection === "audit" ? "active" : ""}`} onClick={() => setAdminSection("audit")}>
              Audit
            </button>
          </div>

          {adminSection === "steps" ? (
            <div className="admin-list">
              {adminActions.map((action) => (
                <div key={action.key} className="admin-card">
                  <div className="admin-card-head">
                    <strong>{action.key}</strong>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={action.enabled}
                        onChange={(event) => updateAdminAction(action.key, { enabled: event.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>
                  <label>
                    Action Label
                    <input
                      value={action.label}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAdminActions((current) =>
                          current.map((item) => item.key === action.key ? { ...item, label: value } : item)
                        );
                      }}
                      onBlur={(event) => updateAdminAction(action.key, { label: event.target.value })}
                    />
                  </label>
                  <label>
                    Assigned Role
                    <select
                      value={action.role}
                      onChange={(event) => updateAdminAction(action.key, { role: event.target.value })}
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="admin-meta">Type: {action.type}</p>
                </div>
              ))}
            </div>
          ) : null}

          {adminSection === "users" ? (
            <div className="admin-list">
              <form className="admin-card" onSubmit={createAdminUser}>
                <div className="admin-card-head">
                  <strong>Add User</strong>
                </div>
                <label>
                  Name
                  <input value={newUser.name} onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))} required />
                </label>
                <label>
                  Role
                  <select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value }))}>
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-btn" type="submit">Create User</button>
              </form>

              {users.map((managedUser) => (
                <div key={managedUser.id} className="admin-card">
                  <div className="admin-card-head">
                    <strong>{managedUser.name}</strong>
                  </div>
                  <label>
                    Name
                    <input
                      defaultValue={managedUser.name}
                      onBlur={(event) => updateAdminUser(managedUser.id, { name: event.target.value })}
                    />
                  </label>
                  <label>
                    Role
                    <select
                      value={managedUser.role}
                      onChange={(event) => {
                        const roleValue = event.target.value;
                        setUsers((current) => current.map((item) => item.id === managedUser.id ? { ...item, role: roleValue } : item));
                        updateAdminUser(managedUser.id, { role: roleValue });
                      }}
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          ) : null}

          {adminSection === "audit" ? (
            <div className="audit-feed">
              {auditFeed.map((entry) => (
                <div key={entry.id} className="audit-row">
                  <strong>{fmtDate(entry.created_at)}</strong>
                  <span>{entry.user?.name ?? "Unknown User"}</span>
                  <span>{entry.vehicle?.stock_number ?? "System"}</span>
                  <p>
                    {entry.field_changed.replaceAll("_", " ")}: {String(entry.old_value || "empty")} to {String(entry.new_value || "empty")}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
        </>
        )}
      </main>

      <div className="mobile-tabbar">
        <button className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
          Dashboard
        </button>
        <button
          className={`tab-btn ${activeTab === "admin" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("admin");
            loadAdminData();
          }}
        >
          Admin
        </button>
      </div>

      {selectedVehicle ? (
        <div className="detail-overlay" onClick={() => {
          setSelectedVehicle(null);
        }}>
          <section className="detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Vehicle Detail</p>
                <h2>
                  {selectedVehicle.stock_number} | {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
                </h2>
              </div>
              <button className="secondary-btn" onClick={() => {
                setSelectedVehicle(null);
              }}>Close</button>
            </div>

            <div className="detail-card">
              <p><strong>Status:</strong> {formatFieldLabel(selectedVehicle.status)}</p>
              <p><strong>Location:</strong> {selectedVehicle.current_location}</p>
              <p><strong>Due:</strong> {fmtDate(selectedVehicle.due_date)}</p>
              <p><strong>Assigned Role:</strong> {selectedVehicle.assigned_role?.replaceAll("_", " ") ?? "Complete"}</p>
              <p><strong>Notes:</strong> {selectedVehicle.notes || "None"}</p>
              {selectedVehicle.needs_service ? (
                <p><strong>{getServiceDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.service_notes || "No service notes"}</p>
              ) : null}
              {selectedVehicle.needs_bodywork ? (
                <p><strong>{getBodyworkDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.bodywork_notes || "No body work notes"}</p>
              ) : null}
              {selectedVehicle.blockers.length > 0 ? <p><strong>Blocking Issues:</strong> {selectedVehicle.blockers.join(" ")}</p> : null}
            </div>

            <div className="detail-card">
              <h3>Your Next Step</h3>
              <div className="action-grid">
                {roleSpecificActions.length > 0 ? roleSpecificActions.map((action) => (
                  <button
                    key={action.key}
                    className="next-step-btn"
                    onClick={() => {
                      if (action.key === "toggle_fueled") return updateFlags(selectedVehicle.id, { fueled: true });
                      if (action.key === "toggle_recall") return updateFlags(selectedVehicle.id, { recall_checked: true });
                      if (action.key === "complete_recall") return updateFlags(selectedVehicle.id, { recall_completed: true });
                      if (action.key === "start_service") return updateFlags(selectedVehicle.id, { service_status: "in_progress" });
                      if (action.key === "complete_service") return updateFlags(selectedVehicle.id, { service_status: "completed" });
                      if (action.key === "start_bodywork") return updateFlags(selectedVehicle.id, { bodywork_status: "in_progress" });
                      if (action.key === "complete_bodywork") return updateFlags(selectedVehicle.id, { bodywork_status: "completed" });
                      if (action.key === "complete_qc") return updateFlags(selectedVehicle.id, { qc_completed: true });
                      return updateStatus(selectedVehicle.id, action.key);
                    }}
                  >
                    {action.label}
                  </button>
                )) : <p className="step-helper">No action is waiting on this role right now.</p>}
              </div>
            </div>

            <div className="detail-card">
              <h3>Steps</h3>
              <div className="step-list">
                {statusSequence
                  .filter((step) => {
                    if (step.key === "complete_service") return selectedVehicle.needs_service;
                    if (step.key === "start_service") return selectedVehicle.needs_service;
                    if (step.key === "open_recall") return true;
                    if (step.key === "complete_recall") return selectedVehicle.recall_open || selectedVehicle.recall_completed;
                    if (step.key === "complete_bodywork") return selectedVehicle.needs_bodywork;
                    if (step.key === "start_bodywork") return selectedVehicle.needs_bodywork;
                    if (step.key === "complete_qc") return selectedVehicle.qc_required;
                    return true;
                  })
                  .map((step) => {
                    const state = getStepState(selectedVehicle, step);
                    const latestChange = getLatestChangeForStep(selectedVehicle, step);
                    const disabled = state.completed || !state.available;

                    return (
                      <div key={step.key} className={`step-row ${state.completed ? "completed" : ""}`}>
                        <div className="step-copy">
                          <strong>{step.label}</strong>
                          <span>
                            {latestChange
                              ? `${latestChange.user?.name ?? "Unknown User"} | ${fmtDate(latestChange.created_at)}`
                              : "No completion recorded yet"}
                          </span>
                        </div>
                        <button
                          className={`slider-btn ${state.completed ? "done" : ""}`}
                          disabled={disabled}
                          onClick={() => {
                            if (step.key === "toggle_fueled") return updateFlags(selectedVehicle.id, { fueled: true });
                            if (step.key === "toggle_recall") return updateFlags(selectedVehicle.id, { recall_checked: true });
                            if (step.key === "open_recall") return updateFlags(selectedVehicle.id, { recall_open: true });
                            if (step.key === "complete_recall") return updateFlags(selectedVehicle.id, { recall_completed: true });
                            if (step.key === "start_service") return updateFlags(selectedVehicle.id, { service_status: "in_progress" });
                            if (step.key === "complete_service") return updateFlags(selectedVehicle.id, { service_status: "completed" });
                            if (step.key === "start_bodywork") return updateFlags(selectedVehicle.id, { bodywork_status: "in_progress" });
                            if (step.key === "complete_bodywork") return updateFlags(selectedVehicle.id, { bodywork_status: "completed" });
                            if (step.key === "complete_qc") return updateFlags(selectedVehicle.id, { qc_completed: true });
                            return updateStatus(selectedVehicle.id, step.key);
                          }}
                        >
                          <span className="slider-thumb" />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="detail-card">
              <h3>Audit Timeline</h3>
              <div className="timeline">
                {selectedVehicle.timeline.map((entry) => (
                  <div key={entry.id} className="timeline-item">
                    <strong>{fmtDate(entry.created_at)}</strong>
                    <span>{entry.user?.name ?? "Unknown User"}</span>
                    <p>
                      {formatFieldLabel(entry.field_changed)}: {String(entry.old_value || "empty")} to {String(entry.new_value || "empty")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, danger = false }) {
  return (
    <div className={`stat-card ${danger ? "danger" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Flag({ label, muted = false }) {
  return <span className={`flag ${muted ? "muted" : ""}`}>{label}</span>;
}
