import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { getStoredAuth, persistAuth } from "../lib/auth";

export function useSession() {
  const initialAuth = getStoredAuth();
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(initialAuth.user);
  const [loginForm, setLoginForm] = useState({ email: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    async function syncSession() {
      const { token } = getStoredAuth();
      if (!token) {
        setAuthUser(null);
        setAuthReady(true);
        return;
      }

      try {
        const data = await request("/auth/me");
        setAuthUser(data.user);
        persistAuth({ token, user: data.user });
      } catch {
        persistAuth(null);
        setAuthUser(null);
      } finally {
        setAuthReady(true);
      }
    }

    syncSession();
  }, []);

  async function handleLogin(event) {
    event.preventDefault();

    try {
      setError("");
      const normalizedEmail = loginForm.email.trim().toLowerCase();
      const data = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail })
      });
      persistAuth({ token: data.token, user: data.user });
      setAuthUser(data.user);
      setLoginForm({ email: "" });
    } catch (err) {
      setError(err.message);
    }
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

  async function handleLogout(resetAppState) {
    try {
      await request("/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // Clear local auth even if the server cannot be reached.
    }

    persistAuth(null);
    setAuthUser(null);
    setError("");
    resetAppState();
  }

  return {
    authReady,
    authUser,
    loginForm,
    setLoginForm,
    passwordForm,
    setPasswordForm,
    error,
    handleLogin,
    handlePasswordChange,
    handleLogout
  };
}
