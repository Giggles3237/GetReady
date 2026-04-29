import { useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import {
  addDays,
  fmtDayLabel,
  getCompletedStepEntries,
  getCompletionEntry,
  getCompletionIndicators,
  getDueSortValue,
  getNextActionForRole,
  getRoleActionPriority,
  groupVehiclesByAction,
  isOverdue,
  isSameDay,
  shouldShowOnDashboard,
  startOfDay,
  toDateTimeLocalValue
} from "../utils/appHelpers";

const AUTO_REFRESH_INTERVAL_MS = 15000;

function createEmptySubmission(userId = "") {
  return {
    stock_number: "",
    year: "",
    make: "BMW",
    model: "",
    color: "",
    due_date: "",
    submitted_by_user_id: userId,
    assigned_user_id: "",
    needs_service: false,
    needs_bodywork: false,
    service_notes: "",
    bodywork_notes: "",
    qc_required: false,
    notes: ""
  };
}

export function useAppData({ authUser, canAccessAdmin, dashboardRole, role }) {
  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [salespersonView, setSalespersonView] = useState("mine");
  const [calendarView, setCalendarView] = useState("agenda");
  const [showCompleted, setShowCompleted] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState(null);
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [dueDateEdit, setDueDateEdit] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [adminActions, setAdminActions] = useState([]);
  const [auditFeed, setAuditFeed] = useState([]);
  const [archivedVehicles, setArchivedVehicles] = useState([]);
  const [reportsOverview, setReportsOverview] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "salesperson" });
  const [submission, setSubmission] = useState(createEmptySubmission(authUser?.id));
  const [error, setError] = useState("");

  const hasManagerAccess = ["admin", "manager"].includes(role);
  const canEditDueDate = ["admin", "manager", "salesperson"].includes(role);
  const salespersonUsers = useMemo(() => users.filter((user) => user.role === "salesperson"), [users]);
  const assignableUsers = useMemo(() => users.filter((user) => user.is_active), [users]);
  const visibleManagedUsers = useMemo(
    () => showInactiveUsers ? users : users.filter((user) => user.is_active),
    [users, showInactiveUsers]
  );

  async function openVehicle(vehicleId) {
    const data = await request(`/vehicles/${vehicleId}`);
    setSelectedVehicle(data.vehicle);
    return data.vehicle;
  }

  async function loadDashboard() {
    if (!authUser) {
      return;
    }

    setError("");
    const viewQuery = dashboardRole === "salesperson" ? `&view=${salespersonView}` : "";
    const completedQuery = showCompleted ? "&include_completed=true" : "";
    const [userData, vehicleData, summaryData] = await Promise.all([
      request("/users"),
      request(`/vehicles?role=${dashboardRole}${viewQuery}${completedQuery}`),
      request(`/dashboard/summary?role=${dashboardRole}${viewQuery}${completedQuery}`)
    ]);

    setUsers(userData.users);
    setVehicles(vehicleData.vehicles);
    setSummary(summaryData.summary);

    if (selectedVehicle) {
      try {
        await openVehicle(selectedVehicle.id);
      } catch {
        // Keep current detail view even if it falls out of the filtered list.
      }
    }
  }

  async function loadAdminData() {
    if (!canAccessAdmin) {
      return;
    }

    setError("");
    const [userData, actionData, auditData, archivedData] = await Promise.all([
      request("/users"),
      request("/admin/actions"),
      request("/admin/audit?limit=150"),
      request("/vehicles?role=admin&include_archived=true")
    ]);

    setUsers(userData.users);
    setAdminActions(actionData.actions);
    setAuditFeed(auditData.audit);
    setArchivedVehicles(archivedData.vehicles.filter((vehicle) => vehicle.is_archived));
  }

  async function loadReports() {
    if (!hasManagerAccess) {
      return;
    }

    setError("");
    const data = await request("/reports/overview");
    setReportsOverview(data.report);
  }

  useEffect(() => {
    if (!authUser) {
      return;
    }

    loadDashboard().catch((err) => setError(err.message));
  }, [authUser, salespersonView, showCompleted]);

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
    if (!authUser) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      loadDashboard().catch((err) => setError(err.message));
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser, selectedVehicle?.id, salespersonView, showCompleted]);

  useEffect(() => {
    setDueDateEdit(selectedVehicle ? toDateTimeLocalValue(selectedVehicle.due_date) : "");
  }, [selectedVehicle?.id, selectedVehicle?.due_date]);

  useEffect(() => {
    const query = search.trim();
    if (!searchOpen || !query) {
      setSearchResults([]);
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const data = await request(`/search/vehicles?q=${encodeURIComponent(query)}`);
        setSearchResults(data.vehicles);
      } catch (err) {
        setError(err.message);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [search, searchOpen]);

  async function refreshVehicleAndDashboard(vehicleId) {
    await loadDashboard();
    await openVehicle(vehicleId);
  }

  async function updateStatus(vehicleId, status) {
    setError("");
    await request(`/vehicles/${vehicleId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await refreshVehicleAndDashboard(vehicleId);
  }

  async function updateFlags(vehicleId, changes) {
    setError("");
    await request(`/vehicles/${vehicleId}/flags`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
    await refreshVehicleAndDashboard(vehicleId);
  }

  async function saveManagerCorrections(vehicleId, changes) {
    setError("");
    await request(`/vehicles/${vehicleId}/corrections`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
    await refreshVehicleAndDashboard(vehicleId);
  }

  async function updateVehicleDueDate(vehicleId) {
    setError("");
    await request(`/vehicles/${vehicleId}/due-date`, {
      method: "PATCH",
      body: JSON.stringify({ due_date: new Date(dueDateEdit).toISOString() })
    });
    await refreshVehicleAndDashboard(vehicleId);
  }

  async function archiveVehicle(vehicleId) {
    setError("");
    await request(`/vehicles/${vehicleId}/archive`, {
      method: "PATCH",
      body: JSON.stringify({})
    });
    setSelectedVehicle(null);
    await loadDashboard();
    if (canAccessAdmin) {
      await loadAdminData();
    }
    setArchiveNotice({
      title: "Vehicle Archived",
      message: "The vehicle was removed from active displays and its audit history was preserved."
    });
    setSuccessMessage("");
  }

  async function unarchiveVehicle(vehicleId) {
    setError("");
    const data = await request(`/vehicles/${vehicleId}/unarchive`, {
      method: "PATCH",
      body: JSON.stringify({})
    });
    await loadDashboard();
    await loadAdminData();
    setSelectedVehicle(data.vehicle);
    setArchiveNotice({
      title: "Vehicle Restored",
      message: "The vehicle was returned to active displays."
    });
    await openVehicle(vehicleId);
  }

  async function createVehicle(event) {
    event.preventDefault();

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

    setSubmission(createEmptySubmission(authUser.id));
    setSuccessMessage(`${data.vehicle.stock_number} submitted successfully. Next up: BMW Genius takes the car to detail.`);
    setShowSubmissionModal(false);
    await loadDashboard();
    await openVehicle(data.vehicle.id);
  }

  async function updateAdminAction(actionKey, changes) {
    const data = await request(`/admin/actions/${actionKey}`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
    setAdminActions(data.actions);
    await loadDashboard();
  }

  async function createAdminUser(event) {
    event.preventDefault();

    const data = await request("/admin/users", {
      method: "POST",
      body: JSON.stringify(newUser)
    });
    setUsers(data.users);
    setNewUser({ name: "", email: "", role: "salesperson" });
    setTemporaryPassword(`${data.user.email} temporary password: ${data.temporaryPassword}`);
    setSuccessMessage(`${data.user.name} created successfully.`);
    await loadAdminData();
  }

  async function updateAdminUser(targetUserId, changes) {
    const data = await request(`/admin/users/${targetUserId}`, {
      method: "PATCH",
      body: JSON.stringify(changes)
    });
    setUsers(data.users);
    await loadAdminData();
  }

  async function resetAdminPassword(targetUserId, email) {
    const data = await request(`/admin/users/${targetUserId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setTemporaryPassword(`${email} temporary password: ${data.temporaryPassword}`);
    setSuccessMessage("Temporary password reset successfully.");
  }

  const filteredForDisplay = useMemo(
    () => vehicles.filter((vehicle) => showCompleted ? !vehicle.is_archived : shouldShowOnDashboard(vehicle)),
    [vehicles, showCompleted]
  );
  const grouped = useMemo(() => {
    const map = Object.fromEntries(["Submitted", "At Detail", "In Detail", "Detail Complete", "Service", "Warehouse QC", "Ready"].map((column) => [column, []]));
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
  const overdueActionVehicles = useMemo(
    () => nextUpVehicles.filter((vehicle) => vehicle.status !== "ready" && isOverdue(vehicle.due_date)),
    [nextUpVehicles]
  );
  const currentActionVehicles = useMemo(
    () => nextUpVehicles.filter((vehicle) => !(vehicle.status !== "ready" && isOverdue(vehicle.due_date))),
    [nextUpVehicles]
  );
  const mySubmittedVehicles = useMemo(() => prioritizedVehicles.filter((vehicle) => vehicle.submitted_by_user_id === authUser?.id), [prioritizedVehicles, authUser]);
  const calendarVehicles = useMemo(() => {
    const today = startOfDay(new Date()).getTime();

    return filteredForDisplay
      .filter((vehicle) => startOfDay(vehicle.due_date).getTime() >= today)
      .sort((left, right) => getDueSortValue(left) - getDueSortValue(right));
  }, [filteredForDisplay]);
  const agendaSections = useMemo(() => {
    const groupedByDate = new Map();

    calendarVehicles.forEach((vehicle) => {
      const key = startOfDay(vehicle.due_date).toISOString();
      if (!groupedByDate.has(key)) {
        groupedByDate.set(key, []);
      }
      groupedByDate.get(key).push(vehicle);
    });

    return Array.from(groupedByDate.entries()).map(([dateKey, items]) => ({
      dateKey,
      label: fmtDayLabel(dateKey),
      items
    }));
  }, [calendarVehicles]);

  const weekDays = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(today, index);
      return {
        key: date.toISOString(),
        label: fmtDayLabel(date),
        items: calendarVehicles.filter((vehicle) => isSameDay(vehicle.due_date, date))
      };
    });
  }, [calendarVehicles]);

  const actionSections = useMemo(() => groupVehiclesByAction(currentActionVehicles, role), [currentActionVehicles, role]);
  const availableActions = useMemo(() => {
    if (!selectedVehicle) {
      return [];
    }

    if (role === "admin") {
      return selectedVehicle.actions;
    }

    return selectedVehicle.actions.filter((action) => action.role === role);
  }, [selectedVehicle, role]);

  const showSalespersonSubmissionSection = dashboardRole === "salesperson" && salespersonView === "mine" && mySubmittedVehicles.length > 0;
  const completionEntry = useMemo(() => selectedVehicle ? getCompletionEntry(selectedVehicle) : null, [selectedVehicle]);
  const completedSteps = useMemo(() => selectedVehicle ? getCompletedStepEntries(selectedVehicle) : [], [selectedVehicle]);
  const completionIndicators = useMemo(() => selectedVehicle ? getCompletionIndicators(selectedVehicle) : [], [selectedVehicle]);

  function resetAppState() {
    setUsers([]);
    setVehicles([]);
    setSummary(null);
    setSelectedVehicle(null);
    setAdminActions([]);
    setAuditFeed([]);
    setReportsOverview(null);
    setSuccessMessage("");
    setTemporaryPassword("");
    setArchiveNotice(null);
    setSearch("");
    setSearchOpen(false);
    setSearchResults([]);
    setSubmission(createEmptySubmission());
  }

  return {
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
    error,
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
    saveManagerCorrections,
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
  };
}
