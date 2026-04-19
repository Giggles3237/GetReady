import { useEffect, useMemo, useState } from "react";

const API_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const AUTO_REFRESH_INTERVAL_MS = 15000;

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "salesperson", label: "Salesperson" },
  { value: "manager", label: "Manager" },
  { value: "bmw_genius", label: "BMW Genius" },
  { value: "detailer", label: "Detailer" },
  { value: "service_advisor", label: "Service Advisor" }
];

const pipelineColumns = ["Submitted", "At Detail", "In Detail", "Service", "QC", "Ready"];
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

function formatFieldLabel(value) {
  return value.replaceAll("_", " ");
}

function performAction(vehicleId, actionKey, updateStatus, updateFlags) {
  if (actionKey === "toggle_fueled") return updateFlags(vehicleId, { fueled: true });
  if (actionKey === "toggle_recall") return updateFlags(vehicleId, { recall_checked: true });
  if (actionKey === "complete_recall") return updateFlags(vehicleId, { recall_completed: true });
  if (actionKey === "start_service") return updateFlags(vehicleId, { service_status: "in_progress" });
  if (actionKey === "complete_service") return updateFlags(vehicleId, { service_status: "completed" });
  if (actionKey === "start_bodywork") return updateFlags(vehicleId, { bodywork_status: "in_progress" });
  if (actionKey === "complete_bodywork") return updateFlags(vehicleId, { bodywork_status: "completed" });
  if (actionKey === "complete_qc") return updateFlags(vehicleId, { qc_completed: true });
  return updateStatus(vehicleId, actionKey);
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
  if (vehicle.fueled) {
    return "Fueled";
  }

  if (vehicle.status === "detail_started") {
    return "Fuel Pending";
  }

  return "Needs Fuel";
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

function getCompletionIndicators(vehicle) {
  const indicators = [];

  if (statusProgressOrder[vehicle.status] >= statusProgressOrder.detail_finished) {
    indicators.push({ label: "Detailed", complete: true });
  }

  if (vehicle.fueled) {
    indicators.push({ label: "Fueled", complete: true });
  }

  if (vehicle.needs_bodywork) {
    if (vehicle.bodywork_status === "completed") {
      indicators.push({ label: "Body Work Complete", complete: true });
    }
  }

  if (vehicle.needs_service) {
    if (vehicle.service_status === "completed") {
      indicators.push({ label: "Service Complete", complete: true });
    }
  }

  return indicators;
}

function getCompletionEntry(vehicle) {
  if (vehicle.status !== "ready" || !vehicle.timeline) {
    return null;
  }

  return [...vehicle.timeline]
    .reverse()
    .find((entry) => entry.field_changed === "status" && String(entry.new_value).toLowerCase() === "ready") ?? null;
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

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(data.message || "Request failed.");
  }

  return response.json();
}

function AuthScreen({ loginForm, setLoginForm, onSubmit, error }) {
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Get Ready Tracking System</p>
        <h1>Sign In</h1>
        <p className="lead">Use your dealership login to access your task queue and audit trail.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <form className="control-card auth-form" onSubmit={onSubmit}>
          <label>
            Email
            <input
              type="email"
              value={loginForm.email}
              onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              required
            />
          </label>
          <button className="primary-btn" type="submit">Sign In</button>
        </form>
      </section>
    </div>
  );
}

