const AUTH_STORAGE_KEY = "getready.auth";

export function getStoredAuth() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return { token: "", user: null };
    }

    const parsed = JSON.parse(raw);
    return {
      token: typeof parsed?.token === "string" ? parsed.token : "",
      user: parsed?.user ?? null
    };
  } catch {
    return { token: "", user: null };
  }
}

export function persistAuth(auth) {
  if (!auth?.token || !auth?.user) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}
