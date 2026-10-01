import type { HostedSiteList, HostedSiteStatus, HostedSiteSummary } from "./ipc-hosted-sites";
import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

/**
 * The upload rules that the desktop checks before an upload and the account server enforces.
 * Released desktop builds send uploads that these rules accept, so the server must keep accepting them.
 */
export const HOSTED_SITE_UPLOAD_LIMITS = {
  files: 20,
  totalBytes: 2 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  pathLength: 240,
  uploadLifetimeMs: 15 * 60_000,
} as const;

/**
 * The number of active sites that one account can keep with no proven server: a desktop that is not a
 * registered server, or a desktop release from before sites belonged to servers. A server's own limit
 * comes from its plan (`siteLimitForPlan`).
 */
export const HOSTED_SITE_UNLINKED_LIMIT = 1;

/** The request headers that tie a site request to a registered server: its host id and machine token. */
export const HOSTED_SITE_HOST_ID_HEADER = "OpenBot-Host-Id";
export const HOSTED_SITE_HOST_TOKEN_HEADER = "OpenBot-Host-Token";

/** The MIME types allowed for each file extension. The desktop sends the first one. */
export const HOSTED_SITE_MIME_TYPES: Readonly<Record<string, readonly [string, ...string[]]>> = {
  html: ["text/html"],
  css: ["text/css"],
  js: ["text/javascript", "application/javascript"],
  mjs: ["text/javascript", "application/javascript"],
  json: ["application/json"],
  svg: ["image/svg+xml"],
  webp: ["image/webp"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  ico: ["image/x-icon", "image/vnd.microsoft.icon"],
  woff2: ["font/woff2"],
  txt: ["text/plain"],
  webmanifest: ["application/manifest+json"],
};

export type HostedSitePathProblem = "invalid" | "hidden" | "unsafe" | "secret" | "archive";

const UNSAFE_SEGMENTS = new Set([".env", ".git", "node_modules", "server", "api"]);
const UNSAFE_FILE_NAME = /(?:^|[-_.])(?:credentials?|private[-_]?key|secret|service[-_]?account)(?:[-_.]|$)/iu;
const SERVER_SOURCE_NAME = /^(?:server|worker)\.[cm]?[jt]s$/iu;

/** Normalizes a site file path, or names the first rule that the path breaks. */
export function checkHostedSitePath(value: string): { path: string } | { problem: HostedSitePathProblem } {
  const path = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !path ||
    path.length > HOSTED_SITE_UPLOAD_LIMITS.pathLength ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("//")
  ) {
    return { problem: "invalid" };
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.startsWith("."))) return { problem: "hidden" };
  if (segments.some((segment) => !segment || UNSAFE_SEGMENTS.has(segment.toLowerCase()))) return { problem: "unsafe" };
  const fileName = segments.at(-1) ?? "";
  if (UNSAFE_FILE_NAME.test(fileName) || SERVER_SOURCE_NAME.test(fileName)) return { problem: "secret" };
  if (/\.(?:map|zip|tar|gz)$/iu.test(path)) return { problem: "archive" };
  return { path };
}

export function isHostedSiteStatus(value: unknown): value is HostedSiteStatus {
  return value === "active" || value === "deleted" || value === "expired" || value === "blocked";
}

/** Returns null for a value that is not a site summary in the desktop shape. */
export function parseHostedSiteSummary(value: unknown): HostedSiteSummary | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !isString(value.hostname) ||
    !isString(value.url) ||
    !isString(value.title) ||
    !isString(value.description) ||
    (value.framework !== "vanilla" && value.framework !== "astro") ||
    !isHostedSiteStatus(value.status) ||
    !isNumber(value.fileCount) ||
    !isNumber(value.size) ||
    (value.expiresAt !== null && !isString(value.expiresAt)) ||
    !isString(value.updatedAt) ||
    (value.serverId !== undefined && value.serverId !== null && !isString(value.serverId))
  ) {
    return null;
  }
  return {
    id: value.id,
    hostname: value.hostname,
    url: value.url,
    title: value.title,
    description: value.description,
    framework: value.framework,
    status: value.status,
    fileCount: value.fileCount,
    size: value.size,
    expiresAt: value.expiresAt,
    updatedAt: value.updatedAt,
    // An account server from before sites belonged to servers does not send the field.
    serverId: isString(value.serverId) ? value.serverId : null,
  };
}

/** Returns null for a value that is not a site list. An older account server sends no `used` count. */
export function parseHostedSiteList(value: unknown): HostedSiteList | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.sites) || !isNumber(value.limit)) return null;
  const sites: HostedSiteSummary[] = [];
  for (const item of value.sites) {
    const site = parseHostedSiteSummary(item);
    if (!site) return null;
    sites.push(site);
  }
  const used = isNumber(value.used) ? value.used : sites.length;
  return { sites, limit: value.limit, used };
}

export interface HostedSiteRouteFile {
  key: string;
  size: number;
  mimeType: string;
}

/** The route object that the account server writes to R2 and the site router reads. Stored objects use version 1. */
export interface HostedSiteRouteManifest {
  version: 1;
  status: HostedSiteStatus;
  siteId: string;
  deploymentId: string | null;
  expiresAt: number | null;
  spaFallback: boolean;
  files: Record<string, HostedSiteRouteFile>;
}

export function hostedSiteDeploymentPrefix(siteId: string, deploymentId: string | null): string {
  return `sites/${siteId}/deployments/${deploymentId}/`;
}

export function hostedSiteRouteKey(hostname: string): string {
  return `routes/${hostname}.json`;
}

export function hostedSiteBlockKey(hostname: string): string {
  return `blocks/${hostname}`;
}

/** Returns null for a route object that is malformed or points outside its own deployment. */
export function decodeHostedSiteRouteManifest(value: unknown): HostedSiteRouteManifest | null {
  if (
    !isDynamicRecord(value) ||
    value.version !== 1 ||
    !isHostedSiteStatus(value.status) ||
    !isString(value.siteId) ||
    (value.deploymentId !== null && !isString(value.deploymentId)) ||
    (value.expiresAt !== null && !isNumber(value.expiresAt)) ||
    !isBoolean(value.spaFallback) ||
    !isDynamicRecord(value.files)
  ) {
    return null;
  }
  const prefix = hostedSiteDeploymentPrefix(value.siteId, value.deploymentId);
  const files: Record<string, HostedSiteRouteFile> = {};
  for (const [path, file] of Object.entries(value.files)) {
    if (
      !isDynamicRecord(file) ||
      !isString(file.key) ||
      !isNumber(file.size) ||
      !isString(file.mimeType) ||
      !file.key.startsWith(prefix)
    ) {
      return null;
    }
    files[path] = { key: file.key, size: file.size, mimeType: file.mimeType };
  }
  return {
    version: 1,
    status: value.status,
    siteId: value.siteId,
    deploymentId: value.deploymentId,
    expiresAt: value.expiresAt,
    spaFallback: value.spaFallback,
    files,
  };
}
