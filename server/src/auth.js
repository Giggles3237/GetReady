import crypto from "crypto";

export function buildAllowedOrigins() {
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost"
  ];
  const configured = String(process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return [...new Set([...configured, ...defaults])];
  }

  return defaults;
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

export function signAuthToken(user, jwtSecret, authTokenMaxAgeMs) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user.id,
    email: normalizeEmail(user.email),
    role: user.role,
    name: user.name,
    exp: Math.floor((Date.now() + authTokenMaxAgeMs) / 1000)
  };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token, jwtSecret) {
  const [encodedHeader, encodedPayload, signature] = String(token || "").split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Malformed token.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (signature !== expectedSignature) {
    throw new Error("Invalid token signature.");
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload));
  if (!payload?.sub || !payload?.exp || payload.exp * 1000 <= Date.now()) {
    throw new Error("Token expired.");
  }

  return payload;
}
