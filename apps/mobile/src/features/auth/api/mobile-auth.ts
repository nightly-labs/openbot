import { type AvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { OPENBOT_CONTROL_PLANE_ORIGIN } from "@openbot/contracts/invite-links";
import type { CentralAuthUser } from "@openbot/contracts/ipc";
import {
  isMobileConnectDevelopmentHost,
  isMobileConnectHostBinding,
  type MobileConnectHostBinding,
  parseMobileConnectUrl,
  validateMobileConnectHostBinding,
} from "@openbot/contracts/mobile-connect";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress, normalizeOneTimeCode, validateProfileName } from "@openbot/contracts/validation";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { currentText } from "@/shared/lib/text";
import * as LockedKeychain from "../../../shared/lib/locked-keychain";
// Relative: the Node test project resolves no `@/` path that the test does not mock.
import { fetch } from "../../support/model/logged-fetch";

const MOBILE_SESSION_KEY = "openbot.mobile.session.v1";
const MOBILE_REVOCATIONS_KEY = "openbot.mobile.pending-revocations.v1";
const MOBILE_DEVICE_ID_KEY = "openbot.mobile.device-id.v1";
const MOBILE_AUTH_REQUEST_TIMEOUT_MS = 10_000;
// The account server can try to send a code for up to 25 s. Desktop waits 35 s too.
const MOBILE_EMAIL_CODE_REQUEST_TIMEOUT_MS = 35_000;

let mobileSessionStorageTail = Promise.resolve();
let mobileProfileTail = Promise.resolve();
let mobileConnectInFlight = false;

export class MobileSessionExpiredError extends Error {
  constructor() {
    super(currentText().t("mobile.auth.error.sessionEnded"));
  }
}

export interface MobileSession {
  apiUrl: string;
  sessionToken: string;
  user: CentralAuthUser;
  /** The desktop whose QR code signed the phone in. An email sign-in has no host. */
  host?: MobileConnectHostBinding;
  /**
   * Set when an email code signed the phone in. A stored session with no host and no marker is a
   * legacy QR session, which is revoked and never restored.
   */
  signIn?: "email";
}

type MobileCredential = Pick<MobileSession, "apiUrl" | "sessionToken">;

export async function redeemMobileConnectUrl(value: string): Promise<MobileSession> {
  if (mobileConnectInFlight) throw new Error(currentText().t("mobile.auth.error.connectionInProgress"));
  mobileConnectInFlight = true;
  try {
    return await redeemMobileConnectSession(value);
  } finally {
    mobileConnectInFlight = false;
  }
}

async function redeemMobileConnectSession(value: string): Promise<MobileSession> {
  void retryMobileSessionRevocations();
  const payload = parseMobileConnectUrl(value);
  if (!payload) {
    throw new Error(currentText().t("mobile.auth.error.invalidCode"));
  }
  if (!payload.host) throw new Error(currentText().t("mobile.auth.error.codeOutdated"));

  // Do not consume a one-time ticket or overwrite a permanent legacy token before
  // its revocation is confirmed. Retry cleanup against the OLD account service.
  const current = await serializeMobileSessionStorage(() => readStoredSessionAndRevokeInvalid(true));
  // A QR screen can still be finishing its animation after credentials are saved.
  // Protect that handoff too, before its caller updates the React session context.
  if (current) throw new Error(currentText().t("mobile.auth.error.alreadySignedIn"));

  let response: Response;
  let body: unknown;
  try {
    const device = await mobileDeviceIdentity();
    ({ response, body } = await withMobileAuthRequestTimeout(async (signal) => {
      const request = await fetch(new URL("/v1/mobile-auth/redeem", payload.apiUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: payload.ticket,
          deviceId: device.id,
          deviceName: device.name,
          platform: device.platform,
        }),
        signal,
      });
      return { response: request, body: await readResponseBody(request, signal) };
    }));
  } catch {
    const apiUrl = new URL(payload.apiUrl);
    throw new Error(
      apiUrl.protocol === "http:" && isMobileConnectDevelopmentHost(apiUrl.hostname)
        ? currentText().t("mobile.auth.error.desktopUnreachable")
        : currentText().t("mobile.auth.error.accountServiceUnreachable"),
    );
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(body) ?? currentText().t("mobile.auth.error.codeExpired"));
  }

  const session = decodeMobileSession(body, payload.apiUrl, false);
  session.host = validateMobileConnectHostBinding(payload.host, session.host);
  await saveMobileSession(session);
  return session;
}

