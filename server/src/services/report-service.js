import { listAuditEntries, listVehicles } from "../db.js";
import { normalizeVehicle } from "../vehicle-helpers.js";
import { getPipelineColumn, ROLE_LABELS } from "../workflow.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PIPELINE_ORDER = ["Submitted", "At Detail", "In Detail", "Detail Complete", "Service", "Warehouse QC", "Ready"];
const ROLE_ORDER = ["bmw_genius", "detailer", "service_advisor", "manager"];

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function formatDayKey(value) {
  return startOfDay(value).toISOString().slice(0, 10);
}

function safePercent(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return Math.round((numerator / denominator) * 100);
}

function safeAverage(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function buildOverviewReport() {
  const [vehiclesRaw, auditEntriesRaw] = await Promise.all([
    listVehicles(),
    listAuditEntries({ limit: 10000 })
  ]);

  const vehicles = vehiclesRaw.map((vehicle) => {
    const normalized = normalizeVehicle(vehicle);
    return {
      ...normalized,
      pipeline: getPipelineColumn(normalized)
    };
  });
  const activeVehicles = vehicles.filter((vehicle) => !vehicle.is_archived);
  const now = new Date();
  const today = startOfDay(now);
  const sevenDaysAgo = addDays(today, -6);
  const thirtyDaysAgo = addDays(today, -29);

  const completionEntriesByVehicleId = new Map();
  auditEntriesRaw
    .filter((entry) => entry.field_changed === "status" && String(entry.new_value).toLowerCase() === "ready")
    .forEach((entry) => {
      if (!completionEntriesByVehicleId.has(entry.vehicle_id)) {
        completionEntriesByVehicleId.set(entry.vehicle_id, entry);
      }
    });

  const recentCompletedVehicles = vehicles
    .map((vehicle) => ({
      vehicle,
      completionEntry: completionEntriesByVehicleId.get(vehicle.id) ?? null
    }))
    .filter(({ completionEntry }) => completionEntry && startOfDay(completionEntry.created_at).getTime() >= thirtyDaysAgo.getTime());

  const onTimeCompletedCount = recentCompletedVehicles.filter(({ vehicle, completionEntry }) => {
    return new Date(completionEntry.created_at).getTime() <= new Date(vehicle.due_date).getTime();
  }).length;

  const completionDurationsDays = recentCompletedVehicles.map(({ vehicle, completionEntry }) => {
    return Math.max(0, (new Date(completionEntry.created_at).getTime() - new Date(vehicle.created_at).getTime()) / DAY_MS);
  });

  const submittedTrendMap = new Map();
  const completedTrendMap = new Map();

  Array.from({ length: 7 }, (_, index) => addDays(sevenDaysAgo, index)).forEach((date) => {
    const key = formatDayKey(date);
    submittedTrendMap.set(key, 0);
    completedTrendMap.set(key, 0);
  });

  vehicles.forEach((vehicle) => {
    const createdKey = formatDayKey(vehicle.created_at);
    if (submittedTrendMap.has(createdKey)) {
      submittedTrendMap.set(createdKey, submittedTrendMap.get(createdKey) + 1);
    }
  });

  completionEntriesByVehicleId.forEach((entry) => {
    const completionKey = formatDayKey(entry.created_at);
    if (completedTrendMap.has(completionKey)) {
      completedTrendMap.set(completionKey, completedTrendMap.get(completionKey) + 1);
    }
  });

  const summary = {
    activeUnits: activeVehicles.filter((vehicle) => vehicle.status !== "ready").length,
    overdueUnits: activeVehicles.filter((vehicle) => vehicle.status !== "ready" && new Date(vehicle.due_date).getTime() < Date.now()).length,
    readyUnits: activeVehicles.filter((vehicle) => vehicle.status === "ready").length,
    completedLast7Days: Array.from(completedTrendMap.values()).reduce((sum, value) => sum + value, 0),
    onTimeRate30Days: safePercent(onTimeCompletedCount, recentCompletedVehicles.length),
    averageCompletionDays30Days: Number(safeAverage(completionDurationsDays).toFixed(1))
  };

  const byPipeline = PIPELINE_ORDER.map((label) => ({
    label,
    count: activeVehicles.filter((vehicle) => vehicle.pipeline === label && vehicle.status !== "ready").length
  }));

  const workloadByRole = ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role] ?? role,
    count: activeVehicles.filter((vehicle) => vehicle.status !== "ready" && vehicle.assigned_role === role).length
  }));

  const trend = Array.from(submittedTrendMap.entries()).map(([date, submitted]) => ({
    date,
    submitted,
    completed: completedTrendMap.get(date) ?? 0
  }));

  const focus = [
    {
      label: "Needs Service",
      count: activeVehicles.filter((vehicle) => vehicle.status !== "ready" && vehicle.needs_service && vehicle.service_status !== "completed").length
    },
    {
      label: "Needs Body Work",
      count: activeVehicles.filter((vehicle) => vehicle.status !== "ready" && vehicle.needs_bodywork && vehicle.bodywork_status !== "completed").length
    },
    {
      label: "Needs QC",
      count: activeVehicles.filter((vehicle) => vehicle.status !== "ready" && vehicle.qc_required && !vehicle.qc_completed).length
    },
    {
      label: "Open Recall",
      count: activeVehicles.filter((vehicle) => vehicle.status !== "ready" && vehicle.recall_open && !vehicle.recall_completed).length
    }
  ];

  return {
    generated_at: now.toISOString(),
    summary,
    byPipeline,
    workloadByRole,
    trend,
    focus
  };
}
