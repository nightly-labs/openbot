import { hostedSiteDeploymentPrefix, isHostedSiteStatus } from "@openbot/contracts/hosted-sites";
import type {
  HostedSiteSummary as HostedSiteClientSummary,
  HostedSiteFramework,
  HostedSiteStatus,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { hmacSha256, sha256 } from "./crypto";
import {
  type HostedSiteFileManifest,
  HostedSiteInputError,
  type HostedSiteUploadRequest,
} from "./hosted-site-contract";
import { siteCall, siteDecode, siteFailure } from "./hosted-site-effects";

/**
 * The stored rows of hosted sites and deployments, and the pure helpers that read, map and name them.
 * `HostedSiteService` owns every D1, KV and R2 call; nothing here touches storage.
 */

export interface SiteRow {
  id: string;
  user_id: string;
  /** Null for an unlinked site, and for every row that the Worker before `0024` wrote. */
  server_id: string | null;
  hostname: string;
  title: string;
  description: string;
  framework: HostedSiteFramework;
  spa_fallback: number;
  status: "uploading" | HostedSiteStatus;
  current_deployment_id: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  route_synced_at: number | null;
}

export interface DeploymentRow {
  id: string;
  site_id: string;
  user_id: string;
  status: "uploading" | "activating" | "active" | "superseded" | "abandoned";
  base_deployment_id: string | null;
  manifest_json: string;
  file_count: number;
  total_bytes: number;
  upload_expires_at: number;
  site_title: string;
  site_description: string;
  site_framework: "vanilla" | "astro";
  site_spa_fallback: number;
  request_hash: string;
  objects_deleted_at: number | null;
  activation_authorized_at: number | null;
  in_flight_uploads: number;
  upload_claims: number;
  upload_bytes_claimed: number;
}

/** The desktop summary, plus `uploading`: an upload session reports it for a new site. */
export interface HostedSiteSummary extends Omit<HostedSiteClientSummary, "status"> {
  status: SiteRow["status"];
}

export const uploadRequestHash = Effect.fn("HostedSites.uploadRequestHash")((request: HostedSiteUploadRequest) =>
  sha256(
    JSON.stringify({
      siteId: request.siteId,
      title: request.title,
      description: request.description,
      framework: request.framework,
      spaFallback: request.spaFallback,
      files: [...request.files].sort((left, right) => {
        if (left.path === right.path) return 0;
        return left.path < right.path ? -1 : 1;
      }),
    }),
  ).pipe(Effect.mapError(siteFailure)),
);

export function parseManifest(value: string): HostedSiteFileManifest[] {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isStoredManifestFile)) {
    throw new Error("The stored site manifest is invalid.");
  }
  return parsed.map((file) => ({ path: file.path, size: file.size, mimeType: file.mimeType }));
}

export const readUploadBody = Effect.fn("HostedSites.readUploadBody")(
  (body: ReadableStream<Uint8Array>, expectedSize: number) =>
    Effect.acquireUseRelease(
      siteDecode(() => body.getReader()),
      (reader) =>
        Effect.gen(function* () {
          const chunks: Uint8Array[] = [];
          let totalSize = 0;
          while (true) {
            const result = yield* siteCall(() => reader.read());
            if (result.done) break;
            totalSize += result.value.byteLength;
            if (totalSize > expectedSize) {
              yield* siteCall(() => reader.cancel()).pipe(Effect.catch(() => Effect.void));
              return yield* new HostedSiteInputError(
                400,
                "size_mismatch",
                "The file size does not match the manifest.",
              );
            }
            chunks.push(result.value);
          }
          if (totalSize !== expectedSize) {
            return yield* new HostedSiteInputError(400, "size_mismatch", "The file size does not match the manifest.");
          }
          const combined = new Uint8Array(totalSize);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return combined;
        }),
      (reader) => Effect.sync(() => reader.releaseLock()),
    ),
);

function isStoredManifestFile(value: unknown): value is HostedSiteFileManifest {
  return isDynamicRecord(value) && isString(value.path) && isNumber(value.size) && isString(value.mimeType);
}

export function creationCount(value: unknown): number {
  return isDynamicRecord(value) && isNumber(value.count) ? value.count : 0;
}

// D1 returns one result for each batch statement, so a missing one is a driver fault.
export function batchResult(result: D1Result<unknown> | undefined): D1Result<unknown> {
  if (!result) throw new Error("The database batch result is missing.");
  return result;
}

export function deploymentResultIds(result: D1Result<unknown>): string[] {
  return result.results.map((deployment) => {
    if (!isDynamicRecord(deployment) || !isString(deployment.id)) {
      throw new Error("The deployment result is invalid.");
    }
    return deployment.id;
  });
}

