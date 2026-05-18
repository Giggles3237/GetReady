import { asyncHandler } from "../async-handler.js";
import { getUserByEmail } from "../db.js";
import { sanitizeUser } from "../vehicle-helpers.js";

export function registerAuthRoutes(app, { requireAuth, normalizeEmail, signAuthToken, jwtSecret, authTokenMaxAgeMs }) {
  app.post("/api/auth/login", asyncHandler(async (req, res) => {
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
  }));

  app.post("/api/auth/logout", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: req.currentUser });
  });

  app.patch("/api/auth/change-password", requireAuth, (_req, res) => {
    res.status(410).json({ message: "Password changes are no longer required. Please refresh and sign in with your email." });
  });
}
