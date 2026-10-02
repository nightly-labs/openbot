/**
 * Builds the boat named snapshot that hosted servers are created from:
 *
 *   BOAT_TEMPLATE_API_KEY=... bun scripts/hosting/build-boat-template.ts --version=0.9.0 \
 *     --appimage-url=https://.../OpenBot-0.9.0-x86_64.AppImage --appimage-sha256=<hex> \
 *     --auth-api-url=https://<test worker origin>
 *
 * It creates a builder sandbox with no account env, runs provision.sh there, checks the install,
 * saves the builder as `openbot-server-<version>`, and deletes the builder. The builder never starts
 * OpenBot, so the template holds no host identity and no session. The key needs sandbox, files,
 * commands, and named snapshot access; the Worker's key must not have that access.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("build-boat-template");
const BOAT_API_URL = "https://boat.dev/api/v1";
const TEMPLATE_FILES = [
  "provision.sh",
  "packages.txt",
  "openbot-hosted-server",
  "openbot-hosted-env",
  "openbot-hosted-update",
  "openbot",
  "openbot-hosted.apparmor",
  "openbot.service",
  "openbot-update.service",
  "openbot-update.timer",
  "openbot-update-apply.service",
];
const REMOTE_DIRECTORY = "/tmp/openbot-template";
const READY_STATES = new Set(["ready", "idle", "running"]);
const FAILED_STATES = new Set(["error", "cancelled", "archived"]);
const hostingRoot = dirname(fileURLToPath(import.meta.url));

interface TemplateOptions {
  name: string;
  appImageUrl: string;
  appImageSha256: string;
  authApiUrl: string;
}

class BoatRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, label: string) {
    super(`${label} failed: ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const apiKey = process.env.BOAT_TEMPLATE_API_KEY?.trim();
  if (!apiKey) throw new Error("Set BOAT_TEMPLATE_API_KEY to a boat key with sandbox and snapshot access.");
  const boat = boatRequester(apiKey);

  const created = await boat("POST", "/sandboxes", "Builder creation", {
    body: { type: "small", noEnv: true, ttlSeconds: 7_200 },
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  const builderId = readString(isDynamicRecord(created.sandbox) ? created.sandbox : created, "id");
  logger.info("Builder sandbox created.", { builderId });
  try {
    await waitForSandbox(boat, builderId);
    await runCommand(boat, builderId, `mkdir -p ${REMOTE_DIRECTORY}`);
    for (const file of TEMPLATE_FILES) {
      await boat("PUT", `/sandboxes/${encodeURIComponent(builderId)}/files`, `Upload of ${file}`, {
        body: { path: `${REMOTE_DIRECTORY}/${file}`, content: await readFile(join(hostingRoot, file), "utf8") },
      });
    }
    const provision = [
      "sudo -n bash",
      `${REMOTE_DIRECTORY}/provision.sh`,
      '"$(id -un)"',
      shellQuote(options.appImageUrl),
      shellQuote(options.appImageSha256),
      shellQuote(options.authApiUrl),
    ].join(" ");
    await runDetached(boat, builderId, provision);
    await runCommand(
      boat,
      builderId,
      [
        "test -x /opt/OpenBot/app/openbot",
        "systemctl is-enabled --quiet openbot.service",
        "! systemctl is-active --quiet openbot.service",
        // With more than one unit, `is-enabled` passes when one of them is enabled.
        "systemctl is-enabled --quiet openbot-update.timer",
        "systemctl is-enabled --quiet openbot-update-apply.service",
        "! systemctl is-active --quiet openbot-update.timer",
        'test ! -e "$HOME/.config/OpenBot"',
        'test ! -e "$HOME/.config/openbot-hosted"',
        'test -z "$(ls -A /srv/openbot-hosted)"',
        `rm -rf ${REMOTE_DIRECTORY}`,
      ].join(" && "),
    );
    await saveNamedSnapshot(boat, builderId, options.name);
    logger.info(`The template ${options.name} is ready. Set HOSTED_SERVER_TEMPLATE to it on the Worker that uses it.`);
  } finally {
    await boat("DELETE", `/sandboxes/${encodeURIComponent(builderId)}`, "Builder deletion", {
      headers: { "X-Ascii-Confirm-Delete": builderId },
    }).catch((error: unknown) =>
      logger.warn("Delete the builder sandbox by hand:", { builderId, error: toLogValue(error) }),
    );
  }
}

type BoatRequester = (
  method: string,
  path: string,
  label: string,
  options?: { body?: unknown; headers?: Record<string, string> },
) => Promise<DynamicRecord>;

function boatRequester(apiKey: string): BoatRequester {
  return async (method, path, label, options = {}) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BOAT_API_URL}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(660_000),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const code = isDynamicRecord(payload) && isString(payload.code) ? payload.code : "http_error";
      throw new BoatRequestError(response.status, code, label);
    }
    return isDynamicRecord(payload) ? payload : {};
  };
}

async function waitForSandbox(boat: BoatRequester, sandboxId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const body = await boat("GET", `/sandboxes/${encodeURIComponent(sandboxId)}`, "Builder status");
    const state = readString(isDynamicRecord(body.sandbox) ? body.sandbox : body, "state");
    if (READY_STATES.has(state)) return;
    if (FAILED_STATES.has(state)) throw new Error(`The builder sandbox is ${state}.`);
    await delay(5_000);
  }
  throw new Error("The builder sandbox did not become ready in 10 minutes.");
}

/** Runs a short command and fails on a non-zero exit. It retries while boat still starts the sandbox. */
async function runCommand(boat: BoatRequester, sandboxId: string, command: string): Promise<void> {
  const body = await retryWhileStarting(() =>
    boat("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/commands`, "Builder command", {
      body: { command, timeoutSeconds: 120 },
    }),
  );
  if (body.exitCode !== 0) {
    throw new Error(`A builder command failed: ${command}\n${readTail(body)}`);
  }
}

