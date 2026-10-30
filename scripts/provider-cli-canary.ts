// Reads the newest release of each provider CLI for each target, as each user's update check does.
// Then it installs the newest release of each provider that has a free model, and runs the conformance
// cases on it with no account: model list, turn, cancel and a turn after it, resume in a new process,
// and a missing session. A CLI release reaches users within an hour of
// its publication, so a scheduled run finds a broken release before many users install it. Add the
// version to `provider-runtime-blocklist.json` to stop the offer.
// The run uses a new home folder, so it never reads the account of the person who runs it.
// `bun run test:provider-cli-canary [-- opencode]`. Writes .openbot-build/provider-cli-canary/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MANAGED_RUNTIME_PROVIDERS, type ManagedProviderId } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import lockValue from "../native-runtime.lock.json";
import { isMissingProviderSessionError } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import { olderVersion } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeModelListResponse } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { providerRuntimeDescriptor, type RuntimeTarget } from "../src/main/provider-runtime-descriptors";
import { ProviderRuntimeManager, runtimeTarget } from "../src/main/provider-runtime-manager";
import {
  type BlockedVersions,
  fetchBlockedVersions,
  type LatestReleaseContext,
  latestRelease,
} from "../src/main/provider-runtime-releases";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-cli-canary");
const REQUEST_TIMEOUT_MS = 120_000;
const TARGETS: readonly RuntimeTarget[] = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"];

/** Each provider that has a model with no account and no cost, and that model. */
const FREE_MODELS: Readonly<Partial<Record<ManagedProviderId, string>>> = {
  opencode: "opencode/big-pickle",
};

/** Why the canary does not run a provider. */
const NOT_COVERED: Readonly<Record<string, string>> = {
  codex: "Needs a ChatGPT account or an API key.",
  claude: "Needs a Claude account or an API key.",
  grok: "Needs an xAI account.",
  antigravity: "Needs a Google account.",
  cursor: "Needs a Cursor account.",
  cline: "Not checked yet: no run confirms that a free model turn works without a Cline sign-in.",
  pi: "Needs a provider API key.",
  muse: "Needs a Muse account.",
};

interface CanaryResult {
  provider: ManagedProviderId;
  version: string | null;
  /** The version an update installs now: the newest release, unless it is blocked or older than the pin. */
  expected: string;
  model: string;
  listed: boolean;
  turn: { status: string | null; error: string | null; replied: boolean };
  cancel: { status: string | null; next: string | null };
  resume: { status: string | null };
  missingSession: boolean;
}

interface Report {
  passed: boolean;
  /** The newest version of each provider for each target, or why it could not be read. */
  releases: Record<string, Record<string, string>>;
  results: CanaryResult[];
  failure: string | null;
  notCovered: Readonly<Record<string, string>>;
}

function requestedProviders(): ManagedProviderId[] {
  const names = process.argv.slice(2);
  const known = Object.keys(FREE_MODELS).filter((name): name is ManagedProviderId => name in FREE_MODELS);
  if (names.length === 0) return known;
  const unknown = names.filter((name) => !known.some((provider) => provider === name));
  if (unknown.length > 0) throw new Error(`No free model is known for: ${unknown.join(", ")}.`);
  return known.filter((provider) => names.includes(provider));
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-cli-canary-"));
const report: Report = { passed: false, releases: {}, results: [], failure: null, notCovered: NOT_COVERED };
const clients: AgentClient[] = [];

// A new home for every CLI that this process starts, so that no stored account is used.
const home = join(root, "home");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  XDG_CACHE_HOME: join(home, ".cache"),
});

const lock = parseAgentRuntimeLock(lockValue);

/** Every provider's newest release must be readable for every target, or no user gets the update. */
async function readReleases(): Promise<string[]> {
  const failures: string[] = [];
  // Each target of a provider reads the same release, and GitHub allows 60 API requests an hour
  // without a token, so each URL is read once.
  const responses = new Map<string, Promise<Response>>();
  const fetchOnce: LatestReleaseContext["fetch"] = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const response = responses.get(url) ?? fetch(input, init);
    responses.set(url, response);
    return response.then((answer) => answer.clone());
  };
  for (const provider of MANAGED_RUNTIME_PROVIDERS) {
    const versions: Record<string, string> = {};
    for (const target of TARGETS) {
      const release = await Effect.runPromise(
        Effect.result(latestRelease(provider, { target, lock, fetch: fetchOnce })),
      );
      if (release._tag === "Success") versions[target] = release.success.version;
      else {
        const cause = release.failure.cause;
        versions[target] = `failed: ${cause instanceof Error ? cause.message : String(cause)}`;
        failures.push(`${provider} ${target}`);
      }
    }
    report.releases[provider] = versions;
  }
  return failures;
}

/**
 * The version that an update installs on this computer now. The manager installs the pinned version
 * when its own release read fails, so an install that differs from this version fails the run.
 */
