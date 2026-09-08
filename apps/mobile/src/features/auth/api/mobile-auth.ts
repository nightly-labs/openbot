import { type AvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import type { CentralAuthUser } from "@openbot/contracts/ipc";
import {
  isMobileConnectDevelopmentHost,
  isMobileConnectHostBinding,
  type MobileConnectHostBinding,
  parseMobileConnectUrl,
  validateMobileConnectHostBinding,
} from "@openbot/contracts/mobile-connect";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { validateProfileName } from "@openbot/contracts/validation";
import { fetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";

import { isAndroid, isIOS } from "@/shared/lib/platform";

const MOBILE_SESSION_KEY = "openbot.mobile.session.v1";
const MOBILE_REVOCATIONS_KEY = "openbot.mobile.pending-revocations.v1";
const MOBILE_DEVICE_ID_KEY = "openbot.mobile.device-id.v1";
const MOBILE_AUTH_REQUEST_TIMEOUT_MS = 10_000;

let mobileSessionStorageTail = Promise.resolve();
let mobileProfileTail = Promise.resolve();

export class MobileSessionExpiredError extends Error {
  constructor() {
    super("Your session has ended. Scan a new code from OpenBot on your desktop.");
  }
}

export interface MobileSession {
  apiUrl: string;
  sessionToken: string;
  user: CentralAuthUser;
  host: MobileConnectHostBinding;
}

type MobileCredential = Pick<MobileSession, "apiUrl" | "sessionToken">;

export async function redeemMobileConnectUrl(value: string): Promise<MobileSession> {
  void retryMobileSessionRevocations();
  const payload = parseMobileConnectUrl(value);
  if (!payload) {
    throw new Error("This is not a valid OpenBot Mobile Connect code.");
  }
  if (!payload.host) throw new Error("Generate a new Mobile Connect code in an updated desktop app.");

  // Do not consume a one-time ticket or overwrite a permanent legacy token before
  // its revocation is confirmed. Retry cleanup against the OLD account service.
  await serializeMobileSessionStorage(() => readStoredSessionAndRevokeInvalid(true));

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
        ? "OpenBot could not reach your desktop. Keep both devices on the same Wi-Fi network and allow Local Network access."
        : "OpenBot could not reach the account service. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    throw new Error(apiErrorMessage(body) ?? "This Mobile Connect code is invalid or has expired.");
  }

  const session = decodeMobileSession(body, payload.apiUrl);
  session.host = validateMobileConnectHostBinding(payload.host, session.host);
  await saveMobileSession(session);
  return session;
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
  const stored = await SecureStore.getItemAsync(MOBILE_SESSION_KEY);
  if (!stored) return null;
  let credential: MobileCredential | null = null;
  try {
    const value = JSON.parse(stored);
    credential = decodeStoredMobileCredential(value);
    const storedCredential = credential;
    if ((await readPendingRevocations()).some((pending) => sameCredential(pending, storedCredential))) {
      await SecureStore.deleteItemAsync(MOBILE_SESSION_KEY);
      return null;
    }
    return decodeStoredMobileSession(value);
  } catch {
    if (credential) {
      try {
        await revokeMobileCredential(credential);
      } catch {
        if (requireRevocation) {
          throw new Error("Could not revoke the previous mobile session. Check your connection and scan again.");
        }
        return null;
      }
    }
    await SecureStore.deleteItemAsync(MOBILE_SESSION_KEY);
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
    throw new Error(apiErrorMessage(body) ?? "OpenBot could not verify this mobile session.");
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
    if (!response.ok) throw new Error("Could not load account sessions. Try again.");
    return z.object({ sessions: z.array(accountSessionSchema) }).parse(await response.json()).sessions;
  }, signal);
}

