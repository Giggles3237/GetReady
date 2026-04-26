import bcrypt from "bcryptjs";
import { getUser, getUserByEmail, getPool, updateUserPassword } from "../db.js";
import { sanitizeUser } from "../vehicle-helpers.js";

export function registerAuthRoutes(app, { requireAuth, normalizeEmail, signAuthToken, jwtSecret, authTokenMaxAgeMs, addAuditEntry }) {
  app.post("/api/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = await getUserByEmail(email);
    if (!user || !user.is_active) {
      return res.status(401).json({ message: "Invalid email." });
    }

    res.json({
      token: signAuthToken(user, jwtSecret, authTokenMaxAgeMs),
      user: sanitizeUser(user)
    });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: req.currentUser });
  });

  app.patch("/api/auth/change-password", requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ message: "Current password and a new password of at least 8 characters are required." });
    }

    const authUser = await getUserByEmail(req.currentUser.email);
    const validPassword = authUser?.password_hash ? await bcrypt.compare(currentPassword, authUser.password_hash) : false;

    if (!validPassword) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await updateUserPassword(connection, {
        id: req.currentUser.id,
        password_hash: await bcrypt.hash(newPassword, 10),
        must_change_password: false
      });
      await addAuditEntry(connection, {
        userId: req.currentUser.id,
        actionType: "password_change",
        fieldChanged: `user:${req.currentUser.id}:password`,
        oldValue: "",
        newValue: "updated"
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({ user: sanitizeUser(await getUser(req.currentUser.id)) });
  });
}
