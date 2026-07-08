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
  const rulesByBucket = new Map(notificationBuckets.map((bucket) => [bucket, { email_user_ids: [], sms_user_ids: [] }]));

  rows.forEach((row) => {
    if (!rulesByBucket.has(row.bucket)) {
      return;
    }

    if (row.email_enabled) {
      rulesByBucket.get(row.bucket).email_user_ids.push(row.user_id);
    }

    if (row.sms_enabled) {
      rulesByBucket.get(row.bucket).sms_user_ids.push(row.user_id);
    }
  });

  return notificationBuckets.map((bucket) => {
    const rule = rulesByBucket.get(bucket) ?? { email_user_ids: [], sms_user_ids: [] };
    return {
      bucket,
      user_ids: rule.email_user_ids,
      email_user_ids: rule.email_user_ids,
      sms_user_ids: rule.sms_user_ids
    };
  });
}

function normalizeMobilePhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (raw.startsWith("+") && digits.length >= 8) {
    return `+${digits}`;
  }

  return raw;
}

export function registerAdminRoutes(app, {
  requireAdmin,
  addAuditEntry
}) {
  app.post("/api/admin/users", requireAdmin, asyncHandler(async (req, res) => {
    const { name, email, role } = req.body;
    const mobilePhone = normalizeMobilePhone(req.body.mobile_phone);
    const smsEnabled = Boolean(req.body.sms_enabled) && Boolean(mobilePhone);

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
      mobile_phone: mobilePhone,
      sms_enabled: smsEnabled,
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
    const { name, email, role, is_active, sms_enabled } = req.body;
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

      if (Object.prototype.hasOwnProperty.call(req.body, "mobile_phone")) {
        const nextMobilePhone = normalizeMobilePhone(req.body.mobile_phone);
        if (String(targetUser.mobile_phone ?? "") !== nextMobilePhone) {
          await addAuditEntry(connection, {
            userId: req.currentUser.id,
            actionType: "admin_user_update",
            fieldChanged: `user:${targetUser.id}:mobile_phone`,
            oldValue: targetUser.mobile_phone ?? "",
            newValue: nextMobilePhone
          });
          nextUser.mobile_phone = nextMobilePhone;

          if (!nextMobilePhone && Boolean(nextUser.sms_enabled)) {
            await addAuditEntry(connection, {
              userId: req.currentUser.id,
              actionType: "admin_user_update",
              fieldChanged: `user:${targetUser.id}:sms_enabled`,
              oldValue: nextUser.sms_enabled,
              newValue: false
            });
            nextUser.sms_enabled = false;
          }
        }
      }

      if (typeof sms_enabled === "boolean") {
        const nextSmsEnabled = sms_enabled && Boolean(nextUser.mobile_phone || targetUser.mobile_phone);
        if (Boolean(targetUser.sms_enabled) !== nextSmsEnabled) {
          await addAuditEntry(connection, {
            userId: req.currentUser.id,
            actionType: "admin_user_update",
            fieldChanged: `user:${targetUser.id}:sms_enabled`,
            oldValue: targetUser.sms_enabled,
            newValue: nextSmsEnabled
          });
          nextUser.sms_enabled = nextSmsEnabled;
        }
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

    const requestedEmailUserIds = Array.isArray(req.body.email_user_ids)
      ? req.body.email_user_ids.map(String)
      : Array.isArray(req.body.user_ids)
        ? req.body.user_ids.map(String)
        : [];
    const requestedSmsUserIds = Array.isArray(req.body.sms_user_ids) ? req.body.sms_user_ids.map(String) : [];
    const users = await listUsers();
    const validUserIds = new Set(users.filter((user) => user.is_active).map((user) => user.id));
    const smsCapableUserIds = new Set(users.filter((user) => user.is_active && user.sms_enabled && user.mobile_phone).map((user) => user.id));
    const emailUserIds = [...new Set(requestedEmailUserIds)].filter((userId) => validUserIds.has(userId));
    const smsUserIds = [...new Set(requestedSmsUserIds)].filter((userId) => smsCapableUserIds.has(userId));
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await replaceNotificationRulesForBucket(connection, bucket, { emailUserIds, smsUserIds });
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_notification_update",
        fieldChanged: `notification:${bucket}:recipients`,
        oldValue: "",
        newValue: `email:${emailUserIds.join(",")};sms:${smsUserIds.join(",")}`
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
