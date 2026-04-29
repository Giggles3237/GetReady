import { listActionDefinitions, listVehicles } from "../db.js";
import { shouldShowOnDashboard } from "../services/dashboard-visibility.js";
import { buildOverviewReport } from "../services/report-service.js";
import { formatStatus, getPipelineColumn } from "../workflow.js";
import { getQueueForRole, normalizeActionDefinition, normalizeVehicle } from "../vehicle-helpers.js";

export function registerDashboardRoutes(app, { requireManager }) {
  app.get("/api/dashboard/summary", async (req, res) => {
    const requestedRole = typeof req.query.role === "string" && req.query.role !== "all" ? req.query.role : req.currentUser.role;
    const role = requestedRole === "admin" ? "manager" : requestedRole;
    const includeCompleted = req.query.include_completed === "true";
    const includeAllSalespersonVehicles = role === "salesperson" && req.query.view === "all";
    const [actionDefinitionsRaw, vehiclesRaw] = await Promise.all([listActionDefinitions(), listVehicles()]);
    const actionDefinitions = actionDefinitionsRaw.map(normalizeActionDefinition);
    const vehicles = vehiclesRaw
      .map(normalizeVehicle)
      .filter((vehicle) => includeCompleted ? !vehicle.is_archived : shouldShowOnDashboard(vehicle))
      .filter((vehicle) => role !== "salesperson" || includeAllSalespersonVehicles || vehicle.submitted_by_user_id === req.currentUser.id);
    const now = Date.now();

    const summary = {
      total: vehicles.length,
      overdue: vehicles.filter((vehicle) => new Date(vehicle.due_date).getTime() < now && vehicle.status !== "ready").length,
      ready: vehicles.filter((vehicle) => vehicle.status === "ready").length,
      needsAction: vehicles.filter((vehicle) => getQueueForRole(vehicle, role, actionDefinitions, req.currentUser.id)).length,
      byPipeline: ["Submitted", "At Detail", "In Detail", "Detail Complete", "Service", "Warehouse QC", "Ready"].map((column) => ({
        column,
        count: vehicles.filter((vehicle) => getPipelineColumn(vehicle) === column).length
      }))
    };

    res.json({ summary });
  });

  app.get("/api/dashboard/calendar", async (_req, res) => {
    const items = (await listVehicles())
      .map(normalizeVehicle)
      .filter((vehicle) => shouldShowOnDashboard(vehicle))
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
      .map((vehicle) => ({
        id: vehicle.id,
        title: `${vehicle.stock_number} - ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        due_date: vehicle.due_date,
        overdue: new Date(vehicle.due_date).getTime() < Date.now() && vehicle.status !== "ready",
        status: formatStatus(vehicle.status)
      }));

    res.json({ items });
  });

  app.get("/api/reports/overview", requireManager, async (_req, res) => {
    const report = await buildOverviewReport();
    res.json({ report });
  });
}