async function expectedVersion(provider: ManagedProviderId): Promise<string> {
  const target = runtimeTarget(process.platform, process.arch);
  if (!target) throw new Error(`No provider runtime exists for ${process.platform}-${process.arch}.`);
  const newest = await runCauseEffect(latestRelease(provider, { target, lock, fetch }));
  // The manager also blocks nothing when it cannot read the list.
  const blocked = await Effect.runPromise(
    fetchBlockedVersions(fetch).pipe(Effect.catch(() => Effect.succeed<BlockedVersions>(new Map()))),
  );
  const pinned = providerRuntimeDescriptor(provider).spec(target, lock).version;
  return blocked.get(provider)?.has(newest.version) || !olderVersion(pinned, newest.version) ? pinned : newest.version;
}

async function canary(manager: ProviderRuntimeManager, provider: ManagedProviderId): Promise<CanaryResult> {
  const model = FREE_MODELS[provider] ?? "";
  await runCauseEffect(manager.downloadAndWait(provider));
  const executable = manager.executablePath(provider);
  const version = manager.getStatus().providers[provider].version;
  if (!executable || !version) throw new Error(`${provider}: the newest release did not install.`);
  process.stdout.write(`${provider} ${version}: ${executable}\n`);
  const expected = await expectedVersion(provider);
  assert.equal(version, expected, `${provider}: installed ${version}, but an update installs ${expected} now.`);

  const driver = requireProviderDriver(provider);
  const open = () => {
    const client = driver.createClient(
      { executable, version, source: "managed" },
      REQUEST_TIMEOUT_MS,
      NO_PROVIDER_CREDENTIALS,
    );
    clients.push(client);
    client.start();
    return client;
  };
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  let client = open();
  const listed = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
  const isListed = listed.data.some((entry) => entry.model === model);
  assert.ok(isListed, `${provider} ${version}: model/list gives ${model}.`);

  const thread = await startThread(client, { cwd: workspace, model });
  const turn = await runTurn(client, thread, { model, text: "Reply with the single word: ok" });
  assert.equal(turn.error, null, `${provider} ${version}: the turn succeeds.`);
  assert.equal(turn.status, "completed", `${provider} ${version}: the turn completes.`);
  assert.ok(turn.reply.trim().length > 0, `${provider} ${version}: the reply reaches the client.`);

  // Cancel as soon as the turn starts. The prompt asks for a long answer, so the turn is still open.
  const started = new Promise<void>((started) => {
    client.on("notification", (notification) => {
      if (notification.method === "turn/started") started();
    });
  });
  const waiting = runTurn(client, thread, { model, text: "Count from 1 to 2000, one number on each line." });
  // A turn that fails before it starts ends the wait too.
  await Promise.race([started, waiting]);
  await runCauseEffect(client.request("turn/interrupt", { threadId: thread }, (value) => value));
  const cancelled = await waiting;
  const next = await runTurn(client, thread, { model, text: "Reply with the single word: ok" });
  assert.equal(cancelled.status, "interrupted", `${provider} ${version}: a cancelled turn ends as interrupted.`);
  assert.equal(next.status, "completed", `${provider} ${version}: a turn after the cancel completes.`);

  await runCauseEffect(client.stop());
  client = open();
  await runCauseEffect(client.request("thread/resume", { threadId: thread, cwd: workspace, model }, (value) => value));
  const resumed = await runTurn(client, thread, { model, text: "Reply with the single word: ok" });
  assert.equal(resumed.status, "completed", `${provider} ${version}: a turn on the restored session completes.`);

  const gone = thread.replace(/[^:]+$/u, "ses_openbotcanarymissing");
  const missingSession = await runCauseEffect(
    client.request("thread/resume", { threadId: gone, cwd: workspace, model }, (value) => value),
  ).then(
    () => false,
    (error: unknown) => isMissingProviderSessionError(error, provider),
  );
  assert.equal(missingSession, true, `${provider} ${version}: a missing session is reported as missing.`);

  return {
    provider,
    version,
    expected,
    model,
    listed: isListed,
    turn: { status: turn.status, error: turn.error, replied: turn.reply.trim().length > 0 },
    cancel: { status: cancelled.status, next: next.status },
    resume: { status: resumed.status },
    missingSession,
  };
}

const manager = new ProviderRuntimeManager({ root: join(root, "runtimes") });
try {
  await mkdir(home, { recursive: true });
  await runCauseEffect(manager.initialize());
  await runCauseEffect(manager.checkForUpdates());
  // Run the installs first, so that one release that cannot be read does not hide a broken CLI.
  for (const provider of requestedProviders()) {
    report.results.push(await canary(manager, provider));
    await stopClients(clients.splice(0));
  }
  const unreadable = await readReleases();
  assert.deepEqual(unreadable, [], `The newest release cannot be read for: ${unreadable.join(", ")}.`);
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await stopClients(clients);
  await runCauseEffect(manager.stop()).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
