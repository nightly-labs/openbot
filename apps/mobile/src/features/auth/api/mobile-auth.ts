import { type AvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { companySignInErrorKey, MOBILE_COMPANY_SIGN_IN_RETURN } from "@openbot/contracts/company-sign-in";
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
import { type DynamicRecord, isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress, normalizeOneTimeCode, validateProfileName } from "@openbot/contracts/validation";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { bytesToBase64Url } from "@openbot/team-client/base64";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { openAuthSessionAsync } from "expo-web-browser";
import { z } from "zod";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { currentText } from "@/shared/lib/text";
import * as LockedKeychain from "../../../shared/lib/locked-keychain";
import { fetch } from "../../support/model/logged-fetch";
import { companySignInReturnParams } from "../model/company-sign-in-return";
import { fetchMobileAccount, forgetMobileAccountAccess } from "./account-fetch";

const MOBILE_SESSION_KEY = "openbot.mobile.session.v1";
const MOBILE_REVOCATIONS_KEY = "openbot.mobile.pending-revocations.v1";
const MOBILE_DEVICE_ID_KEY = "openbot.mobile.device-id.v1";
const MOBILE_AUTH_REQUEST_TIMEOUT_MS = 10_000;
const MOBILE_EMAIL_CODE_REQUEST_TIMEOUT_MS = 35_000;
const MOBILE_COMPANY_START_TIMEOUT_MS = 20_000;

const serializeMobileSessionStorage = serialQueue();
const serializeMobileProfile = serialQueue();
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
  host?: MobileConnectHostBinding;
  signIn?: AccountSignIn;
}

type AccountSignIn = "email" | "company";
type MobileCredential = Pick<MobileSession, "apiUrl" | "sessionToken">;

export function redeemMobileConnectUrl(value: string): Promise<MobileSession> {
  return exclusiveSignIn(() => redeemMobileConnectSession(value));
}

async function exclusiveSignIn<T>(operation: () => Promise<T>): Promise<T> {
  if (mobileConnectInFlight) throw new Error(currentText().t("mobile.auth.error.connectionInProgress"));
  mobileConnectInFlight = true;
  try {
    return await operation();
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

  const current = await serializeMobileSessionStorage(() => readStoredSessionAndRevokeInvalid(true));
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

  const session = decodeMobileSession(body, payload.apiUrl, null);
  session.host = validateMobileConnectHostBinding(payload.host, session.host);
  await saveMobileSession(session);
  return session;
}

function mobileAccountApiUrl(): string {
  const override = process.env.EXPO_PUBLIC_OPENBOT_API_URL;
  return (override && __DEV__ && normalizeAccountApiUrl(override)) || OPENBOT_CONTROL_PLANE_ORIGIN;
}

export interface MobileEmailChallenge {
  challengeId: string;
  email: string;
  resendAt: number;
  developmentCode?: string;
}

export class MobileEmailSignInError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

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

export function verifyMobileEmailCode(
  challengeId: string,
  code: string,
  referralCode?: string,
): Promise<MobileSession> {
  return exclusiveSignIn(async () => {
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
      ...(referralCode ? { referralCode } : {}),
    });
    if (!response.ok) throw mobileEmailError(response, body, "mobile.auth.email.error.verifyFailed");
    const session = decodeMobileSession(body, apiUrl, "email");
    await saveMobileSession(session);
    return session;
  });
}

