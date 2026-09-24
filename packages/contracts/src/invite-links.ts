import { isOpenBotTeamApiHostname } from "./validation";

export const OPENBOT_INVITE_ORIGIN = "https://openbot.run";
export const OPENBOT_INVITE_PATH = "/join";
export const OPENBOT_CONTROL_PLANE_ORIGIN = "https://api.openbot.run";

/**
 * The finite deadline a permanent invitation carries. Invitation expiry travels the
 * released Team API and D1 schemas as a plain timestamp, so "never expires" is a
 * Date-compatible maximum rather than null. Matches `PERSISTENT_SESSION_EXPIRES_AT`.
 */
export const PERMANENT_INVITE_EXPIRES_AT_MS = 8_640_000_000_000_000;

export function permanentInviteExpiresAt(): string {
  return new Date(PERMANENT_INVITE_EXPIRES_AT_MS).toISOString();
}

/**
 * Whether an expiry timestamp is the never-expires sentinel. The frozen Team API
 * projections strip the `permanent` flag on the wire, so a client that only sees the
 * timestamp still recognizes a permanent link by its deadline.
 */
export function isNeverExpiringInvite(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= PERMANENT_INVITE_EXPIRES_AT_MS;
}

/**
 * Whether a decoded invitation is permanent. An older Worker or host sends no `permanent` flag,
 * and the frozen Team API projections strip it, so the never-expires deadline also counts.
 * `expiresAt` is epoch milliseconds from the account directory or an ISO date from a host.
 */
export function isPermanentInvite(permanent: unknown, expiresAt: number | string): boolean {
  if (permanent === true) return true;
  return typeof expiresAt === "number" ? expiresAt >= PERMANENT_INVITE_EXPIRES_AT_MS : isNeverExpiringInvite(expiresAt);
}

/** The join count of a decoded invitation. A missing or invalid count, from an older sender, is 0. */
export function inviteUseCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

const INVITE_FIELDS = ["api", "fingerprint", "invite", "server"] as const;
const BASE64URL_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRY_CLOUDFLARE_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com$/u;

export interface InviteLinkPayload {
  apiUrl: string;
  serverId: string;
  fingerprint: string;
  token: string;
}

export interface InviteLinkOptions {
  allowLocalDevelopmentApiUrl?: boolean;
}

export function createInviteUrl(payload: InviteLinkPayload, options: InviteLinkOptions = {}): string {
  validatePayload(payload, options);
  const url = new URL(OPENBOT_INVITE_PATH, OPENBOT_INVITE_ORIGIN);
  writePayload(url, payload);
  return url.toString();
}

export function createOpenBotInviteUrl(payload: InviteLinkPayload, options: InviteLinkOptions = {}): string {
  validatePayload(payload, options);
  const url = new URL("openbot://join");
  writePayload(url, payload);
  return url.toString();
}

export function toOpenBotInviteUrl(value: string, options: InviteLinkOptions = {}): string {
  return createOpenBotInviteUrl(parseInviteUrl(value, options), options);
}

export function isCanonicalInviteUrl(value: string, options: InviteLinkOptions = {}): boolean {
  try {
    parseInviteUrl(value, options);
    const url = new URL(value);
    return url.origin === OPENBOT_INVITE_ORIGIN && url.pathname === OPENBOT_INVITE_PATH;
  } catch {
    return false;
  }
}

export function parseInviteUrl(value: string, options: InviteLinkOptions = {}): InviteLinkPayload {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid OpenBot invitation link.");
  }

  const canonical =
    url.protocol === "https:" && url.origin === OPENBOT_INVITE_ORIGIN && url.pathname === OPENBOT_INVITE_PATH;
  const customScheme =
    url.protocol === "openbot:" && url.hostname === "join" && (url.pathname === "" || url.pathname === "/");
  if (
    (!canonical && !customScheme) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "" ||
    !hasOnlyInviteFields(url.searchParams)
  ) {
    throw new Error("The OpenBot invitation link is invalid.");
  }

  const payload: InviteLinkPayload = {
    apiUrl: url.searchParams.get("api") ?? "",
    serverId: url.searchParams.get("server") ?? "",
    fingerprint: url.searchParams.get("fingerprint") ?? "",
    token: url.searchParams.get("invite") ?? "",
  };
  validatePayload(payload, options);
  return payload;
}

export function isValidRemoteApiUrl(value: string, options: InviteLinkOptions = {}): boolean {
  try {
    const url = new URL(value);
    const localDevelopmentApi =
      options.allowLocalDevelopmentApiUrl === true &&
      url.protocol === "http:" &&
      url.hostname === "localhost" &&
      url.port !== "";
    return (
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (localDevelopmentApi ||
        (url.protocol === "https:" &&
          url.port === "" &&
          (url.origin === OPENBOT_CONTROL_PLANE_ORIGIN ||
            TRY_CLOUDFLARE_HOST_PATTERN.test(url.hostname) ||
            isOpenBotTeamApiHostname(url.hostname))))
    );
  } catch {
    return false;
  }
}

function validatePayload(payload: InviteLinkPayload, options: InviteLinkOptions): void {
  if (
    !isValidRemoteApiUrl(payload.apiUrl, options) ||
    !UUID_PATTERN.test(payload.serverId) ||
    !BASE64URL_SECRET_PATTERN.test(payload.fingerprint) ||
    !BASE64URL_SECRET_PATTERN.test(payload.token)
  ) {
    throw new Error("The OpenBot invitation link is invalid.");
  }
}

function writePayload(url: URL, payload: InviteLinkPayload): void {
  url.searchParams.set("api", payload.apiUrl);
  url.searchParams.set("server", payload.serverId);
  url.searchParams.set("fingerprint", payload.fingerprint);
  url.searchParams.set("invite", payload.token);
}

function hasOnlyInviteFields(search: URLSearchParams): boolean {
  const keys = [...search.keys()].sort();
  return (
    keys.length === INVITE_FIELDS.length &&
    INVITE_FIELDS.every((field, index) => keys[index] === field && search.getAll(field).length === 1)
  );
}
