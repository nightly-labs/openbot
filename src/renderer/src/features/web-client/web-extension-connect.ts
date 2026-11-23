import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

export interface ExtensionConnectRequest {
  extensionId: string;
  challenge: string;
  state: string;
  silent: boolean;
}

const STORAGE_KEY = "openbot.web.extension-connect";
const REQUEST_LIFE_MS = 10 * 60_000;
const EXTENSION_ID = /^[a-p]{32}$/u;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/u;

function decodeRequest(value: unknown): ExtensionConnectRequest | null {
  if (!isDynamicRecord(value)) return null;
  const { extensionId, challenge, state } = value;
  if (!isString(extensionId) || !isString(challenge) || !isString(state)) return null;
  if (!EXTENSION_ID.test(extensionId) || !TOKEN.test(challenge) || !TOKEN.test(state)) return null;
  return { extensionId, challenge, state, silent: value.silent === true };
}

export function takeExtensionConnect(): ExtensionConnectRequest | null {
  const url = new URL(window.location.href);
  const fromUrl = decodeRequest({
    extensionId: url.searchParams.get("extension"),
    challenge: url.searchParams.get("challenge"),
    state: url.searchParams.get("state"),
    silent: url.searchParams.get("silent") === "1",
  });
  if (fromUrl) {
    for (const name of ["extension", "challenge", "state", "silent"]) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", url);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...fromUrl, until: Date.now() + REQUEST_LIFE_MS }));
    } catch {}
    return fromUrl;
  }
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const value = JSON.parse(saved);
    const request = decodeRequest(value);
    if (request && isDynamicRecord(value) && typeof value.until === "number" && value.until > Date.now())
      return request;
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
  return null;
}

export function forgetExtensionConnect(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function extensionReturnUrl(
  request: ExtensionConnectRequest,
  answer: { code: string } | { error: "access_denied" | "login_required" | "consent_required" },
): string {
  const url = new URL(`https://${request.extensionId}.chromiumapp.org/`);
  url.searchParams.set("state", request.state);
  if ("code" in answer) url.searchParams.set("code", answer.code);
  else url.searchParams.set("error", answer.error);
  return url.toString();
}

const ALLOWED_KEY = "openbot.web.extension-allowed.v1";

function readAllowed(): Record<string, string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(ALLOWED_KEY) ?? "{}");
    if (!isDynamicRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => isString(entry[1])));
  } catch {
    return {};
  }
}

export function rememberExtensionAllowed(extensionId: string, accountId: string): void {
  try {
    window.localStorage.setItem(ALLOWED_KEY, JSON.stringify({ ...readAllowed(), [extensionId]: accountId }));
  } catch {}
}

export function extensionAllowedBy(extensionId: string, accountId: string): boolean {
  return readAllowed()[extensionId] === accountId;
}