/** The account service for email sign-in. A development build can name a local one. */
function mobileAccountApiUrl(): string {
  const override = process.env.EXPO_PUBLIC_OPENBOT_API_URL;
  return (override && __DEV__ && normalizeAccountApiUrl(override)) || OPENBOT_CONTROL_PLANE_ORIGIN;
}

export interface MobileEmailChallenge {
  challengeId: string;
  email: string;
  resendAt: number;
  /** Only a development account service sends it. */
  developmentCode?: string;
}

/** A failed email sign-in step. `code` is the account service error code. */
export class MobileEmailSignInError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Sends a sign-in code. Use the same `requestId` again to check the delivery of the same code. */
export async function startMobileEmailSignIn(email: string, requestId: string): Promise<MobileEmailChallenge> {
  const text = currentText();
  const address = normalizeEmailAddress(email);
  if (!address) throw new MobileEmailSignInError(text.t("mobile.auth.email.error.invalidEmail"), "invalid_email");
  const { response, body } = await mobileEmailRequest(
    "/v1/auth/email/start",
    { email: address },
    { "Idempotency-Key": requestId },
    MOBILE_EMAIL_CODE_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw mobileEmailError(response, body, "mobile.auth.email.error.sendFailed");
  if (!isDynamicRecord(body) || !isString(body.challengeId) || typeof body.resendAt !== "number") {
    throw new MobileEmailSignInError(text.t("mobile.auth.email.error.sendFailed"), "invalid_response");
  }
  return {
    challengeId: body.challengeId,
    email: address,
    resendAt: body.resendAt,
    ...(isString(body.developmentCode) ? { developmentCode: body.developmentCode } : {}),
  };
}

/** Verifies the code and saves the new session. The session is a mobile session with no host. */
export async function verifyMobileEmailCode(challengeId: string, code: string): Promise<MobileSession> {
  if (mobileConnectInFlight) throw new Error(currentText().t("mobile.auth.error.connectionInProgress"));
  mobileConnectInFlight = true;
  try {
    const normalized = normalizeOneTimeCode(code);
    if (!normalized) {
      throw new MobileEmailSignInError(
        currentText().t("mobile.auth.email.error.codeIncorrect"),
        "invalid_sign_in_code",
      );
    }
    void retryMobileSessionRevocations();
    const current = await serializeMobileSessionStorage(() => readStoredSessionAndRevokeInvalid(true));
    if (current) throw new Error(currentText().t("mobile.auth.error.alreadySignedIn"));
    const device = await mobileDeviceIdentity();
    const apiUrl = mobileAccountApiUrl();
    const { response, body } = await mobileEmailRequest("/v1/mobile-auth/email/verify", {
      challengeId,
      code: normalized,
      deviceId: device.id,
      deviceName: device.name,
      platform: device.platform,
    });
    if (!response.ok) throw mobileEmailError(response, body, "mobile.auth.email.error.verifyFailed");
    const session = decodeMobileSession(body, apiUrl, true);
    await saveMobileSession(session);
    return session;
  } finally {
    mobileConnectInFlight = false;
  }
}

async function mobileEmailRequest(
  path: string,
  payload: Record<string, string>,
  headers: Record<string, string> = {},
  timeoutMs?: number,
): Promise<{ response: Response; body: DynamicRecord | null }> {
  try {
    return await withMobileAuthRequestTimeout(
      async (signal) => {
        const request = await fetch(new URL(path, mobileAccountApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
          signal,
        });
        return { response: request, body: await readResponseBody(request, signal) };
      },
      undefined,
      timeoutMs,
    );
  } catch {
    throw new MobileEmailSignInError(
      currentText().t("mobile.auth.error.accountServiceUnreachable"),
      "auth_api_unavailable",
    );
  }
}

const EMAIL_SIGN_IN_ERRORS = new Map<string, MobileTextKey>([
  ["invalid_email", "mobile.auth.email.error.invalidEmail"],
  ["code_recently_sent", "mobile.auth.email.error.wait"],
  ["rate_limited", "mobile.auth.email.error.wait"],
  ["email_delivery_rate_limited", "mobile.auth.email.error.wait"],
  ["email_delivery_pending", "mobile.auth.email.error.deliveryUnconfirmed"],
  ["email_delivery_timeout", "mobile.auth.email.error.deliveryUnconfirmed"],
  ["email_delivery_unknown", "mobile.auth.email.error.deliveryUnconfirmed"],
  ["invalid_sign_in_code", "mobile.auth.email.error.codeIncorrect"],
  ["sign_in_code_expired", "mobile.auth.email.error.codeExpired"],
  ["too_many_code_attempts", "mobile.auth.email.error.tooManyAttempts"],
]);

function mobileEmailError(
  response: Response,
  body: DynamicRecord | null,
  fallback: MobileTextKey,
): MobileEmailSignInError {
  const code = isDynamicRecord(body?.error) && isString(body.error.code) ? body.error.code : "";
  const key = EMAIL_SIGN_IN_ERRORS.get(code) ?? fallback;
  const retryAfter = Number(response.headers.get("Retry-After"));
  return new MobileEmailSignInError(
    currentText().t(key),
    code,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

export async function readMobileSession(): Promise<MobileSession | null> {
  void retryMobileSessionRevocations();
  return serializeMobileSessionStorage(() => readStoredSessionAndRevokeInvalid(false));
}

// Called only inside the storage queue. Invalid sessions are never returned to
// the workspace, even offline. Retain their encrypted credential solely for
// revocation retries on startup or before the next QR redemption; these tokens
// deliberately never expire and must not be silently discarded or overwritten.
async function readStoredSessionAndRevokeInvalid(requireRevocation: boolean): Promise<MobileSession | null> {
  const stored = await LockedKeychain.getItemAsync(MOBILE_SESSION_KEY);
  if (!stored) return null;
  // A keychain that the lock keeps closed does not make the session invalid. Only the stored data can.
  const storedRevocations = await LockedKeychain.getItemAsync(MOBILE_REVOCATIONS_KEY);
  let credential: MobileCredential | null = null;
  try {
    const value = JSON.parse(stored);
    credential = decodeStoredMobileCredential(value);
    const storedCredential = credential;
    if (decodePendingRevocations(storedRevocations).some((pending) => sameCredential(pending, storedCredential))) {
      await LockedKeychain.deleteItemAsync(MOBILE_SESSION_KEY);
      return null;
    }
    return decodeStoredMobileSession(value);
  } catch {
    if (credential) {
      try {
        await revokeMobileCredential(credential);
      } catch {
        if (requireRevocation) {
          throw new Error(currentText().t("mobile.auth.error.revokePreviousFailed"));
        }
        return null;
      }
    }
    await LockedKeychain.deleteItemAsync(MOBILE_SESSION_KEY);
    return null;
  }
}

export function validateMobileSession(
  session: MobileSession,
  onValidated?: (validated: MobileSession | null) => void,
): Promise<MobileSession | null> {
  void retryMobileSessionRevocations();
  return serializeMobileProfile(async () => {
    const validated = await refreshMobileProfile(session);
    onValidated?.(validated);
    return validated;
  });
}

async function refreshMobileProfile(session: MobileSession): Promise<MobileSession | null> {
  const { response, body } = await withMobileAuthRequestTimeout(async (signal) => {
    const request = await fetch(new URL("/v1/mobile-auth/session", session.apiUrl).toString(), {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
      signal,
    });
    return { response: request, body: await readResponseBody(request, signal) };
  });
  if (response.status === 401) {
    await deleteMobileSessionIfCurrent(session.sessionToken);
    return null;
  }
  if (!response.ok) {
    throw new Error(apiErrorMessage(body) ?? currentText().t("mobile.auth.error.verifyFailed"));
  }
  const user = decodeUser(body);
  if (user.id !== session.user.id) throw new Error("The account service returned an invalid user.");
  const updated = sameUser(user, session.user) ? session : { ...session, user };
  await saveMobileSessionIfCurrent(updated);
  return updated;
}

const accountSessionSchema = z.object({
  sessionId: z.string().uuid(),
  name: z.string(),
  kind: z.enum(["desktop", "mobile"]),
  current: z.boolean(),
  connectedAt: z.number().finite(),
  lastActiveAt: z.number().finite(),
  hostedServer: z.boolean().optional(),
});
export type MobileAccountSession = z.infer<typeof accountSessionSchema>;

export async function listMobileAccountSessions(
  session: MobileSession,
  signal?: AbortSignal,
): Promise<MobileAccountSession[]> {
  return withMobileAuthRequestTimeout(async (signal) => {
    const response = await fetch(new URL("/v1/mobile-auth/devices?includeDesktop=true", session.apiUrl).toString(), {
      headers: { Authorization: `Bearer ${session.sessionToken}` },
      signal,
    });
    await checkMobileAuthorization(response, session);
    if (!response.ok) throw new Error(currentText().t("mobile.auth.error.sessionsLoadFailed"));
    return z.object({ sessions: z.array(accountSessionSchema) }).parse(await response.json()).sessions;
  }, signal);
}

export async function revokeMobileAccountSession(session: MobileSession, target: MobileAccountSession): Promise<void> {
  if (target.current) throw new Error(currentText().t("mobile.auth.error.useSignOut"));
  if (target.kind === "desktop") throw new Error(currentText().t("mobile.auth.error.desktopSession"));
  await withMobileAuthRequestTimeout(async (signal) => {
    const response = await fetch(
      new URL(
        `/v1/mobile-auth/devices/${encodeURIComponent(target.sessionId)}?includeDesktop=true`,
        session.apiUrl,
      ).toString(),
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.sessionToken}` },
        signal,
      },
    );
    await checkMobileAuthorization(response, session);
    if (!response.ok) throw new Error(currentText().t("mobile.auth.error.disconnectFailed"));
  });
}

export type MobileProfileChange = { name: string } | { avatar: { bytes: Uint8Array; mimeType: AvatarMimeType } | null };

export function updateMobileProfile(
  session: MobileSession,
  change: MobileProfileChange,
  onUpdated?: (updated: MobileSession) => void,
): Promise<MobileSession> {
  return serializeMobileProfile(async () => {
    const updated = await writeMobileProfile(session, change);
    onUpdated?.(updated);
    return updated;
  });
}

async function writeMobileProfile(session: MobileSession, change: MobileProfileChange): Promise<MobileSession> {
  if ("name" in change && validateProfileName(change.name).error) {
    throw new Error(currentText().t("mobile.auth.error.nameLength"));
  }
  if ("avatar" in change && change.avatar) {
    if (change.avatar.bytes.byteLength > AVATAR_IMAGE_LIMITS.storedBytes)
      throw new Error(currentText().t("mobile.auth.error.photoTooLarge"));
    if (!isValidAvatarImage(change.avatar.mimeType, change.avatar.bytes)) {
      throw new Error(currentText().t("mobile.auth.error.photoInvalid"));
    }
  }
  const isName = "name" in change;
  const { response, body } = await withMobileAuthRequestTimeout(async (signal) => {
    const request = await fetch(new URL(isName ? "/v1/me/profile" : "/v1/me/avatar", session.apiUrl).toString(), {
      method: isName ? "PATCH" : change.avatar ? "PUT" : "DELETE",
      headers: {
        Authorization: `Bearer ${session.sessionToken}`,
        ...(isName
          ? { "Content-Type": "application/json" }
          : change.avatar
            ? { "Content-Type": change.avatar.mimeType }
            : {}),
      },
      body: isName
        ? JSON.stringify({ name: validateProfileName(change.name).name })
        : change.avatar
          ? new Uint8Array(change.avatar.bytes).buffer
          : undefined,
      signal,
    });
    return { response: request, body: await readResponseBody(request, signal) };
  });
  await checkMobileAuthorization(response, session);
  if (!response.ok) {
    if (response.status === 429) throw new Error(currentText().t("mobile.auth.error.tooManyChanges"));
    if (response.status === 409) throw new Error(currentText().t("mobile.auth.error.photoConflict"));
    throw new Error(currentText().t("mobile.auth.error.profileSaveFailed"));
  }
  const user = decodeUser(body);
  if (user.id !== session.user.id) throw new Error("The account service returned an invalid user.");
  const updated = { ...session, user };
  await saveMobileSessionIfCurrent(updated);
  return updated;
}

export async function logoutMobileSession(session: MobileSession): Promise<void> {
  await serializeMobileSessionStorage(async () => {
    const pending = await readPendingRevocations();
    if (!pending.some((item) => sameCredential(item, session))) {
      pending.push({ apiUrl: session.apiUrl, sessionToken: session.sessionToken });
      await LockedKeychain.setItemAsync(MOBILE_REVOCATIONS_KEY, JSON.stringify(pending));
      revocationRetryRequested = true;
    }
    const stored = await LockedKeychain.getItemAsync(MOBILE_SESSION_KEY);
    if (stored && sameCredential(decodeStoredMobileCredential(JSON.parse(stored)), session)) {
      await LockedKeychain.deleteItemAsync(MOBILE_SESSION_KEY);
    }
  });
  void retryMobileSessionRevocations();
}

function sameCredential(left: MobileCredential, right: MobileCredential): boolean {
  return left.apiUrl === right.apiUrl && left.sessionToken === right.sessionToken;
}

async function readPendingRevocations(): Promise<MobileCredential[]> {
  return decodePendingRevocations(await LockedKeychain.getItemAsync(MOBILE_REVOCATIONS_KEY));
}

function decodePendingRevocations(stored: string | null): MobileCredential[] {
  if (!stored) return [];
  return z.array(z.unknown()).parse(JSON.parse(stored)).map(decodeStoredMobileCredential);
}

let revocationRetry: Promise<void> | null = null;
let revocationRetryRequested = false;

// Pending tokens are never restored as logins. Keep them in Keychain until the
// account service confirms revocation, without blocking local sign-out or login.
export function retryMobileSessionRevocations(): Promise<void> {
  if (revocationRetry) return revocationRetry;
  revocationRetry = (async () => {
    const attempted: MobileCredential[] = [];
    try {
      do {
        revocationRetryRequested = false;
        const pending = (await serializeMobileSessionStorage(readPendingRevocations)).filter(
          (credential) => !attempted.some((item) => sameCredential(item, credential)),
        );
        attempted.push(...pending);
        await Promise.all(
          pending.map(async (credential) => {
            try {
              await revokeMobileCredential(credential);
              await serializeMobileSessionStorage(async () => {
                const remaining = (await readPendingRevocations()).filter((item) => !sameCredential(item, credential));
                if (remaining.length === 0) {
                  await LockedKeychain.deleteItemAsync(MOBILE_REVOCATIONS_KEY);
                } else {
                  await LockedKeychain.setItemAsync(MOBILE_REVOCATIONS_KEY, JSON.stringify(remaining));
                }
              });
            } catch {
              // Retry failed credentials only on the next external trigger.
            }
          }),
        );
      } while (revocationRetryRequested);
    } catch {
      // A storage failure must not produce an unhandled background rejection.
    } finally {
      revocationRetry = null;
    }
  })();
  return revocationRetry;
}

async function revokeMobileCredential(session: MobileCredential): Promise<void> {
  try {
    await withMobileAuthRequestTimeout(async (signal) => {
      const response = await fetch(new URL("/v1/mobile-auth/session", session.apiUrl).toString(), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.sessionToken}` },
        signal,
      });
      if (!response.ok) throw new Error("The account service did not confirm revocation.");
    });
  } catch {
    // Revocation may have committed before DELETE timed out, lost its response,
    // or failed while notifying peers. Check the token instead of treating an
    // ambiguous transport result as proof that the session is still active.
    try {
      const revoked = await withMobileAuthRequestTimeout(async (signal) => {
        const response = await fetch(new URL("/v1/mobile-auth/session", session.apiUrl).toString(), {
          headers: { Authorization: `Bearer ${session.sessionToken}` },
          signal,
        });
        return response.status === 401;
      });
      if (revoked) return;
    } catch {
      // Without confirmation, keep the credential available for another attempt.
    }
    throw new Error(currentText().t("mobile.auth.error.signOutUnconfirmed"));
  }
}