export function inactiveSiteError(status: SiteRow["status"]): HostedSiteInputError {
  if (status === "blocked") return new HostedSiteInputError(409, "site_blocked", "This site is blocked.");
  if (status === "deleted") return new HostedSiteInputError(409, "site_deleted", "This site was deleted.");
  if (status === "expired") return new HostedSiteInputError(409, "site_expired", "This site has expired.");
  return new HostedSiteInputError(409, "site_not_active", "This site cannot accept this deployment.");
}

export function siteRouteIdentity(site: SiteRow): string {
  return `${site.status}:${site.current_deployment_id ?? ""}:${site.expires_at ?? ""}`;
}

export function parseStoredSiteSummary(value: string): HostedSiteSummary {
  const parsed = JSON.parse(value);
  if (
    !isDynamicRecord(parsed) ||
    !isString(parsed.id) ||
    !isString(parsed.hostname) ||
    !isString(parsed.url) ||
    !isString(parsed.title) ||
    !isString(parsed.description) ||
    (parsed.framework !== "vanilla" && parsed.framework !== "astro") ||
    !["uploading", "active", "deleted", "expired", "blocked"].includes(String(parsed.status)) ||
    !isNumber(parsed.fileCount) ||
    !isNumber(parsed.size) ||
    (parsed.expiresAt !== null && !isString(parsed.expiresAt)) ||
    !isString(parsed.updatedAt) ||
    (parsed.serverId !== undefined && parsed.serverId !== null && !isString(parsed.serverId))
  ) {
    throw new Error("The stored site receipt is invalid.");
  }
  return {
    id: parsed.id,
    hostname: parsed.hostname,
    url: parsed.url,
    title: parsed.title,
    description: parsed.description,
    framework: parsed.framework,
    status: parseSiteStatus(parsed.status),
    fileCount: parsed.fileCount,
    size: parsed.size,
    expiresAt: parsed.expiresAt,
    updatedAt: parsed.updatedAt,
    // A receipt from before sites belonged to servers has no server.
    serverId: isString(parsed.serverId) ? parsed.serverId : null,
  };
}

function parseSiteStatus(value: unknown): SiteRow["status"] {
  if (value === "uploading" || isHostedSiteStatus(value)) return value;
  throw new Error("The stored site status is invalid.");
}

export function mapSite(
  row: SiteRow & { file_count: number; total_bytes: number },
  localSiteOrigin?: string,
): HostedSiteSummary {
  return {
    id: row.id,
    hostname: row.hostname,
    url: siteUrl(row.hostname, localSiteOrigin),
    title: row.title,
    description: row.description,
    framework: row.framework,
    status: row.status,
    fileCount: row.file_count,
    size: row.total_bytes,
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    serverId: row.server_id ?? null,
  };
}

function siteUrl(hostname: string, localSiteOrigin?: string): string {
  if (!localSiteOrigin) return `https://${hostname}`;
  const origin = new URL(localSiteOrigin);
  const label = hostname.slice(0, -".openbot.site".length);
  origin.hostname = `${label}.${origin.hostname}`;
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin.toString();
}

export function assetKey(siteId: string, deploymentId: string, path: string): string {
  return `${hostedSiteDeploymentPrefix(siteId, deploymentId)}${path}`;
}

const RESERVED_PREFIXES = new Set([
  "admin",
  "api",
  "auth",
  "billing",
  "login",
  "support",
  "security",
  "status",
  "mail",
  "www",
]);

export function slugWords(value: string): string[] {
  const words = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length >= 2 && !RESERVED_PREFIXES.has(word));
  while (words.length < 3) words.push(["interactive", "static", "website"][words.length] ?? "project");
  return words;
}

export function descriptiveSlug(words: string[]): string {
  const usable = words.map((word) => word.slice(0, 14)).filter(Boolean);
  while (usable.length < 3) usable.push(["static", "web", "project"][usable.length] ?? "page");
  let slug = usable.slice(0, 3).join("-");
  for (const word of usable.slice(3)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 48) break;
    slug = next;
  }
  while (slug.length < 32) {
    const extra = ["interactive", "web", "project", "page", "experience", "online", "tool"].find(
      (word) => !slug.split("-").includes(word),
    );
    if (!extra || `${slug}-${extra}`.length > 48) break;
    slug = `${slug}-${extra}`;
  }
  return slug.slice(0, 48).replace(/-+$/u, "");
}

export function randomBase32(length: number): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export const sourceIpHash = Effect.fn("HostedSites.sourceIpHash")(
  (secret: string, value: string, deduplicationWindow: number) =>
    hmacSha256(secret, `${deduplicationWindow}\0${value}`).pipe(Effect.mapError(siteFailure)),
);
