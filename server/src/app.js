import "dotenv/config";
import cors from "cors";
import express from "express";
import { hasManagerAccess, isAdmin } from "./access.js";
import { buildAllowedOrigins, normalizeEmail, signAuthToken, verifyAuthToken } from "./auth.js";
import { registerAdminRoutes } from "./routes/admin-routes.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerDashboardRoutes } from "./routes/dashboard-routes.js";
import { registerIntegrationRoutes } from "./routes/integration-routes.js";
import { registerVehicleRoutes } from "./routes/vehicle-routes.js";
import { ROLE_LABELS, STATUS, STATUS_META } from "./workflow.js";
import { sanitizeUser } from "./vehicle-helpers.js";
import { getPool, getUser } from "./db.js";
import { addAuditEntry } from "./services/audit-service.js";
import { createVehicleRecord, generateTemporaryPassword, updateVehicleWithAudit } from "./services/vehicle-service.js";
import { getProtectedUndoField, isStatusUndo } from "./services/workflow-guards.js";

const app = express();
const port = process.env.PORT || 4000;
const isProduction = process.env.NODE_ENV === "production";
const authTokenTtlDays = Math.max(Number(process.env.AUTH_TOKEN_TTL_DAYS || process.env.SESSION_TTL_DAYS || 90), 1);
const authTokenMaxAgeMs = authTokenTtlDays * 24 * 60 * 60 * 1000;
const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "change-me-in-production";
const integrationKeys = [
  process.env.BOPCHIPBOARD_API_KEY,
  ...String(process.env.INTEGRATION_API_KEYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
].filter(Boolean);

const allowedOrigins = buildAllowedOrigins();

function readIntegrationKey(req) {
  const headerKey = req.get("x-integration-key");
  if (headerKey) {
    return headerKey.trim();
  }

  const authHeader = req.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return "";
}

function requireBopchipboardKey(req, res, next) {
  if (integrationKeys.length === 0) {
    res.status(500).json({ message: "Bopchipboard integration key is not configured." });
    return;
  }

  const providedKey = readIntegrationKey(req);
  if (!providedKey || !integrationKeys.includes(providedKey)) {
    res.status(401).json({ message: "A valid integration key is required." });
    return;
  }

  next();
}

app.set("trust proxy", 1);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS."));
  },
  credentials: true
}));
app.use(express.json());

async function loadSessionUser(req, _res, next) {
  const authHeader = req.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    req.currentUser = null;
    next();
    return;
  }

  try {
    const payload = verifyAuthToken(authHeader.slice(7).trim(), jwtSecret);
    const user = await getUser(payload.sub);
    req.currentUser = user?.is_active ? sanitizeUser(user) : null;
  } catch {
    req.currentUser = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ message: "Please sign in." });
    return;
  }

  next();
}

function requireManager(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ message: "Please sign in." });
    return;
  }

  if (!hasManagerAccess(req.currentUser)) {
    res.status(403).json({ message: "Manager access is required." });
    return;
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ message: "Please sign in." });
    return;
  }

  if (!isAdmin(req.currentUser)) {
    res.status(403).json({ message: "Admin access is required." });
    return;
  }

  next();
}

app.use(loadSessionUser);

app.get("/api/health", async (_req, res) => {
  await getPool().query("SELECT 1");
  res.json({ ok: true, service: "get-ready-api" });
});

registerAuthRoutes(app, {
  requireAuth,
  normalizeEmail,
  signAuthToken,
  jwtSecret,
  authTokenMaxAgeMs,
  addAuditEntry
});
registerIntegrationRoutes(app, {
  requireBopchipboardKey,
  createVehicleRecord: (options) => createVehicleRecord({ ...options, addAuditEntry })
});

app.use("/api", requireAuth);

registerAdminRoutes(app, { requireAdmin, generateTemporaryPassword, addAuditEntry });
registerVehicleRoutes(app, {
  isAdmin,
  hasManagerAccess,
  requireAdmin,
  requireManager,
  createVehicleRecord: (options) => createVehicleRecord({ ...options, addAuditEntry }),
  updateVehicleWithAudit: (vehicleId, changes, userId, actionType) => updateVehicleWithAudit(vehicleId, changes, userId, actionType, addAuditEntry),
  isStatusUndo,
  getProtectedUndoField
});
registerDashboardRoutes(app, { requireManager });

app.get("/api/meta", (_req, res) => {
  res.json({
    roles: ROLE_LABELS,
    statuses: Object.entries(STATUS_META).map(([key, meta]) => ({ key, ...meta }))
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({ message: err.message || "Unexpected server error." });
});

app.listen(port, async () => {
  await getPool().query("SELECT 1");
  console.log(`Get Ready API listening on ${port} with ${authTokenTtlDays}-day auth tokens`);
});