export function signInMobileWithCompany(email: string): Promise<MobileSession | null> {
  return exclusiveSignIn(async () => {
    const address = normalizeEmailAddress(email);
    if (!address) {
      throw new MobileEmailSignInError(currentText().t("mobile.auth.email.error.invalidEmail"), "invalid_email");
    }
    void retryMobileSessionRevocations();
    const current = await serializeMobileSessionStorage(() => readStoredSessionAndRevokeInvalid(true));
    if (current) throw new Error(currentText().t("mobile.auth.error.alreadySignedIn"));
    const verifier = randomToken();
    const clientState = randomToken();
    const challenge = base64Url(
      await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
        encoding: Crypto.CryptoEncoding.BASE64,
      }),
    );
    const start = await mobileEmailRequest(
      "/v1/auth/company/start",
      { email: address, returnTo: MOBILE_COMPANY_SIGN_IN_RETURN, clientState, clientChallenge: challenge },
      {},
      MOBILE_COMPANY_START_TIMEOUT_MS,
    );
    if (!start.response.ok) throw companySignInError(errorCode(start.body), start.response);
    const authorizationUrl = start.body?.authorizationUrl;
    if (!isString(authorizationUrl) || !/^https?:\/\//u.test(authorizationUrl)) {
      throw companySignInError("company_sign_in_failed");
    }
    const result = await openAuthSessionAsync(authorizationUrl, MOBILE_COMPANY_SIGN_IN_RETURN);
    if (result.type !== "success") return null;
    const params = companySignInReturnParams(result.url, clientState);
    const failure = params?.get("error");
    if (failure) throw companySignInError(failure);
    const code = params?.get("code");
    if (!code) throw companySignInError("company_sign_in_failed");
    const device = await mobileDeviceIdentity();
    const apiUrl = mobileAccountApiUrl();
    const { response, body } = await mobileEmailRequest("/v1/mobile-auth/company/exchange", {
      code,
      codeVerifier: verifier,
      deviceId: device.id,
      deviceName: device.name,
      platform: device.platform,
    });
    if (!response.ok) throw companySignInError(errorCode(body), response);
    const session = decodeMobileSession(body, apiUrl, "company");
    await saveMobileSession(session);
    return session;
  });
}

function randomToken(): string {
  return bytesToBase64Url(Crypto.getRandomBytes(32));
}

function base64Url(base64: string): string {
  return base64.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function companySignInError(code: string, response?: Response): MobileEmailSignInError {
  const text = currentText();
  if (code === "rate_limited")
    return new MobileEmailSignInError(text.t("mobile.auth.email.error.wait"), code, retryAfterSeconds(response));
  if (code === "invalid_email") return new MobileEmailSignInError(text.t("mobile.auth.email.error.invalidEmail"), code);
  return new MobileEmailSignInError(text.t(companySignInErrorKey(code)), code || "company_sign_in_failed");
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

function errorCode(body: DynamicRecord | null): string {
  return isDynamicRecord(body?.error) && isString(body.error.code) ? body.error.code : "";
}

function mobileEmailError(
  response: Response,
  body: DynamicRecord | null,
  fallback: MobileTextKey,
): MobileEmailSignInError {
  const code = errorCode(body);
  const key = EMAIL_SIGN_IN_ERRORS.get(code) ?? fallback;
  return new MobileEmailSignInError(currentText().t(key), code, retryAfterSeconds(response));
}

function retryAfterSeconds(response: Response | undefined): number | undefined {
  const retryAfter = Number(response?.headers.get("Retry-After"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
}

export async function readMobileSession(): Promise<MobileSession | null> {
  void retryMobileSessionRevocations();
  return serializeMobileSessionStorage(() => readStoredSessionAndRevokeInvalid(false));
}

async function readStoredSessionAndRevokeInvalid(requireRevocation: boolean): Promise<MobileSession | null> {
  const stored = await LockedKeychain.getItemAsync(MOBILE_SESSION_KEY);
  if (!stored) return null;
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

type MobileProfileFieldChange = { name: string } | { avatar: { bytes: Uint8Array; mimeType: AvatarMimeType } | null };
export type MobileProfileChange = MobileProfileFieldChange | { analyticsEnabled: boolean; ageMs: number };

export function updateMobileProfile(
  session: MobileSession,
  change: MobileProfileChange,
  onUpdated?: (updated: MobileSession) => void,
): Promise<MobileSession> {
  return serializeMobileProfile(async () => {
    const updated =
      "analyticsEnabled" in change
        ? await writeMobileAnalytics(session, change.analyticsEnabled, change.ageMs)
        : await writeMobileProfile(session, change);
    onUpdated?.(updated);
    return updated;
  });
}

async function writeMobileAnalytics(session: MobileSession, enabled: boolean, ageMs: number): Promise<MobileSession> {
  const { response, body } = await withMobileAuthRequestTimeout(async (signal) => {
    const request = await fetchMobileAccount(session, "/v1/me/analytics", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, ageMs }),
      signal,
    });
    return { response: request, body: await readResponseBody(request, signal) };
  });
  await checkMobileAuthorization(response, session);
  if (!response.ok) {
    if (response.status === 429) throw new Error(currentText().t("mobile.auth.error.tooManyChanges"));
    throw new Error(currentText().t("mobile.auth.error.profileSaveFailed"));
  }
  return saveUpdatedUser(session, body);
}

async function writeMobileProfile(session: MobileSession, change: MobileProfileFieldChange): Promise<MobileSession> {
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
    const request = await fetchMobileAccount(session, isName ? "/v1/me/profile" : "/v1/me/avatar", {
      method: isName ? "PATCH" : change.avatar ? "PUT" : "DELETE",
      headers: {
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
  return saveUpdatedUser(session, body);
}

export async function logoutMobileSession(session: MobileSession): Promise<void> {
  forgetMobileAccountAccess(session.sessionToken);
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

async function saveUpdatedUser(session: MobileSession, body: DynamicRecord | null): Promise<MobileSession> {
  const user = decodeUser(body);
  if (user.id !== session.user.id) throw new Error("The account service returned an invalid user.");
  const updated = { ...session, user };
  await saveMobileSessionIfCurrent(updated);
  return updated;
}

export function sameCredential(left: MobileCredential, right: MobileCredential): boolean {
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
            } catch {}
          }),
        );
      } while (revocationRetryRequested);
    } catch {
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
    try {
      const revoked = await withMobileAuthRequestTimeout(async (signal) => {
        const response = await fetch(new URL("/v1/mobile-auth/session", session.apiUrl).toString(), {
          headers: { Authorization: `Bearer ${session.sessionToken}` },
          signal,
        });
        return response.status === 401;
      });
      if (revoked) return;
    } catch {}
    throw new Error(currentText().t("mobile.auth.error.signOutUnconfirmed"));
  }
}

