// Drives the real LocalServers service over a synthetic profile in a temp folder. The row is written
// through LocalServerRegistry.add, the marker files are plain files, and the trash, the account and the
// child spawn are counting fakes. The spawn throws, so an unexpected child start is also a failure.
// On a damaged registry, every load-time start, restart, create and delete must be refused before a
// folder is moved, an account is changed or a child is spawned. A healthy profile must still delete.
// No live account, device or user file is touched. Run: `bun run test:local-servers-damaged-state`.
// Writes .openbot-build/local-servers-damaged-state-e2e/report.json (no paths, no secret values).
import assert from "node:assert/strict";
import type { SpawnOptions } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { LOCAL_SERVERS_FILE, LocalServerRegistry } from "../src/main/local-servers/local-server-registry";
import { LocalServers, type LocalServersOptions } from "../src/main/local-servers/local-servers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/local-servers-damaged-state-e2e");
const PENDING_FILE = "openbot-local-servers-pending-removals-v1.json";
const LIMIT = 5;
const decodeRegistryCount = Schema.decodeUnknownSync(Schema.Struct({ servers: Schema.Array(Schema.Unknown) }));
const ROW_FOLDER_ID = "00000000-0000-0000-0000-000000000021";
const ROW_HOST_ID = "synthetic-host-row";
const LEGACY_HOST = "synthetic-legacy-host";
const CIPHER = {
  encrypt: (value: string) => Buffer.from(`sealed:${value}`).reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString().slice("sealed:".length),
};

/** One checked case. Counts are what the fakes saw, and `refused` names the actions that were refused. */
interface CaseResult {
  case: string;
  refused?: string[];
  trashed: number;
  accountRemovals?: number;
  spawned?: number;
  rowsKept: number;
}

/** What the fakes saw. On a damaged profile every count must stay at zero. */
interface Recorder {
  spawned: number;
  trashed: string[];
  accountRemovals: number;
  warnings: number;
  waiters: Array<() => void>;
}

const fresh = (): Recorder => ({ spawned: 0, trashed: [], accountRemovals: 0, warnings: 0, waiters: [] });

/** Resolves on the next event that the startup path reports: a spawn attempt, or a logged start failure. */
function nextStartEvent(recorder: Recorder): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The startup reported no event.")), 10_000);
    recorder.waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function notify(recorder: Recorder): void {
  for (const waiter of recorder.waiters.splice(0)) waiter();
}

function service(root: string, recorder: Recorder): LocalServers {
  const options: LocalServersOptions = {
    registryPath: join(root, LOCAL_SERVERS_FILE),
    userDataRoot: join(root, "local-servers"),
    agentRoot: join(root, "OpenBot", "Servers"),
    runtimeRoot: join(root, "provider-runtimes"),
    cipher: { encrypt: (value) => CIPHER.encrypt(value), decrypt: (value) => CIPHER.decrypt(value) },
    remoteServers: {
      setThisComputerServers: () => undefined,
      attachLocalServer: (input) => Effect.succeed(summary(input.serverId, input.select)),
      detachLocalServer: () => Effect.void,
    },
    account: {
      accountId: () => "synthetic-account",
      register: () => Effect.void,
      credential: () => "synthetic-machine-token",
      remove: () => {
        recorder.accountRemovals += 1;
        return Effect.void;
      },
    },
    command: { executable: "/synthetic/OpenBot", args: [] },
    trash: (path) => {
      recorder.trashed.push(path);
      return Promise.resolve();
    },
    log: {
      info: () => undefined,
      warn: () => {
        recorder.warnings += 1;
        notify(recorder);
      },
    },
    platform: "darwin",
    spawn: (_command: string, _args: readonly string[], _options: SpawnOptions) => {
      recorder.spawned += 1;
      notify(recorder);
      throw new Error("A child was spawned on a profile that should not start one.");
    },
  };
  return new LocalServers(options);
}

function summary(serverId: string, select: boolean): ServerSummary {
  return {
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    id: serverId,
    kind: "remote",
    apiUrl: "http://127.0.0.1:45123",
    remoteDesktopAvailable: false,
    logoUrl: null,
    name: "Synthetic studio",
    role: "owner",
    state: "online",
    active: select,
    thisComputer: true,
  };
}

/** The message of a failure, or null when the effect succeeded. Never the raw error object. */
async function failureMessage(effect: Effect.Effect<unknown, unknown>): Promise<string | null> {
  const result = await Effect.runPromise(effect.pipe(Effect.result));
  if (Result.isSuccess(result)) return null;
  const failure = result.failure;
  const cause = typeof failure === "object" && failure !== null && "cause" in failure ? failure.cause : failure;
  return cause instanceof Error ? cause.message : "A failure without a message.";
}

/** The rows the registry file holds, read from disk. */
async function registryRowCount(root: string): Promise<number> {
  const file = decodeRegistryCount(JSON.parse(await readFile(join(root, LOCAL_SERVERS_FILE), "utf8")));
  return file.servers.length;
}