function PasswordChangeScreen({ passwordForm, setPasswordForm, onSubmit, error, user }) {
  return (
    <div className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">{user.name}</p>
        <h1>Set Your Password</h1>
        <p className="lead">Your temporary password worked. Please set a new permanent password before continuing.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <form className="control-card auth-form" onSubmit={onSubmit}>
          <label>
            Current Password
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
              required
            />
          </label>
          <label>
            New Password
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
              required
              minLength={8}
            />
          </label>
          <button className="primary-btn" type="submit">Save Password</button>
        </form>
      </section>
    </div>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [adminSection, setAdminSection] = useState("steps");
  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [summary, setSummary] = useState(null);
  const [calendarItems, setCalendarItems] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [search, setSearch] = useState("");
  const [salespersonView, setSalespersonView] = useState("mine");
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [adminActions, setAdminActions] = useState([]);
  const [auditFeed, setAuditFeed] = useState([]);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "salesperson" });
  const [submission, setSubmission] = useState({
    stock_number: "",
    year: "",
    make: "BMW",
    model: "",
    color: "",
    due_date: "",
    submitted_by_user_id: "",
    assigned_user_id: "",
    needs_service: false,
    needs_bodywork: false,
    service_notes: "",
    bodywork_notes: "",
    qc_required: false,
    notes: ""
  });

  const activeUser = authUser;
  const role = authUser?.role ?? "salesperson";
  const dashboardRole = role === "admin" ? "manager" : role;
  const canAccessAdmin = role === "admin";
  const hasManagerAccess = ["admin", "manager"].includes(role);
  const salespersonUsers = useMemo(() => users.filter((user) => user.role === "salesperson"), [users]);
  const assignableUsers = useMemo(() => users.filter((user) => user.is_active), [users]);

  async function syncSession() {
    try {
      const data = await request("/auth/me");
      setAuthUser(data.user);
    } catch {
      setAuthUser(null);
    } finally {
      setAuthReady(true);
    }
  }

  async function loadDashboard(nextSearch = search) {
    if (!authUser) {
      return;
    }

    try {
      setError("");
      const viewQuery = dashboardRole === "salesperson" ? `&view=${salespersonView}` : "";
      const [userData, vehicleData, summaryData, calendarData] = await Promise.all([
        request("/users"),
        request(`/vehicles?role=${dashboardRole}&search=${encodeURIComponent(nextSearch)}${viewQuery}`),
        request(`/dashboard/summary?role=${dashboardRole}${viewQuery}`),
        request("/dashboard/calendar")
      ]);

      setUsers(userData.users);
      setVehicles(vehicleData.vehicles);
      setSummary(summaryData.summary);
      setCalendarItems(calendarData.items);

      if (selectedVehicle) {
        try {
          await openVehicle(selectedVehicle.id);
        } catch {
          // Keep the current detail view open even if it drops out of the filtered dashboard list.
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    syncSession();
  }, []);

  useEffect(() => {
    if (!authUser || authUser.must_change_password) {
      return;
    }

    loadDashboard(search);
  }, [authUser, search, salespersonView]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    setSubmission((current) => ({
      ...current,
      submitted_by_user_id: current.submitted_by_user_id || authUser.id
    }));
  }, [authUser]);

  useEffect(() => {
    if (!authUser || authUser.must_change_password) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      loadDashboard(search);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser, search, selectedVehicle?.id, salespersonView]);

  async function handleLogin(event) {
    event.preventDefault();

    try {
      setError("");
      const data = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm)
      });
      setAuthUser(data.user);
      setLoginForm({ email: "", password: "" });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLogout() {
    await request("/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setAuthUser(null);
    setUsers([]);
    setVehicles([]);
    setSummary(null);
    setCalendarItems([]);
    setSelectedVehicle(null);
    setAdminActions([]);
    setAuditFeed([]);
    setSuccessMessage("");
    setTemporaryPassword("");
  }

  async function handlePasswordChange(event) {
    event.preventDefault();

    try {
      setError("");
      const data = await request("/auth/change-password", {
        method: "PATCH",
        body: JSON.stringify(passwordForm)
      });
      setAuthUser(data.user);
      setPasswordForm({ currentPassword: "", newPassword: "" });
    } catch (err) {
      setError(err.message);
    }
  }

  async function openVehicle(vehicleId) {
    try {
      const data = await request(`/vehicles/${vehicleId}`);
      setSelectedVehicle(data.vehicle);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateStatus(vehicleId, status) {
    try {
      await request(`/vehicles/${vehicleId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await loadDashboard();
      await openVehicle(vehicleId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateFlags(vehicleId, changes) {
    try {
      await request(`/vehicles/${vehicleId}/flags`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });
      await loadDashboard();
      await openVehicle(vehicleId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createVehicle(event) {
    event.preventDefault();

    try {
      setError("");
      setTemporaryPassword("");
      const data = await request("/vehicles", {
        method: "POST",
        body: JSON.stringify({
          ...submission,
          year: Number(submission.year),
          submitted_by_user_id: submission.submitted_by_user_id || authUser.id,
          assigned_user_id: submission.assigned_user_id || null,
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
        submitted_by_user_id: authUser.id,
        assigned_user_id: "",
        needs_service: false,
        needs_bodywork: false,
        service_notes: "",
        bodywork_notes: "",
        qc_required: false,
        notes: ""
      });
      setSuccessMessage(`${data.vehicle.stock_number} submitted successfully. Next up: BMW Genius takes the car to detail.`);
      setShowSubmissionModal(false);
      await loadDashboard();
      await openVehicle(data.vehicle.id);
    } catch (err) {
      setSuccessMessage("");
      setError(err.message);
    }
  }

  async function loadAdminData() {
    if (!canAccessAdmin) {
      return;
    }

    try {
      setError("");
      const [userData, actionData, auditData] = await Promise.all([
        request("/users"),
        request("/admin/actions"),
        request("/admin/audit?limit=150")
      ]);

      setUsers(userData.users);
      setAdminActions(actionData.actions);
      setAuditFeed(auditData.audit);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAdminAction(actionKey, changes) {
    try {
      const data = await request(`/admin/actions/${actionKey}`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });
      setAdminActions(data.actions);
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createAdminUser(event) {
    event.preventDefault();

    try {
      const data = await request("/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser)
      });
      setUsers(data.users);
      setNewUser({ name: "", email: "", role: "salesperson" });
      setTemporaryPassword(`${data.user.email} temporary password: ${data.temporaryPassword}`);
      setSuccessMessage(`${data.user.name} created successfully.`);
      await loadAdminData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAdminUser(targetUserId, changes) {
    try {
      const data = await request(`/admin/users/${targetUserId}`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });
      setUsers(data.users);
      await loadAdminData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetAdminPassword(targetUserId, email) {
    try {
      const data = await request(`/admin/users/${targetUserId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setTemporaryPassword(`${email} temporary password: ${data.temporaryPassword}`);
      setSuccessMessage("Temporary password reset successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredForDisplay = useMemo(
    () => showCompleted ? vehicles : vehicles.filter((vehicle) => vehicle.status !== "ready"),
    [vehicles, showCompleted]
  );

  const grouped = useMemo(() => {
    const map = Object.fromEntries(pipelineColumns.map((column) => [column, []]));
    filteredForDisplay.forEach((vehicle) => {
      map[vehicle.pipeline ?? "Submitted"].push(vehicle);
    });
    return map;
  }, [filteredForDisplay]);

  const prioritizedVehicles = useMemo(() => {
    return [...filteredForDisplay].sort((left, right) => {
      const leftAction = getNextActionForRole(left, role);
      const rightAction = getNextActionForRole(right, role);

      if (leftAction && !rightAction) return -1;
      if (!leftAction && rightAction) return 1;

      if (leftAction && rightAction) {
        const actionPriorityDelta = getRoleActionPriority(role, leftAction.key) - getRoleActionPriority(role, rightAction.key);
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
  }, [filteredForDisplay, role]);

  const nextUpVehicles = useMemo(() => prioritizedVehicles.filter((vehicle) => getNextActionForRole(vehicle, role)), [prioritizedVehicles, role]);
  const mySubmittedVehicles = useMemo(
    () => prioritizedVehicles.filter((vehicle) => vehicle.submitted_by_user_id === authUser?.id),
    [prioritizedVehicles, authUser]
  );
  const actionSections = useMemo(() => groupVehiclesByAction(nextUpVehicles, role), [nextUpVehicles, role]);
  const availableActions = useMemo(
    () => selectedVehicle ? selectedVehicle.actions.filter((action) => action.role === role) : [],
    [selectedVehicle, role]
  );
  const showSalespersonSubmissionSection = dashboardRole === "salesperson" && salespersonView === "mine" && mySubmittedVehicles.length > 0;
  const completionEntry = useMemo(() => selectedVehicle ? getCompletionEntry(selectedVehicle) : null, [selectedVehicle]);

  if (!authReady) {
    return <div className="auth-shell"><section className="auth-card"><h1>Loading...</h1></section></div>;
  }

  if (!authUser) {
    return <AuthScreen loginForm={loginForm} setLoginForm={setLoginForm} onSubmit={handleLogin} error={error} />;
  }

  if (authUser.must_change_password) {
    return <PasswordChangeScreen passwordForm={passwordForm} setPasswordForm={setPasswordForm} onSubmit={handlePasswordChange} error={error} user={authUser} />;
  }

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
          <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            Dashboard
          </button>
          {canAccessAdmin ? (
            <button type="button" className={`tab-btn ${activeTab === "admin" ? "active" : ""}`} onClick={() => { setActiveTab("admin"); loadAdminData(); }}>
              Admin
            </button>
          ) : null}
        </div>

        <div className="control-card">
          <div className="session-card">
            <div>
              <strong>{authUser.name}</strong>
              <p className="session-meta">{roleOptions.find((option) => option.value === authUser.role)?.label} | {authUser.email}</p>
            </div>
            <button type="button" className="secondary-btn" onClick={handleLogout}>Sign Out</button>
          </div>

          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Stock #, make, model, color..."
            />
          </label>

          <button type="button" className="secondary-btn" onClick={() => loadDashboard(search)}>
            Refresh Dashboard
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
        </div>

        {summary ? (
          <div className="summary-grid">
            <StatCard label="Needs My Action" value={summary.needsAction} />
            <StatCard label="Overdue" value={summary.overdue} danger />
            <StatCard label="Ready" value={summary.ready} />
            <StatCard label="Total Units" value={summary.total} />
          </div>
        ) : null}

        <div className="calendar-card">
          <div className="section-heading">
            <h2>Due Dates</h2>
          </div>
          <div className="calendar-list">
            {calendarItems.map((item) => (
              <button type="button" key={item.id} className={`calendar-item ${item.overdue ? "danger" : ""}`} onClick={() => openVehicle(item.id)}>
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
                  <h2>{roleOptions.find((option) => option.value === dashboardRole)?.label} Next Actions</h2>
                </div>
                <span className="pill">{authUser.name}</span>
              </div>

              {role === "salesperson" ? (
                <div className="view-toggle">
                  <button type="button" className={`tab-btn ${salespersonView === "mine" ? "active" : ""}`} onClick={() => setSalespersonView("mine")}>
                    Just Mine
                  </button>
                  <button type="button" className={`tab-btn ${salespersonView === "all" ? "active" : ""}`} onClick={() => setSalespersonView("all")}>
                    Everyone
                  </button>
                </div>
              ) : null}

              <div className="view-toggle">
                <button type="button" className={`tab-btn ${!showCompleted ? "active" : ""}`} onClick={() => setShowCompleted(false)}>
                  Active Only
                </button>
                <button type="button" className={`tab-btn ${showCompleted ? "active" : ""}`} onClick={() => setShowCompleted(true)}>
                  {dashboardRole === "salesperson" && salespersonView === "mine" ? "Show My Completed" : "Show Completed"}
                </button>
              </div>

              {error ? <div className="error-banner">{error}</div> : null}
              {successMessage ? <div className="success-banner">{successMessage}</div> : null}
              {temporaryPassword ? <div className="temp-password-banner">{temporaryPassword}</div> : null}

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
                          <button type="button" key={vehicle.id} className={`vehicle-card ${isOverdue(vehicle.due_date) && vehicle.status !== "ready" ? "overdue" : ""} actionable`} onClick={() => openVehicle(vehicle.id)}>
                            <div className="vehicle-topline">
                              <span className="stock">{vehicle.stock_number}</span>
                              <span className={`status-chip ${getTimeLeftTone(vehicle.due_date)}`}>{getTimeLeftLabel(vehicle.due_date)}</span>
                            </div>
                            <h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                            <p>{vehicle.color}</p>
                            <div className="meta-row">
                              <span>Due {fmtDate(vehicle.due_date)}</span>
                              <span>{vehicle.current_location}</span>
                            </div>
                            {role === "detailer" ? <div className={`time-left-chip ${getTimeLeftTone(vehicle.due_date)}`}>{getTimeLeftLabel(vehicle.due_date)}</div> : null}
                            <div className="workflow-row">
                              {getWorkflowBadges(vehicle).map((badge) => <Flag key={`${vehicle.id}-${badge}`} label={badge} />)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : !showSalespersonSubmissionSection ? (
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
                        <button type="button" key={`submitted-${vehicle.id}`} className={`vehicle-card ${isOverdue(vehicle.due_date) && vehicle.status !== "ready" ? "overdue" : ""}`} onClick={() => openVehicle(vehicle.id)}>
                          <div className="vehicle-topline">
                            <span className="stock">{vehicle.stock_number}</span>
                            <span className={`status-chip ${getTimeLeftTone(vehicle.due_date)}`}>{getTimeLeftLabel(vehicle.due_date)}</span>
                          </div>
                          <h3>{vehicle.year} {vehicle.make} {vehicle.model}</h3>
                          <p>{vehicle.color}</p>
                          <div className="meta-row">
                            <span>Due {fmtDate(vehicle.due_date)}</span>
                            <span>{vehicle.current_location}</span>
                          </div>
                          <div className="workflow-row">
                            {getWorkflowBadges(vehicle).map((badge) => <Flag key={`submission-${vehicle.id}-${badge}`} label={badge} />)}
                          </div>
                        </button>
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
        ) : (
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
              <button type="button" className={`tab-btn ${adminSection === "steps" ? "active" : ""}`} onClick={() => setAdminSection("steps")}>Step Labels</button>
              <button type="button" className={`tab-btn ${adminSection === "users" ? "active" : ""}`} onClick={() => setAdminSection("users")}>Users</button>
              <button type="button" className={`tab-btn ${adminSection === "audit" ? "active" : ""}`} onClick={() => setAdminSection("audit")}>Audit</button>
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

                {users.map((managedUser) => (
                  <div key={managedUser.id} className="admin-card">
                    <div className="admin-card-head">
                      <div>
                        <strong>{managedUser.name}</strong>
                        <p className="admin-meta">{roleOptions.find((option) => option.value === managedUser.role)?.label} | {managedUser.email}</p>
                      </div>
                      <button type="button" className="secondary-btn" onClick={() => resetAdminPassword(managedUser.id, managedUser.email)}>Reset Password</button>
                    </div>
                    <label>
                      Name
                      <input defaultValue={managedUser.name} onBlur={(event) => updateAdminUser(managedUser.id, { name: event.target.value })} />
                    </label>
                    <label>
                      Email
                      <input defaultValue={managedUser.email} onBlur={(event) => updateAdminUser(managedUser.id, { email: event.target.value })} />
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
                        {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={managedUser.is_active}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setUsers((current) => current.map((item) => item.id === managedUser.id ? { ...item, is_active: checked } : item));
                          updateAdminUser(managedUser.id, { is_active: checked });
                        }}
                      />
                      Active
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
                    <p>{entry.field_changed.replaceAll("_", " ")}: {String(entry.old_value || "empty")} to {String(entry.new_value || "empty")}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        )}
      </main>

      {canAccessAdmin ? (
        <div className="mobile-tabbar">
          <button type="button" className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>Dashboard</button>
          <button type="button" className={`tab-btn ${activeTab === "admin" ? "active" : ""}`} onClick={() => { setActiveTab("admin"); loadAdminData(); }}>Admin</button>
        </div>
      ) : null}

      {showSubmissionModal ? (
        <div className="detail-overlay">
          <section className="detail-modal submission-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">New Get Ready</p>
                <h2>Submit Unit</h2>
              </div>
              <button type="button" className="secondary-btn" onClick={() => setShowSubmissionModal(false)}>Close</button>
            </div>

            <form className="control-card modal-form" onSubmit={createVehicle}>
              <label>
                Salesperson
                {hasManagerAccess ? (
                  <select
                    value={submission.submitted_by_user_id || authUser.id}
                    onChange={(event) => setSubmission((current) => ({ ...current, submitted_by_user_id: event.target.value }))}
                  >
                    {salespersonUsers.map((user) => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                ) : (
                  <input value={authUser.name} readOnly />
                )}
              </label>

              {hasManagerAccess ? (
                <label>
                  Assigned User
                  <select
                    value={submission.assigned_user_id}
                    onChange={(event) => setSubmission((current) => ({ ...current, assigned_user_id: event.target.value }))}
                  >
                    <option value="">Unassigned</option>
                    {assignableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} | {roleOptions.find((option) => option.value === user.role)?.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

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
          </section>
        </div>
      ) : null}

      {selectedVehicle ? (
        <div className="detail-overlay">
          <section className="detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Vehicle Detail</p>
                <h2>{selectedVehicle.stock_number} | {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</h2>
              </div>
              <button type="button" className="secondary-btn" onClick={() => setSelectedVehicle(null)}>Close</button>
            </div>

            <div className="detail-card">
              {selectedVehicle.status === "ready" ? (
                <div className="completion-banner">
                  <strong>Front Line Ready</strong>
                  <span>
                    {completionEntry
                      ? `Completed by ${completionEntry.user?.name ?? "Unknown User"} on ${fmtDate(completionEntry.created_at)}`
                      : "This unit has been marked complete."}
                  </span>
                </div>
              ) : null}
              <p><strong>Status:</strong> {formatFieldLabel(selectedVehicle.status)}</p>
              <p><strong>Location:</strong> {selectedVehicle.current_location}</p>
              <p><strong>Due:</strong> {fmtDate(selectedVehicle.due_date)}</p>
              <p><strong>Assigned Role:</strong> {selectedVehicle.assigned_role?.replaceAll("_", " ") ?? "Complete"}</p>
              <p><strong>Notes:</strong> {selectedVehicle.notes || "None"}</p>
              {selectedVehicle.needs_service ? <p><strong>{getServiceDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.service_notes || "No service notes"}</p> : null}
              {selectedVehicle.needs_bodywork ? <p><strong>{getBodyworkDisplayLabel(selectedVehicle)}:</strong> {selectedVehicle.bodywork_notes || "No body work notes"}</p> : null}
              {selectedVehicle.blockers.length > 0 ? <p><strong>Blocking Issues:</strong> {selectedVehicle.blockers.join(" ")}</p> : null}
              {getCompletionIndicators(selectedVehicle).length > 0 ? (
                <div className="indicator-grid">
                  {getCompletionIndicators(selectedVehicle).map((indicator) => (
                    <span key={indicator.label} className="indicator-chip complete">
                      {indicator.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="detail-card">
              <h3>{selectedVehicle.status === "ready" ? "Completion Summary" : "Available Actions"}</h3>
              {selectedVehicle.status === "ready" ? (
                <div className="completion-summary">
                  <p><strong>Completed By:</strong> {completionEntry?.user?.name ?? "Unknown User"}</p>
                  <p><strong>Completed At:</strong> {completionEntry ? fmtDate(completionEntry.created_at) : "Unknown"}</p>
                </div>
              ) : (
                <div className="action-grid">
                  {availableActions.length > 0 ? availableActions.map((action) => (
                    <button
                      type="button"
                      key={action.key}
                      className="next-step-btn"
                      onClick={() => performAction(selectedVehicle.id, action.key, updateStatus, updateFlags)}
                    >
                      {action.label}
                    </button>
                  )) : <p className="step-helper">No actions are available right now.</p>}
                </div>
              )}
            </div>

            <div className="detail-card">
              <h3>Audit Timeline</h3>
              <div className="timeline">
                {selectedVehicle.timeline.map((entry) => (
                  <div key={entry.id} className="timeline-item">
                    <strong>{fmtDate(entry.created_at)}</strong>
                    <span>{entry.user?.name ?? "Unknown User"}</span>
                    <p>{formatFieldLabel(entry.field_changed)}: {String(entry.old_value || "empty")} to {String(entry.new_value || "empty")}</p>
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
