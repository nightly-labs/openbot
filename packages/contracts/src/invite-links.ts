import { isOpenBotTeamApiHostname } from "./validation";

export const OPENBOT_INVITE_ORIGIN = "https://openbot.run";
export const OPENBOT_INVITE_PATH = "/join";
export const OPENBOT_CONTROL_PLANE_ORIGIN = "https://api.openbot.run";

export const PERMANENT_INVITE_EXPIRES_AT_MS = 8_640_000_000_000_000;

export function permanentInviteExpiresAt(): string {
  return new Date(PERMANENT_INVITE_EXPIRES_AT_MS).toISOString();
}

export function isNeverExpiringInvite(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= PERMANENT_INVITE_EXPIRES_AT_MS;
}

export function isPermanentInvite(permanent: unknown, expiresAt: number | string): boolean {
  if (permanent === true) return true;
  return typeof expiresAt === "number" ? expiresAt >= PERMANENT_INVITE_EXPIRES_AT_MS : isNeverExpiringInvite(expiresAt);
}

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
  selfHostedApiOrigin?: string | undefined;
}

export function selfHostedApiOrigin(apiUrl: string | undefined): string | undefined {
  if (!apiUrl) return undefined;
  try {
    const { protocol, origin } = new URL(apiUrl);
    return protocol === "https:" && origin !== OPENBOT_INVITE_ORIGIN && !isValidRemoteApiUrl(`${origin}/`)
      ? origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function createInviteUrl(payload: InviteLinkPayload, options: InviteLinkOptions = {}): string {
  validatePayload(payload, options);
  if (isSelfHostedApiUrl(new URL(payload.apiUrl), options)) return createOpenBotInviteUrl(payload, options);
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

export function createWebAppInvitePath(value: string, options: InviteLinkOptions = {}): string {
  const url = new URL("/app", OPENBOT_INVITE_ORIGIN);
  writePayload(url, parseInviteUrl(value, options));
  return `${url.pathname}${url.search}`;
}

export const WEB_APP_INVITE_FIELDS: readonly string[] = INVITE_FIELDS;

export function inviteUrlFromWebAppSearch(search: string, options: InviteLinkOptions = {}): string | null {
  const params = new URLSearchParams(search);
  if (!INVITE_FIELDS.some((field) => params.has(field))) return null;
  const url = new URL(OPENBOT_INVITE_PATH, OPENBOT_INVITE_ORIGIN);
  for (const field of INVITE_FIELDS) for (const value of params.getAll(field)) url.searchParams.append(field, value);
  try {
    return createInviteUrl(parseInviteUrl(url.toString(), options), options);
  } catch {
    return null;
  }
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
        isSelfHostedApiUrl(url, options) ||
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

function isSelfHostedApiUrl(url: URL, options: InviteLinkOptions): boolean {
  return url.protocol === "https:" && url.origin === options.selfHostedApiOrigin;
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