// Serialize profile reads and writes so a foreground refresh cannot persist an older identity
// after a successful edit. Credential revocation uses the independent storage queue.
function serializeMobileProfile<T>(operation: () => Promise<T>): Promise<T> {
  const result = mobileProfileTail.then(operation, operation);
  mobileProfileTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * One signed-in request to the account server. A 401 ends the session. A failed request throws the
 * account server's message, or `failure`. A body that `decode` refuses throws `failure` too.
 */
export async function requestMobileAccount<T>(
  session: MobileSession,
  path: string,
  init: { method?: "GET" | "POST"; body?: string; headers?: Record<string, string> },
  decode: (value: unknown) => T | null,
  failure: string,
  timeoutMs?: number,
): Promise<T> {
  return withMobileAuthRequestTimeout(
    async (signal) => {
      let response: Response;
      try {
        response = await fetch(new URL(path, session.apiUrl).toString(), {
          method: init.method ?? "GET",
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...init.headers,
          },
          ...(init.body === undefined ? {} : { body: init.body }),
          signal,
        });
      } catch {
        throw new Error(failure);
      }
      await checkMobileAuthorization(response, session);
      const body = await readResponseBody(response, signal).catch(() => null);
      if (!response.ok) throw new Error(apiErrorMessage(body) ?? failure);
      const value = decode(body);
      if (value === null) throw new Error(failure);
      return value;
    },
    undefined,
    timeoutMs,
  );
}

