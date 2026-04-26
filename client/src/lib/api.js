import { Capacitor } from "@capacitor/core";
import { getStoredAuth } from "./auth";

const isNativeApp = Capacitor.isNativePlatform();
const apiUrlCandidates = resolveApiUrlCandidates();
let preferredApiUrl = apiUrlCandidates[0] ?? "/api";

function resolveApiUrlCandidates() {
  const explicitWebApiUrl = import.meta.env.VITE_API_URL;
  const explicitNativeApiUrl = import.meta.env.VITE_CAPACITOR_API_URL;

  const candidates = isNativeApp
    ? [explicitNativeApiUrl, explicitWebApiUrl, "/api"]
    : ["/api", explicitWebApiUrl];

  return [...new Set(
    candidates
      .filter(Boolean)
      .map((value) => String(value).replace(/\/$/, ""))
  )];
}

export async function request(path, options = {}) {
  const orderedBaseUrls = [
    preferredApiUrl,
    ...apiUrlCandidates.filter((candidate) => candidate !== preferredApiUrl)
  ];
  let lastError = new Error("Unable to reach the server.");

  for (const baseUrl of orderedBaseUrls) {
    let response;

    try {
      const { token } = getStoredAuth();
      response = await fetch(`${baseUrl}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers ?? {})
        },
        ...options
      });
    } catch {
      lastError = new Error("Unable to reach the server.");
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      lastError = new Error("The app reached a web page instead of the API.");
      continue;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({ message: response.status ? `Request failed (${response.status}).` : "Request failed." }));
      lastError = new Error(data.message || "Request failed.");
      if (response.status === 404 || response.status >= 500) {
        continue;
      }
      throw lastError;
    }

    preferredApiUrl = baseUrl;
    return response.json().catch(() => ({}));
  }

  throw lastError;
}