/** Writes one synthetic row straight to the registry file, with its folders and a marker in each. */
async function arrangeRow(root: string): Promise<{ folders: string[] }> {
  const registry = new LocalServerRegistry(join(root, LOCAL_SERVERS_FILE));
  await Effect.runPromise(registry.load());
  await Effect.runPromise(
    registry.add(
      {
        id: ROW_FOLDER_ID,
        name: "Synthetic studio",
        createdAt: "2026-11-03T00:00:00.000Z",
        encryptedSecret: CIPHER.encrypt("synthetic-secret").toString("base64"),
        serverId: ROW_HOST_ID,
        fingerprint: null,
        publicKey: null,
      },
      LIMIT,
    ),
  );
  const folders = [join(root, "local-servers", ROW_FOLDER_ID), join(root, "OpenBot", "Servers", ROW_FOLDER_ID)];
  for (const folder of folders) {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "synthetic-marker.txt"), "synthetic");
  }
  return { folders };
}

/** The damaged-state checks: a row loads, startup spawns nothing, and every destructive action is refused. */
async function assertDamagedRefusals(
  name: string,
  root: string,
  folders: string[],
  readOnlyMessage: string,
): Promise<CaseResult> {
  const recorder = fresh();
  const damaged = service(root, recorder);
  await Effect.runPromise(damaged.load());
  assert.equal(damaged.list().servers.length, 1, `${name}: the row loads, as before.`);

  // Startup: the initialize forks one start per row. Wait for its event, not for a time.
  const startup = nextStartEvent(recorder);
  await Effect.runPromise(damaged.initialize());
  await startup;
  assert.equal(recorder.spawned, 0, `${name}: startup spawns no child.`);

  const messages = {
    deleteDesktop: await failureMessage(damaged.delete(ROW_HOST_ID, "desktop")),
    deleteDevice: await failureMessage(damaged.delete(ROW_HOST_ID, "device")),
    restart: await failureMessage(damaged.restart(ROW_HOST_ID)),
    create: await failureMessage(damaged.create("Refused studio")),
  };
  for (const [action, message] of Object.entries(messages)) {
    assert.equal(message, readOnlyMessage, `${name}: ${action} is refused with the read-only message.`);
  }
  assert.deepEqual(recorder.trashed, [], `${name}: no folder is moved to the Trash.`);
  assert.equal(recorder.accountRemovals, 0, `${name}: no account removal.`);
  assert.equal(recorder.spawned, 0, `${name}: no child is spawned.`);
  for (const folder of folders) {
    assert.deepEqual(await readdir(folder), ["synthetic-marker.txt"], `${name}: the marker stays.`);
  }
  assert.equal(await registryRowCount(root), 1, `${name}: the row stays in the registry file.`);
  return { case: name, refused: Object.keys(messages), trashed: 0, accountRemovals: 0, spawned: 0, rowsKept: 1 };
}

const cases: CaseResult[] = [];
const report: { status: "pass" | "fail"; cases: CaseResult[]; failure?: string } = { status: "fail", cases };
const temp = await mkdtemp(join(tmpdir(), "openbot-local-servers-damaged-"));
const readOnlyMessage = sourceText("error.remote.localServersReadOnly");

try {
  // Case A: a pending file that cannot be read. The row loads and every destructive action is refused.
  {
    const root = await mkdtemp(join(temp, "unreadable-pending-"));
    const { folders } = await arrangeRow(root);
    await writeFile(join(root, PENDING_FILE), "{not json");
    cases.push(await assertDamagedRefusals("unreadable pending file", root, folders, readOnlyMessage));
    assert.equal(await readFile(join(root, PENDING_FILE), "utf8"), "{not json", "The unreadable file is unchanged.");
  }

  // Case B: a one-time migration of an inline list that cannot be written. The directory refuses writes,
  // so the migration fails after the inline list is read. The registry must still refuse every action.
  {
    const root = await mkdtemp(join(temp, "failed-migration-"));
    const { folders } = await arrangeRow(root);
    const registryFile = join(root, LOCAL_SERVERS_FILE);
    const current = JSON.parse(await readFile(registryFile, "utf8"));
    await writeFile(registryFile, `${JSON.stringify({ ...current, removedHostIds: [LEGACY_HOST] })}\n`);
    await chmod(root, 0o500);
    try {
      cases.push(await assertDamagedRefusals("failed inline migration", root, folders, readOnlyMessage));
    } finally {
      await chmod(root, 0o700);
    }
  }

  // Control: a healthy profile still deletes the row by its server ID, moves both folders to the Trash,
  // and removes the row from the registry file.
  {
    const root = await mkdtemp(join(temp, "healthy-"));
    const { folders } = await arrangeRow(root);
    const recorder = fresh();
    const healthy = service(root, recorder);
    await Effect.runPromise(healthy.load());
    assert.equal(await failureMessage(healthy.delete(ROW_HOST_ID, "desktop")), null, "A healthy delete succeeds.");
    assert.deepEqual(recorder.trashed, folders, "A healthy delete moves both folders to the Trash.");
    assert.equal(await registryRowCount(root), 0, "A healthy delete removes the row from the registry file.");
    cases.push({ case: "healthy delete", trashed: recorder.trashed.length, rowsKept: 0 });
  }

  report.status = "pass";
  process.stdout.write(`PASS: ${cases.length} damaged-state cases; the refusals and the healthy delete hold.\n`);
} catch (error) {
  report.failure = error instanceof Error ? error.message || error.name : "A failure without a message.";
  process.exitCode = 1;
  process.stdout.write(`FAIL: ${report.failure}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
