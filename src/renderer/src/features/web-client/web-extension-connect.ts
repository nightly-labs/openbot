import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/**
 * A sign-in that the OpenBot browser extension asks for: `/app?extension=<id>&challenge=<c>&state=<s>`.
 * The extension opens it with `chrome.identity.launchWebAuthFlow`. After sign-in the person allows the
 * extension; the page gets a one-time code for the challenge and goes to the extension's own address,
 * which only that extension can read. A company sign-in leaves the page, so the request waits in the
 * tab's session storage until it ends.
 */
export interface ExtensionConnectRequest {
  extensionId: string;
  challenge: string;
  state: string;
  /**
   * The extension asks with no window (`silent=1`, `launchWebAuthFlow` not interactive). The page
   * answers at once: the code when this account allowed this extension in this browser before, else
   * that it needs the person, and the extension then opens the window.
   */
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

/** The request in this page's address, or the one that waits in this tab. The address loses the query. */
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
    } catch {
      // Without storage the request still works when no company sign-in leaves the page.
    }
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
  } catch {
    // A page without storage has no waiting request.
  }
  return null;
}

export function forgetExtensionConnect(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing waits in a page without storage.
  }
}

/** The extension's own address with the answer. `chrome.identity` hands it to the extension and closes the window. */
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

/**
 * The extensions that an account allowed in this browser, so a later sign-in of the same extension
 * needs no window. A sign-out of the extension does not clear it: the next sign-in is one click with no
 * page. The code still needs the verifier that only the extension holds.
 */
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
  } catch {
    // Without storage, the next sign-in asks again.
  }
}

export function extensionAllowedBy(extensionId: string, accountId: string): boolean {
  return readAllowed()[extensionId] === accountId;
}