async function checkMobileAuthorization(response: Response, session: MobileSession): Promise<void> {
  if (response.status !== 401) return;
  await deleteMobileSessionIfCurrent(session.sessionToken);
  throw new MobileSessionExpiredError();
}

async function withMobileAuthRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = MOBILE_AUTH_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function readResponseBody(response: Response, signal: AbortSignal): Promise<DynamicRecord | null> {
  try {
    const body = await response.json();
    return isDynamicRecord(body) ? body : null;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

async function saveMobileSession(session: MobileSession): Promise<void> {
  await serializeMobileSessionStorage(() => LockedKeychain.setItemAsync(MOBILE_SESSION_KEY, JSON.stringify(session)));
}

async function saveMobileSessionIfCurrent(session: MobileSession): Promise<void> {
  await serializeMobileSessionStorage(async () => {
    const stored = await LockedKeychain.getItemAsync(MOBILE_SESSION_KEY);
    if (!stored) return;
    try {
      if (decodeStoredMobileSession(JSON.parse(stored)).sessionToken !== session.sessionToken) return;
    } catch {
      return;
    }
    await LockedKeychain.setItemAsync(MOBILE_SESSION_KEY, JSON.stringify(session));
  });
}

async function deleteMobileSessionIfCurrent(sessionToken: string): Promise<void> {
  await serializeMobileSessionStorage(async () => {
    const stored = await LockedKeychain.getItemAsync(MOBILE_SESSION_KEY);
    if (!stored) return;
    try {
      if (decodeStoredMobileCredential(JSON.parse(stored)).sessionToken !== sessionToken) return;
    } catch {
      // Corrupt session data cannot represent a newer valid session while storage operations are serialized.
    }
    await LockedKeychain.deleteItemAsync(MOBILE_SESSION_KEY);
  });
}

function serializeMobileSessionStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = mobileSessionStorageTail.then(operation, operation);
  mobileSessionStorageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function mobileDeviceIdentity(): Promise<{
  id: string;
  name: string;
  platform: "ios" | "android" | "unknown";
}> {
  let id = await SecureStore.getItemAsync(MOBILE_DEVICE_ID_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(MOBILE_DEVICE_ID_KEY, id, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  const rawName = Device.deviceName?.trim() || Device.modelName?.trim() || "Mobile device";
  const name = rawName.normalize("NFC").replace(/\p{C}/gu, "").replace(/\s+/gu, " ").slice(0, 80).trim();
  const platform = isIOS ? "ios" : isAndroid ? "android" : "unknown";
  return { id, name: name || "Mobile device", platform };
}

/** A QR session must have a valid host. An email session has none. */
function decodeMobileSession(value: unknown, apiUrl: string, emailSignIn: boolean): MobileSession {
  if (!isDynamicRecord(value) || !isString(value.sessionToken) || value.sessionToken.length > 512) {
    throw new Error("The account service returned an invalid mobile session.");
  }
  const user = decodeUser(value.user);
  if (emailSignIn) {
    if (value.host !== undefined) throw new Error("The mobile session host is invalid.");
    return { apiUrl, sessionToken: value.sessionToken, user, signIn: "email" };
  }
  if (!isMobileConnectHostBinding(value.host)) throw new Error("The mobile session host is invalid.");
  return { apiUrl, sessionToken: value.sessionToken, user, host: value.host };
}

function decodeStoredMobileSession(value: unknown): MobileSession {
  const credential = decodeStoredMobileCredential(value);
  return decodeMobileSession(value, credential.apiUrl, isDynamicRecord(value) && value.signIn === "email");
}

// This minimal decoder is only for cleanup, never for restoring authentication.
function decodeStoredMobileCredential(value: unknown): MobileCredential {
  if (
    !isDynamicRecord(value) ||
    !isString(value.apiUrl) ||
    !isString(value.sessionToken) ||
    !value.sessionToken ||
    value.sessionToken.length > 512
  )
    throw new Error("Invalid stored mobile credential.");
  const apiUrl = normalizeAccountApiUrl(value.apiUrl);
  if (!apiUrl) throw new Error("Invalid stored account API.");
  return { apiUrl, sessionToken: value.sessionToken };
}

/** The Mobile Connect rule for an account service origin: HTTPS, or HTTP on a private network. */
function normalizeAccountApiUrl(value: string): string | null {
  return (
    parseMobileConnectUrl(`openbot://mobile-connect?api=${encodeURIComponent(value)}&ticket=${"x".repeat(32)}`)
      ?.apiUrl ?? null
  );
}

function decodeUser(value: unknown): CentralAuthUser {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.email)) {
    throw new Error("The account service returned an invalid user.");
  }
  if (value.name !== null && !isString(value.name)) throw new Error("The account service returned an invalid user.");
  if (value.avatarUrl !== null && !isString(value.avatarUrl)) {
    throw new Error("The account service returned an invalid user.");
  }
  return { id: value.id, email: value.email, name: value.name, avatarUrl: value.avatarUrl };
}

function sameUser(left: CentralAuthUser, right: CentralAuthUser): boolean {
  return (
    left.id === right.id && left.email === right.email && left.name === right.name && left.avatarUrl === right.avatarUrl
  );
}

function apiErrorMessage(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.error) || !isString(value.error.message)) return null;
  return value.error.message.length <= 240 ? value.error.message : null;
}
