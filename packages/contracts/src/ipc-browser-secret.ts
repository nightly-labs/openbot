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

/**
 * The response of the desktop app or the web client. `saveToVault` keeps a submitted password in the
 * Vault of the server that runs the agent. The released Team API route carries only the released
 * fields; a joined server gets the save on the `browser-secret-vault-v1` route.
 */
export type LocalBrowserSecretResponse = RespondToBrowserSecretInput & { saveToVault?: true };

/** Never include the rejected payload in validation errors. */
export function parseLocalBrowserSecretResponse(value: unknown): LocalBrowserSecretResponse {
  const parsed = parseBrowserSecretResponse(value);
  if (!isDynamicRecord(value) || value.saveToVault === undefined) return parsed;
  if (value.saveToVault !== true || parsed.decision !== "submit")
    throw new Error("Invalid secure authentication response.");
  return { ...parsed, saveToVault: true };
}

/** The released fields of a response, for a remote server. */
export function remoteBrowserSecretResponse(input: LocalBrowserSecretResponse): RespondToBrowserSecretInput {
  const identity = { requestId: input.requestId, agentId: input.agentId };
  return input.decision === "submit"
    ? { ...identity, decision: "submit", secret: input.secret }
    : { ...identity, decision: input.decision };
}
