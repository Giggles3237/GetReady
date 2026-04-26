import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import {
  createUser,
  getPool,
  getUser,
  getUserByEmail,
  listActionDefinitions,
  listAuditEntries,
  listUsers,
  listVehicles,
  updateActionDefinition,
  updateUser,
  updateUserPassword
} from "../db.js";
import { ROLE_LABELS } from "../workflow.js";
import { decorateAuditEntry, normalizeActionDefinition, normalizeVehicle, sanitizeUser } from "../vehicle-helpers.js";

export function registerAdminRoutes(app, {
  requireAdmin,
  generateTemporaryPassword,
  addAuditEntry
}) {
  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    const { name, email, role } = req.body;

    if (!name || !email || !role || !ROLE_LABELS[role]) {
      return res.status(400).json({ message: "Name, email, and valid role are required." });
    }

    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: "That email is already in use." });
    }

    const temporaryPassword = generateTemporaryPassword();
    const newUser = {
      id: uuid(),
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role,
      password_hash: await bcrypt.hash(temporaryPassword, 10),
      must_change_password: true,
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
      temporaryPassword,
      users: (await listUsers()).map(sanitizeUser)
    });
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
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
  });

  app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
    const targetUser = await getUser(req.params.id);

    if (!targetUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const temporaryPassword = generateTemporaryPassword();
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await updateUserPassword(connection, {
        id: targetUser.id,
        password_hash: await bcrypt.hash(temporaryPassword, 10),
        must_change_password: true
      });
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "admin_password_reset",
        fieldChanged: `user:${targetUser.id}:password_reset`,
        oldValue: "",
        newValue: "temporary password issued"
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({ temporaryPassword });
  });

  app.get("/api/admin/actions", requireAdmin, async (_req, res) => {
    const actions = (await listActionDefinitions()).map(normalizeActionDefinition);
    res.json({ actions });
  });

  app.patch("/api/admin/actions/:key", requireAdmin, async (req, res) => {
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
  });

  app.get("/api/admin/audit", requireAdmin, async (req, res) => {
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
  });
}
