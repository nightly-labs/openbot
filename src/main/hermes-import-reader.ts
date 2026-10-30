// Reads Hermes Agent profiles from a Hermes folder on this computer, for the Hermes import.
//
// Hermes keeps one profile in its folder (`default`) and each named profile in `profiles/<name>`.
// A profile has `SOUL.md` (persona), `memories/MEMORY.md` and `USER.md` (entries split by `§`),
// `skills/[<category>/]<name>/SKILL.md`, `config.yaml` (model, MCP servers, terminal), `cron/jobs.json`,
// `.env` and `auth.json` (secrets) and `state.db` (sessions). This module only reads. It never runs
// anything from the folder, and it reads the names in `.env`, never the values.

import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  HERMES_IMPORT_LIMITS,
  HERMES_PROFILE_KEY,
  type HermesImportReason,
  type McpServerConfig,
  type RoutineSchedule,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { parse as parseYaml } from "yaml";
import { type ArchiveOperationError, archiveCall, archiveFailure } from "./archive-effects";
import { createRedaction } from "./instance-transfer-service";
import { archiveDirectory, inspectArchive, normalizedFiles } from "./skill-package";

/** A folder is a profile when it holds one of these, as Hermes decides. */
const PROFILE_MARKERS = ["config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db"];
const MEMORY_DELIMITER = "\n§\n";
/** The start of the error a skill package with a secret file, a key or an archive gives. */
const UNSAFE_FILE_PREFIX = sourceText("error.skill.unsafeFile", { name: "" });
/** Text files read from a profile are small in Hermes; a larger one is cut here. */
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_SKILLS = 200;
const MAX_JOBS = 200;
/** OpenBot's own export skill, which a user adds to Hermes. It is never imported back. */
const EXPORT_SKILL_NAME = "openbot-export";
/** Files a skill can run: anything in `scripts/` or `bin/`, and source files anywhere in the skill. */
const SKILL_CODE =
  /^(?:scripts|bin)\/|\.(?:sh|bash|zsh|fish|py|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd|exe|go|rs|lua|jar)$/iu;
/** Where the routine runs: platforms Hermes delivers to that OpenBot cannot reach on its own. */
const LOCAL_DELIVERY = new Set(["", "local", "origin"]);

interface HermesSkill {
  slug: string;
  name: string;
  /** The skill folder. Its files are read again when the import runs, so the preview holds none. */
  directory: string;
  /** The skill has code it can run, so it imports only when the user allows it. */
  scripts: boolean;
}

interface HermesRoutine {
  name: string;
  instruction: string;
  active: boolean;
  /** The Hermes `schedule`. It becomes an OpenBot schedule when the import runs, so a time is never stale. */
  source: unknown;
}

export interface HermesProfileData {
  key: string;
  /** The real path of the profile folder. An earlier import is found by it. */
  directory: string;
  name: string;
  model: string | null;
  /** The persona, or null when there is none or Hermes's starting text is unchanged. */
  soul: string | null;
  soulDefault: boolean;
  memories: string[];
  skills: HermesSkill[];
  skippedSkills: Array<{
    name: string;
    reason: Extract<HermesImportReason, "unsafeFile" | "invalidSkill" | "duplicateSkill">;
  }>;
  builtInSkills: number;
  /** Values that can hold a secret are already removed. The servers are added turned off. */
  mcpServers: McpServerConfig[];
  routines: HermesRoutine[];
  skippedRoutines: Array<{ name: string; reason: Extract<HermesImportReason, "routineSchedule" | "routineScript"> }>;
  terminalBackend: string | null;
  gateways: string[];
  secretNames: string[];
  hasHistory: boolean;
}

/** The Hermes folder: `HERMES_HOME`, or `~/.hermes`. A `HERMES_HOME` that names a profile gives its folder. */
export function hermesRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env.HERMES_HOME?.trim();
  if (configured)
    return profileRoot(
      configured === "~" || configured.startsWith("~/") ? join(home, configured.slice(1)) : configured,
    );
  if (platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "hermes");
  return join(home, ".hermes");
}

/** A chosen `profiles/<name>` folder reads as the Hermes folder it belongs to. */
export function profileRoot(directory: string): string {
  return basename(dirname(directory)) === "profiles" ? dirname(dirname(directory)) : directory;
}