function serialQueue() {
  let tail = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

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
        response = await fetchMobileAccount(session, path, {
          method: init.method ?? "GET",
          headers: {
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
  forgetMobileAccountAccess(session.sessionToken);
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
    } catch {}
    await LockedKeychain.deleteItemAsync(MOBILE_SESSION_KEY);
  });
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

function decodeMobileSession(value: unknown, apiUrl: string, signIn: AccountSignIn | null): MobileSession {
  if (!isDynamicRecord(value) || !isString(value.sessionToken) || value.sessionToken.length > 512) {
    throw new Error("The account service returned an invalid mobile session.");
  }
  const user = decodeUser(value.user);
  if (signIn) {
    if (value.host !== undefined) throw new Error("The mobile session host is invalid.");
    return { apiUrl, sessionToken: value.sessionToken, user, signIn };
  }
  if (!isMobileConnectHostBinding(value.host)) throw new Error("The mobile session host is invalid.");
  return { apiUrl, sessionToken: value.sessionToken, user, host: value.host };
}

function decodeStoredMobileSession(value: unknown): MobileSession {
  const credential = decodeStoredMobileCredential(value);
  const signIn =
    isDynamicRecord(value) && (value.signIn === "email" || value.signIn === "company") ? value.signIn : null;
  return decodeMobileSession(value, credential.apiUrl, signIn);
}

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
  const analyticsEnabled = value.analyticsEnabled ?? null;
  if (analyticsEnabled !== null && !isBoolean(analyticsEnabled)) {
    throw new Error("The account service returned an invalid user.");
  }
  return { id: value.id, email: value.email, name: value.name, avatarUrl: value.avatarUrl, analyticsEnabled };
}

function sameUser(left: CentralAuthUser, right: CentralAuthUser): boolean {
  return (
    left.id === right.id &&
    left.email === right.email &&
    left.name === right.name &&
    left.avatarUrl === right.avatarUrl &&
    (left.analyticsEnabled ?? null) === (right.analyticsEnabled ?? null)
  );
}

function apiErrorMessage(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.error) || !isString(value.error.message)) return null;
  return value.error.message.length <= 240 ? value.error.message : null;
}