/** Provisioning takes longer than a synchronous command may run, so it runs detached and is polled. */
async function runDetached(boat: BoatRequester, sandboxId: string, command: string): Promise<void> {
  const started = await retryWhileStarting(() =>
    boat("POST", `/sandboxes/${encodeURIComponent(sandboxId)}/commands`, "Provisioning start", {
      body: { command, detached: true },
    }),
  );
  const processId = started.processId;
  if (typeof processId !== "number") throw new Error("boat did not return a process id for provisioning.");
  logger.info("Provisioning started.", { processId });
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await delay(5_000);
    const status = await boat(
      "GET",
      `/sandboxes/${encodeURIComponent(sandboxId)}/commands/${processId}`,
      "Provisioning status",
    );
    if (status.status === "running") continue;
    if (status.exitCode === 0) return;
    throw new Error(
      `Provisioning failed (${String(status.status)}, exit ${String(status.exitCode)}).\n${readTail(status)}`,
    );
  }
  throw new Error("Provisioning did not finish in 30 minutes.");
}

async function saveNamedSnapshot(boat: BoatRequester, sandboxId: string, name: string): Promise<void> {
  await boat("POST", "/named-snapshots", "Named snapshot save", { body: { sandboxId, name } });
  logger.info("Saving the named snapshot.", { name });
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await delay(10_000);
    const body = await boat("GET", `/named-snapshots/${encodeURIComponent(name)}`, "Named snapshot status");
    const snapshot = isDynamicRecord(body.snapshot) ? body.snapshot : null;
    if (snapshot?.status === "ready") return;
    if (snapshot?.status === "failed") {
      throw new Error(`The named snapshot failed: ${isString(snapshot.error) ? snapshot.error : "no reason"}`);
    }
  }
  throw new Error("The named snapshot did not become ready in 30 minutes.");
}

async function retryWhileStarting(request: () => Promise<DynamicRecord>): Promise<DynamicRecord> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof BoatRequestError) || error.code !== "boat_starting" || attempt >= 60) throw error;
      await delay(5_000);
    }
  }
}

function readString(value: DynamicRecord, key: string): string {
  const field = value[key];
  if (!isString(field) || !field) throw new Error(`boat returned no ${key}.`);
  return field;
}

function readTail(value: DynamicRecord): string {
  return [value.stdout, value.stderr].filter(isString).join("\n").slice(-4_000);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function parseOptions(args: string[]): TemplateOptions {
  const read = (name: string): string => {
    const value = args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
    if (!value) throw new Error(`Pass --${name}=<value>.`);
    return value;
  };
  const version = read("version");
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-z.]+)?$/u.test(version)) throw new Error("--version must be a release version.");
  const appImageUrl = read("appimage-url");
  if (!appImageUrl.startsWith("https://")) throw new Error("--appimage-url must use HTTPS.");
  const appImageSha256 = read("appimage-sha256").toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(appImageSha256)) throw new Error("--appimage-sha256 must be 64 hex digits.");
  const authApiUrl = new URL(read("auth-api-url"));
  if (authApiUrl.protocol !== "https:") throw new Error("--auth-api-url must use HTTPS.");
  return {
    name: `openbot-server-${version.replaceAll(".", "-")}`,
    appImageUrl,
    appImageSha256,
    authApiUrl: authApiUrl.origin,
  };
}

void main().catch((error) => {
  logger.error("The hosted server template build failed.", toLogValue(error));
  process.exitCode = 1;
});