/** The folder as the user knows it, with the home folder as `~`. */
export function displayPath(path: string, home: string = homedir()): string {
  return path === home || path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

/** The profiles of a Hermes folder, or null when the folder has none. */
export const readHermesProfiles = Effect.fn("HermesImport.readProfiles")(function* (
  root: string,
  timezone: string,
): Effect.fn.Return<HermesProfileData[] | null, ArchiveOperationError> {
  if (!(yield* isDirectory(root))) return null;
  const folders: Array<{ key: string; directory: string }> = [];
  if (yield* isProfile(root)) folders.push({ key: "default", directory: root });
  const profilesFolder = join(root, "profiles");
  if (yield* isDirectory(profilesFolder)) {
    const names = (yield* archiveCall(() => readdir(profilesFolder))).sort();
    for (const name of names) {
      const directory = join(profilesFolder, name);
      if (name === "default" || !HERMES_PROFILE_KEY.test(name)) continue;
      if ((yield* isDirectory(directory)) && (yield* isProfile(directory))) folders.push({ key: name, directory });
    }
  }
  if (folders.length === 0) return null;
  const profiles: HermesProfileData[] = [];
  for (const folder of folders.slice(0, HERMES_IMPORT_LIMITS.profiles))
    profiles.push(yield* readProfile(folder.key, folder.directory, timezone));
  return profiles;
});

const readProfile = Effect.fn("HermesImport.readProfile")(function* (
  key: string,
  directory: string,
  timezone: string,
): Effect.fn.Return<HermesProfileData, ArchiveOperationError> {
  const config = yield* readConfig(join(directory, "config.yaml"));
  const soulText = yield* readText(join(directory, "SOUL.md"));
  const soul = soulText === null ? null : persona(soulText);
  const jobs = yield* readJobs(join(directory, "cron", "jobs.json"), timezone);
  const skills = yield* readSkills(join(directory, "skills"));
  return {
    key,
    directory,
    name: profileName(key),
    model: modelLabel(config.model),
    soul,
    soulDefault: soulText !== null && soul === null,
    memories: [
      ...memoryEntries(yield* readText(join(directory, "memories", "MEMORY.md"))),
      ...memoryEntries(yield* readText(join(directory, "memories", "USER.md"))),
    ].filter((entry, index, all) => all.indexOf(entry) === index),
    ...skills,
    mcpServers: mcpServers(config.mcp_servers),
    routines: jobs.routines,
    skippedRoutines: jobs.skipped,
    terminalBackend: terminalBackend(config.terminal),
    gateways: jobs.gateways,
    secretNames: [
      ...envNames(yield* readText(join(directory, ".env"))),
      ...((yield* exists(join(directory, "auth.json"))) ? ["auth.json"] : []),
    ],
    hasHistory: yield* exists(join(directory, "state.db")),
  };
});

/** `default` is the agent the user calls Hermes. A named profile reads as words: `research-desk` is "Research desk". */
function profileName(key: string): string {
  if (key === "default") return "Hermes";
  const words = key.replace(/[-_]+/gu, " ").trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, INPUT_LIMITS.agentName);
}

function modelLabel(value: unknown): string | null {
  if (isString(value)) return value.trim().slice(0, HERMES_IMPORT_LIMITS.model) || null;
  if (!isDynamicRecord(value)) return null;
  const model = isString(value.default) ? value.default : isString(value.model) ? value.model : "";
  const provider = isString(value.provider) && value.provider !== "auto" ? value.provider : "";
  const label = [provider, model].filter(Boolean).join(" · ");
  return label.slice(0, HERMES_IMPORT_LIMITS.model) || null;
}

