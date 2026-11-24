import type { CentralAuthIssue, CentralAuthUser } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { currentText } from "@openbot/ui/text";
import { decodeUser, deviceId, type ExtensionSession } from "./extension-storage";

export const ACCOUNT_API_URL = import.meta.env.VITE_OPENBOT_API_URL;

const REQUEST_TIMEOUT_MS = 20_000;
const DEVICE_NAME = "Chrome extension";

export class SignInIssue extends Error {
  constructor(readonly issue: CentralAuthIssue) {
    super(issue.message);
  }
}

export interface EmailChallenge {
  challengeId: string;
  resendAt: number;
  expiresAt: number;
  developmentCode?: string;
}

async function accountRequest(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: object; token?: string; idempotencyKey?: string },
): Promise<{ response: Response; body: DynamicRecord | null }> {
  const response = await fetch(`${ACCOUNT_API_URL}${path}`, {
    method: init.method,
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { response, body: await readBody(response) };
}

async function readBody(response: Response): Promise<DynamicRecord | null> {
  try {
    const body = await response.json();
    return isDynamicRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function issueFrom(response: Response, body: DynamicRecord | null): CentralAuthIssue {
  const error = isDynamicRecord(body?.error) ? body.error : null;
  const code = error && isString(error.code) ? error.code : "sign_in_failed";
  if (code === "company_sign_in_required")
    return { code, message: currentText().t("extension.signIn.companyUnsupported") };
  const retryAfterSeconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  return {
    code,
    message: error && isString(error.message) ? error.message : currentText().t("extension.signIn.failed"),
    ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
  };
}

export async function startEmailSignIn(email: string, idempotencyKey: string): Promise<EmailChallenge> {
  const { response, body } = await accountRequest("/v1/auth/email/start", {
    method: "POST",
    body: { email },
    idempotencyKey,
  });
  if (!response.ok) throw new SignInIssue(issueFrom(response, body));
  if (!body || !isString(body.challengeId) || typeof body.resendAt !== "number")
    throw new Error(currentText().t("extension.signIn.failed"));
  return {
    challengeId: body.challengeId,
    resendAt: body.resendAt,
    expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : Date.now() + 600_000,
    ...(isString(body.developmentCode) ? { developmentCode: body.developmentCode } : {}),
  };
}

export async function verifyEmailCode(
  challengeId: string,
  code: string,
  referralCode: string | undefined,
): Promise<ExtensionSession> {
  const { response, body } = await accountRequest("/v1/mobile-auth/email/verify", {
    method: "POST",
    body: {
      challengeId,
      code,
      deviceId: await deviceId(),
      deviceName: DEVICE_NAME,
      platform: "unknown",
      ...(referralCode ? { referralCode } : {}),
    },
  });
  if (!response.ok) throw new SignInIssue(issueFrom(response, body));
  const user = decodeUser(body?.user);
  if (!body || !isString(body.sessionToken) || body.sessionToken.length > 512 || !user)
    throw new Error(currentText().t("extension.signIn.failed"));
  return { token: body.sessionToken, user };
}

export async function readAccount(token: string): Promise<CentralAuthUser | null> {
  const { response, body } = await accountRequest("/v1/mobile-auth/session", { method: "GET", token });
  if (response.status === 401) return null;
  const user = response.ok ? decodeUser(body) : null;
  if (!user) throw new Error(currentText().t("extension.signIn.sessionFailed"));
  return user;
}

export async function endSession(token: string): Promise<void> {
  await accountRequest("/v1/mobile-auth/session", { method: "DELETE", token }).catch(() => undefined);
}

const WEB_URL = import.meta.env.VITE_OPENBOT_WEB_URL;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function randomToken(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const SILENT_MS = 15_000;

export async function signInWithWeb(): Promise<ExtensionSession> {
  const silent = await webCode(true).catch(() => null);
  return exchangeCode(silent ?? (await webCode(false)));
}

async function webCode(silent: boolean): Promise<{ code: string; verifier: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const state = randomToken(24);
  const start = new URL("/app", WEB_URL);
  start.searchParams.set("extension", chrome.runtime.id);
  start.searchParams.set("challenge", base64Url(new Uint8Array(digest)));
  start.searchParams.set("state", state);
  if (silent) start.searchParams.set("silent", "1");
  const cancelled = () =>
    new SignInIssue({ code: "sign_in_cancelled", message: currentText().t("extension.signIn.cancelled") });
  const finished = await chrome.identity
    .launchWebAuthFlow(
      silent
        ? {
            url: start.toString(),
            interactive: false,
            abortOnLoadForNonInteractive: false,
            timeoutMsForNonInteractive: SILENT_MS,
          }
        : { url: start.toString(), interactive: true },
    )
    .catch(() => {
      throw cancelled();
    });
  const answer = finished ? new URL(finished) : null;
  const code = answer?.searchParams.get("code");
  if (!answer || answer.searchParams.get("state") !== state || !code) throw cancelled();
  return { code, verifier };
}

async function exchangeCode({ code, verifier }: { code: string; verifier: string }): Promise<ExtensionSession> {
  const { response, body } = await accountRequest("/v1/mobile-auth/company/exchange", {
    method: "POST",
    body: { code, codeVerifier: verifier, deviceId: await deviceId(), deviceName: DEVICE_NAME, platform: "unknown" },
  });
  if (!response.ok) throw new SignInIssue(issueFrom(response, body));
  const user = decodeUser(body?.user);
  if (!body || !isString(body.sessionToken) || body.sessionToken.length > 512 || !user)
    throw new Error(currentText().t("extension.signIn.failed"));
  return { token: body.sessionToken, user };
}
