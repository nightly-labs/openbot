import { integerInRange } from "./ipc-bounded-values";
import { BROWSER_PROFILE_LIMIT, isBrowserProfileId } from "./ipc-browser-profiles";
import { isDynamicRecord, isString } from "./runtime-values";

export const BROWSER_PROXY_LIMIT = 50;
export const BROWSER_PROXY_ADDRESS_MAX = 2048;

export const BROWSER_PROXY_SCHEMES = ["socks5", "http", "https"] as const;
export type BrowserProxyScheme = (typeof BROWSER_PROXY_SCHEMES)[number];

const DEFAULT_PORT: Record<BrowserProxyScheme, number> = { socks5: 1080, http: 80, https: 443 };
const BROWSER_PROXY_ID = /^[0-9a-f]{32}$/u;
const PROXY_HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])$/u;

export function isBrowserProxyScheme(value: unknown): value is BrowserProxyScheme {
  return BROWSER_PROXY_SCHEMES.some((scheme) => scheme === value);
}

export function isBrowserProxyId(value: unknown): value is string {
  return isString(value) && BROWSER_PROXY_ID.test(value);
}

export interface BrowserProxyAddress {
  scheme: BrowserProxyScheme;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

function signInPart(value: string): string | null {
  if (value === "") return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const PROXY_SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//u;
const PROXY_PORT = /^\d{1,5}$/u;

function hostAndPort(value: string, portRequired: boolean): { host: string; port: string | null } | null {
  const text = value.endsWith("/") ? value.slice(0, -1) : value;
  const bracket = text.startsWith("[") ? text.indexOf("]") : -1;
  const colon = bracket === -1 ? text.lastIndexOf(":") : text.indexOf(":", bracket);
  if (bracket === -1 && text.indexOf(":") !== colon) return null;
  if (colon === -1) return portRequired ? null : { host: text, port: null };
  const port = text.slice(colon + 1);
  if (!PROXY_PORT.test(port)) return null;
  return { host: text.slice(0, colon), port };
}

interface AddressParts {
  host: string;
  port: string | null;
  username: string;
  password: string;
}

function addressParts(rest: string, portRequired: boolean): AddressParts | null {
  const fields = rest.startsWith("[") ? [] : rest.split(":");
  const [host = "", port = "", username = "", ...password] = fields;
  if (password.length > 0 && PROXY_HOST.test(host) && PROXY_PORT.test(port) && !username.includes("@"))
    return { host, port, username, password: password.join(":") };
  const at = rest.lastIndexOf("@");
  const target = hostAndPort(rest.slice(at + 1), portRequired);
  if (target === null) return null;
  const signIn = at === -1 ? "" : rest.slice(0, at);
  const colon = signIn.indexOf(":");
  return colon === -1
    ? { ...target, username: signIn, password: "" }
    : { ...target, username: signIn.slice(0, colon), password: signIn.slice(colon + 1) };
}

const SOCKS_SIGN_IN_MAX_BYTES = 255;

function utf8Length(value: string | null): number {
  return value === null ? 0 : new TextEncoder().encode(value).length;
}

export function parseBrowserProxyAddress(text: string): BrowserProxyAddress | null {
  const value = text.trim();
  if (value.length === 0 || value.length > BROWSER_PROXY_ADDRESS_MAX || /\s/u.test(value)) return null;
  const prefix = PROXY_SCHEME_PREFIX.exec(value);
  const scheme = prefix?.[1]?.toLowerCase() ?? "http";
  if (!isBrowserProxyScheme(scheme)) return null;
  const parts = addressParts(value.slice(prefix?.[0].length ?? 0), prefix === null);
  if (parts === null) return null;
  const host = parts.host.toLowerCase();
  if (!PROXY_HOST.test(host)) return null;
  const port = parts.port === null ? DEFAULT_PORT[scheme] : Number(parts.port);
  if (!integerInRange(port, 1, 65_535)) return null;
  const username = signInPart(parts.username);
  const password = signInPart(parts.password);
  if (username === null && password !== null) return null;
  if (
    scheme === "socks5" &&
    (utf8Length(username) > SOCKS_SIGN_IN_MAX_BYTES || utf8Length(password) > SOCKS_SIGN_IN_MAX_BYTES)
  )
    return null;
  return { scheme, host, port, username, password };
}

export function browserProxyAddressText(proxy: {
  scheme: BrowserProxyScheme;
  host: string;
  port: number;
  username: string | null;
}): string {
  const user = proxy.username === null ? "" : `${encodeURIComponent(proxy.username)}@`;
  return `${proxy.scheme}://${user}${proxy.host}:${proxy.port}`;
}

export type BrowserProxyNameParts = Pick<BrowserProxySummary, "id" | "scheme" | "host" | "port" | "username">;

const PROXY_NAME_FORMS: readonly ((proxy: BrowserProxyNameParts) => string)[] = [
  (proxy) => proxy.host,
  (proxy) => `${proxy.host}:${proxy.port}`,
  (proxy) => browserProxyAddressText(proxy).replace(/^[a-z0-9]+:\/\//u, ""),
  browserProxyAddressText,
];

export function browserProxyName(proxy: BrowserProxyNameParts, proxies: readonly BrowserProxyNameParts[]): string {
  const others = proxies.filter((other) => other.id !== proxy.id && other.host === proxy.host);
  const form = PROXY_NAME_FORMS.find((name) => others.every((other) => name(other) !== name(proxy)));
  return (form ?? browserProxyAddressText)(proxy);
}

export const BROWSER_PROXY_FAILURES = ["unreachable", "signIn"] as const;
export type BrowserProxyFailure = (typeof BROWSER_PROXY_FAILURES)[number];

export function isBrowserProxyFailure(value: unknown): value is BrowserProxyFailure {
  return BROWSER_PROXY_FAILURES.some((failure) => failure === value);
}

export interface BrowserProxySummary {
  id: string;
  scheme: BrowserProxyScheme;
  host: string;
  port: number;
  username: string | null;
  hasPassword: boolean;
  profileIds: string[];
  failure: BrowserProxyFailure | null;
}

const BROWSER_PROXY_SAVED_PASSWORD = "••••••••";

export function editableBrowserProxyAddress(proxy: BrowserProxySummary | null | undefined): string {
  if (!proxy) return "";
  if (!proxy.hasPassword) return browserProxyAddressText(proxy);
  const user = proxy.username === null ? "" : encodeURIComponent(proxy.username);
  return `${proxy.scheme}://${user}:${BROWSER_PROXY_SAVED_PASSWORD}@${proxy.host}:${proxy.port}`;
}

export function browserProxySaveAddress(
  proxy: BrowserProxySummary | null | undefined,
  parsed: BrowserProxyAddress,
  text: string,
): { address: string; keepPassword: boolean } {
  const keepPassword = proxy?.hasPassword === true && parsed.password === BROWSER_PROXY_SAVED_PASSWORD;
  return { address: keepPassword ? browserProxyAddressText(parsed) : text.trim(), keepPassword };
}

export interface BrowserProxyComputer {
  id: string;
  memberId: string;
  name: string | null;
  online: boolean;
  mine: boolean;
  profileIds: string[];
  failure: BrowserProxyFailure | null;
}

export interface BrowserProxyList {
  proxies: BrowserProxySummary[];
  computers: BrowserProxyComputer[];
}

export interface SaveBrowserProxyInput {
  proxyId?: string;
  previousAddress?: string;
  keepPassword?: boolean;
  address: string;
}

export interface DeleteBrowserProxyInput {
  proxyId: string;
  profileIds: string[];
}

export interface SetBrowserProfileProxyInput {
  profileId: string;
  proxyId: string | null;
}

export function decodeBrowserProxySummary(value: unknown): BrowserProxySummary {
  if (
    !isDynamicRecord(value) ||
    !isBrowserProxyId(value.id) ||
    !isBrowserProxyScheme(value.scheme) ||
    !isString(value.host) ||
    !PROXY_HOST.test(value.host) ||
    !integerInRange(value.port, 1, 65_535) ||
    (value.username !== null && (!isString(value.username) || value.username.length > BROWSER_PROXY_ADDRESS_MAX)) ||
    typeof value.hasPassword !== "boolean" ||
    !Array.isArray(value.profileIds) ||
    !value.profileIds.every(isBrowserProfileId) ||
    (value.failure !== null && !isBrowserProxyFailure(value.failure))
  )
    throw new Error("Invalid browser proxy.");
  return {
    id: value.id,
    scheme: value.scheme,
    host: value.host,
    port: value.port,
    username: value.username,
    hasPassword: value.hasPassword,
    profileIds: [...value.profileIds],
    failure: value.failure,
  };
}

const MEMBER_ID_MAX = 255;
const MEMBER_NAME_MAX = 255;

export function decodeBrowserProxyComputer(value: unknown): BrowserProxyComputer {
  if (
    !isDynamicRecord(value) ||
    !isBrowserProxyId(value.id) ||
    !isString(value.memberId) ||
    value.memberId.length === 0 ||
    value.memberId.length > MEMBER_ID_MAX ||
    (value.name !== null && (!isString(value.name) || value.name.length > MEMBER_NAME_MAX)) ||
    typeof value.online !== "boolean" ||
    typeof value.mine !== "boolean" ||
    !Array.isArray(value.profileIds) ||
    !value.profileIds.every(isBrowserProfileId) ||
    (value.failure !== null && !isBrowserProxyFailure(value.failure))
  )
    throw new Error("Invalid browser proxy.");
  return {
    id: value.id,
    memberId: value.memberId,
    name: value.name,
    online: value.online,
    mine: value.mine,
    profileIds: [...value.profileIds],
    failure: value.failure,
  };
}

export function decodeBrowserProxyList(value: unknown): BrowserProxyList {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.proxies) ||
    value.proxies.length > BROWSER_PROXY_LIMIT ||
    !Array.isArray(value.computers) ||
    value.computers.length > BROWSER_PROXY_LIMIT
  )
    throw new Error("Invalid browser proxies.");
  return {
    proxies: value.proxies.map(decodeBrowserProxySummary),
    computers: value.computers.map(decodeBrowserProxyComputer),
  };
}

export function decodeOptionalBrowserProxyList(value: unknown): BrowserProxyList | null {
  return value === null ? null : decodeBrowserProxyList(value);
}

export function parseBrowserProxyId(value: unknown): string {
  if (!isBrowserProxyId(value)) throw new Error("Invalid browser proxy.");
  return value;
}

export function parseSaveBrowserProxyInput(value: unknown): SaveBrowserProxyInput {
  if (!isDynamicRecord(value) || !isString(value.address) || value.address.length > BROWSER_PROXY_ADDRESS_MAX)
    throw new Error("Invalid browser proxy.");
  if (value.proxyId === undefined) return { address: value.address };
  if (
    !isString(value.previousAddress) ||
    value.previousAddress.length > BROWSER_PROXY_ADDRESS_MAX ||
    (value.keepPassword !== undefined && typeof value.keepPassword !== "boolean")
  )
    throw new Error("Invalid browser proxy.");
  return {
    proxyId: parseBrowserProxyId(value.proxyId),
    previousAddress: value.previousAddress,
    keepPassword: value.keepPassword === true,
    address: value.address,
  };
}

export function parseDeleteBrowserProxyInput(value: unknown): DeleteBrowserProxyInput {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.profileIds) ||
    value.profileIds.length > BROWSER_PROFILE_LIMIT ||
    !value.profileIds.every(isBrowserProfileId)
  )
    throw new Error("Invalid browser proxy.");
  return { proxyId: parseBrowserProxyId(value.proxyId), profileIds: [...value.profileIds] };
}

export function parseSetBrowserProfileProxyInput(value: unknown): SetBrowserProfileProxyInput {
  if (!isDynamicRecord(value) || !isBrowserProfileId(value.profileId)) throw new Error("Invalid browser profile.");
  return { profileId: value.profileId, proxyId: value.proxyId === null ? null : parseBrowserProxyId(value.proxyId) };
}

export interface BrowserComputerSharing {
  sharing: boolean;
}

export function decodeBrowserComputerSharing(value: unknown): BrowserComputerSharing {
  if (!isDynamicRecord(value) || typeof value.sharing !== "boolean") throw new Error("Invalid computer sharing.");
  return { sharing: value.sharing };
}

export function decodeOptionalBrowserComputerSharing(value: unknown): BrowserComputerSharing | null {
  return value === null ? null : decodeBrowserComputerSharing(value);
}
