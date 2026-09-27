import {
  checkHostedSitePath,
  HOSTED_SITE_MIME_TYPES,
  HOSTED_SITE_UPLOAD_LIMITS,
  type HostedSitePathProblem,
} from "@openbot/contracts/hosted-sites";
import type { HostedSiteFramework } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

export const HOSTED_SITE_LIMITS = {
  activeSites: 10,
  concurrentUploads: 2,
  concurrentFileUploads: 2,
  uploadAttemptMultiplier: 2,
  creationsPerHour: 20,
  creationsPerDay: 100,
  ...HOSTED_SITE_UPLOAD_LIMITS,
  siteLifetimeMs: 30 * 24 * 60 * 60_000,
  tombstoneLifetimeMs: 90 * 24 * 60 * 60_000,
} as const;

export interface HostedSiteFileManifest {
  path: string;
  size: number;
  mimeType: string;
}

export interface HostedSiteUploadRequest {
  title: string;
  description: string;
  framework: HostedSiteFramework;
  spaFallback: boolean | null;
  siteId: string | null;
  files: HostedSiteFileManifest[];
}

const PATH_PROBLEM_MESSAGES = {
  invalid: "A file path is invalid.",
  hidden: "A file path is unsafe.",
  unsafe: "A file path is unsafe.",
  secret: "Credentials, private keys, and server source are not allowed.",
  archive: "Archives and source maps are not allowed.",
} as const satisfies Record<HostedSitePathProblem, string>;

export class HostedSiteInputError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function parseHostedSiteUploadRequest(value: unknown): HostedSiteUploadRequest {
  if (!isDynamicRecord(value)) throw invalid("The upload request is invalid.");
  const title = limitedText(value.title, "title", 120);
  const description = limitedText(value.description, "description", 500);
  if (value.framework !== "vanilla" && value.framework !== "astro") {
    throw invalid("The site type must be vanilla or Astro static.");
  }
  if (value.siteId !== null && value.siteId !== undefined && !isString(value.siteId)) {
    throw invalid("siteId is invalid.");
  }
  const siteId = isString(value.siteId) && value.siteId ? value.siteId : null;
  if (value.spaFallback !== undefined && !isBoolean(value.spaFallback)) {
    throw invalid("spaFallback must be a boolean.");
  }
  if (siteId === null && !isBoolean(value.spaFallback)) {
    throw invalid("spaFallback must be a boolean for a new site.");
  }
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > HOSTED_SITE_LIMITS.files) {
    throw new HostedSiteInputError(413, "file_limit", `A site can contain 1 to ${HOSTED_SITE_LIMITS.files} files.`);
  }
  const seen = new Set<string>();
  const files = value.files.map((file) => parseFile(file, seen));
  if (!seen.has("index.html")) throw invalid("The site root must contain index.html.");
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > HOSTED_SITE_LIMITS.totalBytes) {
    throw new HostedSiteInputError(413, "site_too_large", "The site exceeds the 2 MB limit.");
  }
  return {
    title,
    description,
    framework: value.framework,
    spaFallback: isBoolean(value.spaFallback) ? value.spaFallback : null,
    siteId,
    files,
  };
}

export function expectedFile(files: HostedSiteFileManifest[], path: string): HostedSiteFileManifest {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw invalid("This file is not part of the upload manifest.");
  return file;
}

function parseFile(value: unknown, seen: Set<string>): HostedSiteFileManifest {
  if (!isDynamicRecord(value) || !isString(value.path) || !isNumber(value.size) || !isString(value.mimeType)) {
    throw invalid("A file manifest entry is invalid.");
  }
  const path = normalizeHostedSitePath(value.path);
  if (seen.has(path)) throw invalid("The file manifest contains a duplicate path.");
  seen.add(path);
  if (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > HOSTED_SITE_LIMITS.fileBytes) {
    throw new HostedSiteInputError(413, "file_too_large", "A file exceeds the 1 MB limit.");
  }
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const allowed = HOSTED_SITE_MIME_TYPES[extension];
  if (!allowed?.includes(value.mimeType.toLowerCase())) {
    throw invalid(`The file type for ${path} is not allowed.`);
  }
  return { path, size: value.size, mimeType: value.mimeType.toLowerCase() };
}

function normalizeHostedSitePath(value: string): string {
  const checked = checkHostedSitePath(value);
  if ("problem" in checked) throw invalid(PATH_PROBLEM_MESSAGES[checked.problem]);
  return checked.path;
}

function limitedText(value: unknown, label: string, limit: number): string {
  if (!isString(value) || !value.trim() || value.length > limit) throw invalid(`The ${label} is invalid.`);
  return value.trim();
}

function invalid(message: string): HostedSiteInputError {
  return new HostedSiteInputError(400, "invalid_site", message);
}
