import { isIdentifier, isRequestId } from "./ipc-bounded-values";
import { isDynamicRecord, isString } from "./runtime-values";

export const BROWSER_SECRET_CAPABILITY = "browser-secret-handoff";
export const BROWSER_SECRET_RESPONSE_PATH = "/v1/browser-secrets/respond";

export interface BrowserSecretRequest {
  method: "password" | "otp" | "authenticator";
  origin: string;
  digits: number;
  requiresReload?: true;
}

export type RespondToBrowserSecretInput = {
  requestId: string | number;
  agentId: string;
} & ({ decision: "submit"; secret: string } | { decision: "cancel" } | { decision: "takeover" });

export function isBrowserSecretRequest(value: unknown): value is BrowserSecretRequest {
  if (!isDynamicRecord(value) || (value.requiresReload !== undefined && value.requiresReload !== true)) return false;
  if (value.method !== "password" && value.method !== "otp" && value.method !== "authenticator") return false;
  if (!Number.isInteger(value.digits) || typeof value.digits !== "number" || value.digits < 4 || value.digits > 12)
    return false;
  if (!isString(value.origin) || value.origin.length > 2048) return false;
  try {
    const url = new URL(value.origin);
    return url.protocol === "https:" && url.origin === value.origin;
  } catch {
    return false;
  }
}

/** Never include the rejected payload in validation errors. */
export function parseBrowserSecretResponse(value: unknown): RespondToBrowserSecretInput {
  if (!isDynamicRecord(value) || !isRequestId(value.requestId) || !isIdentifier(value.agentId))
    throw new Error("Invalid secure authentication response.");
  const identity = { requestId: value.requestId, agentId: value.agentId };
  if (value.decision === "cancel" || value.decision === "takeover") return { ...identity, decision: value.decision };
  if (value.decision !== "submit" || !isString(value.secret) || value.secret.length === 0 || value.secret.length > 4096)
    throw new Error("Invalid secure authentication response.");
  return { ...identity, decision: "submit", secret: value.secret };
}