/** The persona without HTML comments. Hermes's starting file is a heading and comments only. */
function persona(text: string): string | null {
  const content = text.replace(/<!--[\s\S]*?-->/gu, "").trim();
  if (!content || /^#[^\n]*$/u.test(content)) return null;
  return content;
}

function memoryEntries(text: string | null): string[] {
  if (!text) return [];
  return text
    .replace(/^﻿/u, "")
    .replaceAll("\r\n", "\n")
    .split(MEMORY_DELIMITER)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The names before `=` in `.env`. The values are dropped as each line is read. */
function envNames(text: string | null): string[] {
  if (!text) return [];
  const names: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)?.[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, HERMES_IMPORT_LIMITS.names);
}

function terminalBackend(value: unknown): string | null {
  if (!isDynamicRecord(value) || !isString(value.backend)) return null;
  const backend = value.backend.trim();
  return backend && backend !== "local" ? backend.slice(0, HERMES_IMPORT_LIMITS.name) : null;
}

/** Each server as OpenBot stores it: turned off, with every value that can hold a secret removed. */
function mcpServers(value: unknown): McpServerConfig[] {
  if (!isDynamicRecord(value)) return [];
  const redact = createRedaction();
  const servers: McpServerConfig[] = [];
  for (const [rawName, entry] of Object.entries(value)) {
    if (!isDynamicRecord(entry)) continue;
    const name = rawName.trim().slice(0, INPUT_LIMITS.mcpServerName);
    const keys = (record: unknown) =>
      isDynamicRecord(record) ? Object.keys(record).map((key) => ({ key, value: "" })) : [];
    const base: McpServerConfig = {
      id: "",
      name,
      transport: "stdio",
      enabled: false,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "",
      headers: [],
    };
    if (isString(entry.command)) {
      const args = Array.isArray(entry.args) ? entry.args.filter(isString) : [];
      servers.push({
        ...base,
        command: entry.command,
        args: redact.args(name, args),
        env: keys(entry.env),
        workingDirectory: isString(entry.cwd) ? entry.cwd : "",
      });
    } else if (isString(entry.url)) {
      servers.push({ ...base, transport: "http", url: redact.origin(name, entry.url), headers: keys(entry.headers) });
    }
  }
  return servers.slice(0, HERMES_IMPORT_LIMITS.names);
}

const readSkills = Effect.fn("HermesImport.readSkills")(function* (folder: string) {
  const skills: HermesSkill[] = [];
  const skippedSkills: HermesProfileData["skippedSkills"] = [];
  let builtInSkills = 0;
  if (!(yield* isDirectory(folder))) return { skills, skippedSkills, builtInSkills };
  const bundled = new Set(
    ((yield* readText(join(folder, ".bundled_manifest"))) ?? "")
      .split(/\r?\n/u)
      .map((line) => line.split(":")[0]?.trim() ?? "")
      .filter(Boolean),
  );
  for (const directory of (yield* skillFolders(folder)).slice(0, MAX_SKILLS)) {
    const text = (yield* readText(join(directory, "SKILL.md"))) ?? "";
    const name = frontmatterName(text) ?? basename(directory);
    if (name === EXPORT_SKILL_NAME) continue;
    if (bundled.has(name)) {
      builtInSkills += 1;
      continue;
    }
    const read = yield* Effect.result(readSkillPackage(directory));
    if (Result.isFailure(read)) {
      const cause = read.failure;
      const unsafe = cause instanceof Error && cause.message.startsWith(UNSAFE_FILE_PREFIX);
      skippedSkills.push({
        name: name.slice(0, HERMES_IMPORT_LIMITS.name),
        reason: unsafe ? "unsafeFile" : "invalidSkill",
      });
      continue;
    }
    // Two folders with one skill name would be one library skill, and the second would replace the first.
    if (skills.some((skill) => skill.slug === read.success.info.slug)) {
      skippedSkills.push({ name: name.slice(0, HERMES_IMPORT_LIMITS.name), reason: "duplicateSkill" });
      continue;
    }
    skills.push({
      slug: read.success.info.slug,
      name: read.success.info.name,
      directory,
      scripts: hasSkillCode(Object.keys(read.success.files)),
    });
  }
  return { skills, skippedSkills, builtInSkills };
});

/** True when a skill has a file it can run, so it needs the user's approval. */
export function hasSkillCode(paths: readonly string[]): boolean {
  return paths.some((path) => SKILL_CODE.test(path));
}

/** A skill folder as OpenBot checks a skill package. Unsafe files and an invalid SKILL.md fail it. */
function readSkillPackage(directory: string) {
  return archiveDirectory(directory).pipe(
    Effect.mapError((failure): unknown => failure.cause),
    Effect.flatMap((bytes) =>
      Effect.try({
        try: () => ({ files: normalizedFiles(bytes), info: inspectArchive(bytes) }),
        catch: (cause) => cause,
      }),
    ),
  );
}

/** The files of a skill when the import runs, checked again: the folder can change after the preview. */
export const readSkillFiles = Effect.fn("HermesImport.readSkillFiles")(function* (directory: string) {
  const read = yield* readSkillPackage(directory).pipe(Effect.mapError((cause) => archiveFailure(cause)));
  return Object.entries(read.files);
});

/** `skills/<name>` and `skills/<category>/<name>`, without Hermes's own dot folders. */
const skillFolders = Effect.fn("HermesImport.skillFolders")(function* (folder: string) {
  const found: string[] = [];
  for (const name of (yield* archiveCall(() => readdir(folder))).sort()) {
    if (name.startsWith(".")) continue;
    const directory = join(folder, name);
    if (!(yield* isDirectory(directory))) continue;
    if (yield* exists(join(directory, "SKILL.md"))) {
      found.push(directory);
      continue;
    }
    for (const child of (yield* archiveCall(() => readdir(directory))).sort()) {
      const nested = join(directory, child);
      if (!child.startsWith(".") && (yield* isDirectory(nested)) && (yield* exists(join(nested, "SKILL.md"))))
        found.push(nested);
    }
  }
  return found;
});

function frontmatterName(text: string): string | null {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return null;
  try {
    const metadata = parseYaml(match[1] ?? "");
    return isDynamicRecord(metadata) && isString(metadata.name) ? metadata.name.trim() : null;
  } catch {
    return null;
  }
}

const readJobs = Effect.fn("HermesImport.readJobs")(function* (path: string, timezone: string) {
  const routines: HermesRoutine[] = [];
  const skipped: HermesProfileData["skippedRoutines"] = [];
  const gateways: string[] = [];
  const text = yield* readText(path);
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const jobs = Array.isArray(parsed)
    ? parsed
    : isDynamicRecord(parsed) && Array.isArray(parsed.jobs)
      ? parsed.jobs
      : [];
  for (const job of jobs.slice(0, MAX_JOBS)) {
    if (!isDynamicRecord(job)) continue;
    const prompt = isString(job.prompt) ? job.prompt.trim() : "";
    const name = (isString(job.name) && job.name.trim() ? job.name.trim() : (prompt.split("\n")[0] ?? "")).slice(
      0,
      INPUT_LIMITS.agentName,
    );
    if (!name) continue;
    for (const target of isString(job.deliver) ? job.deliver.split(",") : []) {
      const platform = target.split(":")[0]?.trim().toLowerCase() ?? "";
      if (!LOCAL_DELIVERY.has(platform) && !gateways.includes(platform)) gateways.push(platform);
    }
    if (job.script || job.no_agent === true) {
      skipped.push({ name, reason: "routineScript" });
      continue;
    }
    if (!prompt || !routineSchedule(job.schedule, timezone)) {
      skipped.push({ name, reason: "routineSchedule" });
      continue;
    }
    routines.push({
      name,
      instruction: prompt.slice(0, 100_000),
      active: job.enabled !== false && job.state !== "paused",
      source: job.schedule,
    });
  }
  return { routines, skipped, gateways: gateways.slice(0, HERMES_IMPORT_LIMITS.names) };
});

/** A cron expression, an interval in minutes, or one run in the future. Other schedules stay in Hermes. */
export function routineSchedule(value: unknown, timezone: string, now = new Date()): RoutineSchedule | null {
  if (!isDynamicRecord(value)) return null;
  if (value.kind === "cron" && isString(value.expr) && value.expr.trim().split(/\s+/u).length === 5)
    return { kind: "custom", expression: value.expr.trim() };
  if (value.kind === "interval" && typeof value.minutes === "number" && Number.isInteger(value.minutes)) {
    const minutes = value.minutes;
    if (minutes < 3) return null;
    const unit = minutes % 1440 === 0 ? "days" : minutes % 60 === 0 ? "hours" : "minutes";
    const amount = unit === "days" ? minutes / 1440 : unit === "hours" ? minutes / 60 : minutes;
    return { kind: "interval", amount, unit, anchorAt: now.toISOString() };
  }
  if (value.kind === "once" && isString(value.run_at)) {
    const at = new Date(value.run_at);
    if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(at)
        .map((part) => [part.type, part.value]),
    );
    return { kind: "once", date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  return null;
}

/** The parts of `config.yaml` the import reads. Each is checked where it is used. */
interface HermesConfig {
  model: unknown;
  mcp_servers: unknown;
  terminal: unknown;
}

const readConfig = Effect.fn("HermesImport.readConfig")(function* (path: string) {
  const text = yield* readText(path);
  let value: unknown = null;
  try {
    value = text ? parseYaml(text) : null;
  } catch {
    value = null;
  }
  const config: HermesConfig = isDynamicRecord(value)
    ? { model: value.model, mcp_servers: value.mcp_servers, terminal: value.terminal }
    : { model: null, mcp_servers: null, terminal: null };
  return config;
});

/** A regular file's text, cut at the read limit, or null when there is none. Links are not followed. */
const readText = Effect.fn("HermesImport.readText")(function* (path: string) {
  const info = yield* archiveCall(() => lstat(path).catch(() => null));
  if (!info?.isFile()) return null;
  const bytes = yield* archiveCall(() => readFile(path));
  return new TextDecoder().decode(bytes.subarray(0, MAX_TEXT_BYTES));
});

const isDirectory = (path: string) =>
  archiveCall(() =>
    stat(path)
      .then((info) => info.isDirectory())
      .catch(() => false),
  );

const exists = (path: string) =>
  archiveCall(() =>
    lstat(path)
      .then(() => true)
      .catch(() => false),
  );

const isProfile = Effect.fn("HermesImport.isProfile")(function* (directory: string) {
  for (const marker of PROFILE_MARKERS) if (yield* exists(join(directory, marker))) return true;
  return false;
});
