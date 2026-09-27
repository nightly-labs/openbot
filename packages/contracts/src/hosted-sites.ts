import type { HostedSiteStatus } from "./ipc-hosted-sites";
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