export async function revokeMobileAccountSession(session: MobileSession, target: MobileAccountSession): Promise<void> {
  if (target.current) throw new Error("Use Sign out to disconnect this device.");
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
    if (!response.ok) throw new Error("Could not disconnect this session. Refresh and try again.");
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
    throw new Error("Enter a display name between 3 and 20 characters.");
  }
  if ("avatar" in change && change.avatar) {
    if (change.avatar.bytes.byteLength > AVATAR_IMAGE_LIMITS.storedBytes)
      throw new Error("Choose a photo smaller than 512 KB.");
    if (!isValidAvatarImage(change.avatar.mimeType, change.avatar.bytes)) {
      throw new Error("The selected photo is invalid. Choose another image.");
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
    if (response.status === 429) throw new Error("Too many changes. Wait a moment and try again.");
    if (response.status === 409) throw new Error("Your photo changed on another device. Try again.");
    throw new Error("Could not save your profile. Check your connection and try again.");
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
      await SecureStore.setItemAsync(MOBILE_REVOCATIONS_KEY, JSON.stringify(pending), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      revocationRetryRequested = true;
    }
    const stored = await SecureStore.getItemAsync(MOBILE_SESSION_KEY);
    if (stored && sameCredential(decodeStoredMobileCredential(JSON.parse(stored)), session)) {
      await SecureStore.deleteItemAsync(MOBILE_SESSION_KEY);
    }
  });
  void retryMobileSessionRevocations();
}

function sameCredential(left: MobileCredential, right: MobileCredential): boolean {
  return left.apiUrl === right.apiUrl && left.sessionToken === right.sessionToken;
}

async function readPendingRevocations(): Promise<MobileCredential[]> {
  const stored = await SecureStore.getItemAsync(MOBILE_REVOCATIONS_KEY);
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
                  await SecureStore.deleteItemAsync(MOBILE_REVOCATIONS_KEY);
                } else {
                  await SecureStore.setItemAsync(MOBILE_REVOCATIONS_KEY, JSON.stringify(remaining), {
                    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
                  });
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
    throw new Error("Could not confirm sign-out. Check your connection and try again.");
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

async function checkMobileAuthorization(response: Response, session: MobileSession): Promise<void> {
  if (response.status !== 401) return;
  await deleteMobileSessionIfCurrent(session.sessionToken);
  throw new MobileSessionExpiredError();
}

async function withMobileAuthRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, MOBILE_AUTH_REQUEST_TIMEOUT_MS);
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
  await serializeMobileSessionStorage(() =>
    SecureStore.setItemAsync(MOBILE_SESSION_KEY, JSON.stringify(session), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  );
}

async function saveMobileSessionIfCurrent(session: MobileSession): Promise<void> {
  await serializeMobileSessionStorage(async () => {
    const stored = await SecureStore.getItemAsync(MOBILE_SESSION_KEY);
    if (!stored) return;
    try {
      if (decodeStoredMobileSession(JSON.parse(stored)).sessionToken !== session.sessionToken) return;
    } catch {
      return;
    }
    await SecureStore.setItemAsync(MOBILE_SESSION_KEY, JSON.stringify(session), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });
}

async function deleteMobileSessionIfCurrent(sessionToken: string): Promise<void> {
  await serializeMobileSessionStorage(async () => {
    const stored = await SecureStore.getItemAsync(MOBILE_SESSION_KEY);
    if (!stored) return;
    try {
      if (decodeStoredMobileCredential(JSON.parse(stored)).sessionToken !== sessionToken) return;
    } catch {
      // Corrupt session data cannot represent a newer valid session while storage operations are serialized.
    }
    await SecureStore.deleteItemAsync(MOBILE_SESSION_KEY);
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

function decodeMobileSession(value: unknown, apiUrl: string): MobileSession {
  if (!isDynamicRecord(value) || !isString(value.sessionToken) || value.sessionToken.length > 512) {
    throw new Error("The account service returned an invalid mobile session.");
  }
  if (!isMobileConnectHostBinding(value.host)) throw new Error("The mobile session host is invalid.");
  return {
    apiUrl,
    sessionToken: value.sessionToken,
    user: decodeUser(value.user),
    host: value.host,
  };
}

function decodeStoredMobileSession(value: unknown): MobileSession {
  const credential = decodeStoredMobileCredential(value);
  return decodeMobileSession(value, credential.apiUrl);
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
  const parsed = parseMobileConnectUrl(
    `openbot://mobile-connect?api=${encodeURIComponent(value.apiUrl)}&ticket=${"x".repeat(32)}`,
  );
  if (!parsed) throw new Error("Invalid stored account API.");
  return { apiUrl: parsed.apiUrl, sessionToken: value.sessionToken };
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
