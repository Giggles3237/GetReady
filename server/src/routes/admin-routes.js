import { v4 as uuid } from "uuid";
import { asyncHandler } from "../async-handler.js";
import {
  createUser,
  getPool,
  getUser,
  getUserByEmail,
  listActionDefinitions,
  listAuditEntries,
  listNotificationRules,
  listUsers,
  listVehicles,
  replaceNotificationRulesForBucket,
  updateActionDefinition,
  updateUser
} from "../db.js";
import { ROLE_LABELS, STATUS_META } from "../workflow.js";
import { decorateAuditEntry, normalizeActionDefinition, normalizeVehicle, sanitizeUser } from "../vehicle-helpers.js";

const notificationBuckets = [...new Set(Object.values(STATUS_META).map((meta) => meta.pipeline))];

function normalizeNotificationRules(rows) {
  const rulesByBucket = new Map(notificationBuckets.map((bucket) => [bucket, []]));

  rows.forEach((row) => {
    if (!rulesByBucket.has(row.bucket) || !row.email_enabled) {
      return;
    }

    rulesByBucket.get(row.bucket).push(row.user_id);
  });

  return notificationBuckets.map((bucket) => ({
    bucket,
    user_ids: rulesByBucket.get(bucket) ?? []
  }));
}

export function registerAdminRoutes(app, {
  requireAdmin,
  addAuditEntry
}) {
  app.post("/api/admin/users", requireAdmin, asyncHandler(async (req, res) => {
    const { name, email, role } = req.body;

    if (!name || !email || !role || !ROLE_LABELS[role]) {
      return res.status(400).json({ message: "Name, email, and valid role are required." });
    }

    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: "That email is already in use." });
    }

    const newUser = {
      id: uuid(),
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role,
      password_hash: "",
      must_change_password: false,
      is_active: true
    };

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await createUser(connection, newUser);
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_user_create",
        fieldChanged: `user:${newUser.id}:created`,
        oldValue: "",
        newValue: `${newUser.name} (${newUser.role})`
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.status(201).json({
      user: sanitizeUser(await getUser(newUser.id)),
      users: (await listUsers()).map(sanitizeUser)
    });
  }));

  app.patch("/api/admin/users/:id", requireAdmin, asyncHandler(async (req, res) => {
    const { name, email, role, is_active } = req.body;
    const targetUser = await getUser(req.params.id);

    if (!targetUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const nextUser = { ...targetUser };

      if (typeof name === "string" && name.trim() && targetUser.name !== name.trim()) {
        await addAuditEntry(connection, {
          userId: req.currentUser.id,
          actionType: "admin_user_update",
          fieldChanged: `user:${targetUser.id}:name`,
          oldValue: targetUser.name,
          newValue: name.trim()
        });
        nextUser.name = name.trim();
      }

      if (typeof email === "string" && email.trim() && targetUser.email !== email.trim().toLowerCase()) {
        const existingUser = await getUserByEmail(email, connection);
        if (existingUser && existingUser.id !== targetUser.id) {
          throw Object.assign(new Error("That email is already in use."), { statusCode: 409 });
        }

        await addAuditEntry(connection, {
          userId: req.currentUser.id,
          actionType: "admin_user_update",
          fieldChanged: `user:${targetUser.id}:email`,
          oldValue: targetUser.email,
          newValue: email.trim().toLowerCase()
        });
        nextUser.email = email.trim().toLowerCase();
      }

      if (typeof role === "string" && ROLE_LABELS[role] && targetUser.role !== role) {
        await addAuditEntry(connection, {
          userId: req.currentUser.id,
          actionType: "admin_user_update",
          fieldChanged: `user:${targetUser.id}:role`,
          oldValue: targetUser.role,
          newValue: role
        });
        nextUser.role = role;
      }

      if (typeof is_active === "boolean" && Boolean(targetUser.is_active) !== is_active) {
        await addAuditEntry(connection, {
          userId: req.currentUser.id,
          actionType: "admin_user_update",
          fieldChanged: `user:${targetUser.id}:is_active`,
          oldValue: targetUser.is_active,
          newValue: is_active
        });
        nextUser.is_active = is_active;
      }

      await updateUser(connection, nextUser);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({ user: sanitizeUser(await getUser(req.params.id)), users: (await listUsers()).map(sanitizeUser) });
  }));

  app.post("/api/admin/users/:id/reset-password", requireAdmin, asyncHandler(async (_req, res) => {
    res.status(410).json({ message: "Password resets are no longer needed because users sign in with email only." });
  }));

  app.get("/api/admin/actions", requireAdmin, asyncHandler(async (_req, res) => {
    const actions = (await listActionDefinitions()).map(normalizeActionDefinition);
    res.json({ actions });
  }));

  app.patch("/api/admin/actions/:key", requireAdmin, asyncHandler(async (req, res) => {
    const { label, role, enabled } = req.body;
    const actions = (await listActionDefinitions()).map(normalizeActionDefinition);
    const action = actions.find((item) => item.key === req.params.key);

    if (!action) {
      return res.status(404).json({ message: "Action not found." });
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const nextAction = { ...action };

      if (typeof label === "string" && label.trim() && nextAction.label !== label.trim()) {
        await addAuditEntry(connection, {
          userId: req.currentUser.id,
          actionType: "admin_action_update",
          fieldChanged: `action:${action.key}:label`,
          oldValue: nextAction.label,
          newValue: label.trim()
        });
        nextAction.label = label.trim();
      }

      if (typeof role === "string" && ROLE_LABELS[role] && nextAction.role !== role) {
        await addAuditEntry(connection, {
          userId: req.currentUser.id,
          actionType: "admin_action_update",
          fieldChanged: `action:${action.key}:role`,
          oldValue: nextAction.role,
          newValue: role
        });
        nextAction.role = role;
      }

      if (typeof enabled === "boolean" && nextAction.enabled !== enabled) {
        await addAuditEntry(connection, {
          userId: req.currentUser.id,
          actionType: "admin_action_update",
          fieldChanged: `action:${action.key}:enabled`,
          oldValue: nextAction.enabled,
          newValue: enabled
        });
        nextAction.enabled = enabled;
      }

      await updateActionDefinition(connection, nextAction);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({ actions: (await listActionDefinitions()).map(normalizeActionDefinition) });
  }));

  app.get("/api/admin/notifications", requireAdmin, asyncHandler(async (_req, res) => {
    const rules = await listNotificationRules();
    res.json({
      buckets: notificationBuckets,
      rules: normalizeNotificationRules(rules)
    });
  }));

  app.patch("/api/admin/notifications/:bucket", requireAdmin, asyncHandler(async (req, res) => {
    const bucket = req.params.bucket;
    if (!notificationBuckets.includes(bucket)) {
      return res.status(404).json({ message: "Notification bucket not found." });
    }

    const requestedUserIds = Array.isArray(req.body.user_ids) ? req.body.user_ids.map(String) : [];
    const users = await listUsers();
    const validUserIds = new Set(users.filter((user) => user.is_active).map((user) => user.id));
    const userIds = [...new Set(requestedUserIds)].filter((userId) => validUserIds.has(userId));
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await replaceNotificationRulesForBucket(connection, bucket, userIds);
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_notification_update",
        fieldChanged: `notification:${bucket}:email_recipients`,
        oldValue: "",
        newValue: userIds.join(",")
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({
      buckets: notificationBuckets,
      rules: normalizeNotificationRules(await listNotificationRules())
    });
  }));

  app.get("/api/admin/audit", requireAdmin, asyncHandler(async (req, res) => {
    const { vehicleId, limit = 100 } = req.query;
    const [users, vehicles, entries] = await Promise.all([
      listUsers(),
      listVehicles(),
      listAuditEntries({ vehicleId, limit: Number(limit) })
    ]);

    const usersById = new Map(users.map((user) => [user.id, sanitizeUser(user)]));
    const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, normalizeVehicle(vehicle)]));

    res.json({
      audit: entries.map((entry) => decorateAuditEntry(entry, usersById, vehiclesById))
    });
  }));
}
