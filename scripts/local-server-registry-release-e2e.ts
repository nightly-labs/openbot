// Checks the local-server registry in this checkout against the released build's registry. An older
// build rewrites the servers file, and the pending account removals must survive that rewrite.
// The released source is read from git at RELEASE, a pinned commit that CI fetches shallowly. The
// pre-fix baseline is pinned to BASELINE_PRE_FIX, a commit that holds the bug. It runs only with
// `--baseline-evidence`, and writes its own file: the bad run is QA evidence, not a regression pass.
// No live account, device or user data is touched: every server is synthetic and in a temp folder.
// Run: `bun run test:local-server-registry-release`. Writes
// .openbot-build/local-server-registry-release-e2e/report.json (redacted: no paths, no secret values).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, Result } from "effect";

/** The official v0.59.0 release commit. Its package version is checked below. */
const RELEASE = "ed395dadf500922a358422b3514aa3aa3e6c6400";
/** The upstream commit that introduced the bug: its registry keeps the pending list inline in the servers file. */
const BASELINE_PRE_FIX = "0de6ae1a6c93a6938d1da50a0cd8a82d538fb9b1";
const RELEASE_VERSION = "0.59.0";
const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = "src/main/local-servers/local-server-registry.ts";
const HELPER = "src/backend/atomic-json-file";
const OUT = join(ROOT, ".openbot-build/local-server-registry-release-e2e");
const SERVERS_FILE = "openbot-local-servers-v1.json";
const PENDING_FILE = "openbot-local-servers-pending-removals-v1.json";
const LIMIT = 5;
const BASELINE_EVIDENCE = process.argv.includes("--baseline-evidence");

interface Row {
  id: string;
  name: string;
  createdAt: string;
  encryptedSecret: string;
  serverId: string | null;
  fingerprint: string | null;
  publicKey: string | null;
}

interface RegistryLike {
  load(): Effect.Effect<void, unknown>;
  add(row: Row, limit: number): Effect.Effect<void, unknown>;
  update(id: string, change: Partial<Omit<Row, "id">>): Effect.Effect<void, unknown>;
  remove(id: string, removedHostId?: string | null): Effect.Effect<void, unknown>;
  forgetRemovedHost(hostId: string): Effect.Effect<void, unknown>;
  readonly removedHostIds: readonly string[];
  readonly servers: readonly Row[];
  readonly readOnly: boolean;
}

type RegistryClass = new (path: string) => RegistryLike;

/** One checked scenario. Every list is a list of synthetic IDs, never a secret value. */
interface ScenarioResult {
  readonly scenario: string;
  readonly build: string;
  readonly idsBefore: readonly string[];
  readonly idsAfter: readonly string[];
  readonly retainedServerIds: readonly string[];
  readonly checks: readonly string[];
}

interface Report {
  status: "pass" | "fail" | "pre-fix-loss-reproduced";
  releaseCommit: string;
  releasePackageVersion: string | null;
  currentSource: "working-copy";
  preFixBaselineCommit: string;
  scenarios: ScenarioResult[];
  failure?: string;
}

/** A file at a commit. A shallow checkout has only the commits the CI lane fetched, so a miss says how to fetch it. */
function fromGit(revision: string, path: string): string {
  try {
    return execFileSync("git", ["show", `${revision}:${path}`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    throw new Error(
      `Commit ${revision.slice(0, 9)} is not in this checkout. Run: git fetch --no-tags --depth=1 origin ${revision}`,
    );
  }
}

function isRegistryModule(value: unknown): value is { LocalServerRegistry: RegistryClass } {
  return (
    typeof value === "object" &&
    value !== null &&
    "LocalServerRegistry" in value &&
    typeof value.LocalServerRegistry === "function"
  );
}

function packageVersion(json: string): string | null {
  const parsed = JSON.parse(json);
  return typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string"
    ? parsed.version
    : null;
}

/** Loads a registry module from a git revision, or from the working copy. Its imports stay in this checkout. */
async function registryClass(label: string, revision: string | "working-copy"): Promise<RegistryClass> {
  const source = revision === "working-copy" ? await readFile(join(ROOT, SOURCE), "utf8") : fromGit(revision, SOURCE);
  const helper = JSON.stringify(join(ROOT, HELPER));
  const modules = join(OUT, "modules");
  await mkdir(modules, { recursive: true });
  const file = join(modules, `${label}.ts`);
  await writeFile(file, source.replaceAll(`"../../backend/atomic-json-file"`, helper));
  const loaded = await import(file);
  assert.ok(isRegistryModule(loaded), `${label} exports LocalServerRegistry.`);
  return loaded.LocalServerRegistry;
}

const UUID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const row = (n: number, serverId: string | null, secret: string): Row => ({
  id: UUID(n),
  name: `Synthetic server ${n}`,
  createdAt: "2026-11-03T00:00:00.000Z",
  encryptedSecret: secret,
  serverId,
  fingerprint: null,
  publicKey: null,
});
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

/** One registry instance, opened and loaded from disk. */
async function open(Registry: RegistryClass, file: string): Promise<RegistryLike> {
  const registry = new Registry(file);
  await run(registry.load());
  return registry;
}

/**
 * A pending removal, then an unrelated released edit, then an acknowledgement, then another
 * released edit. Returns what the current build saw at each reopen.
 */
async function pendingAcrossReleasedEdits(
  Current: RegistryClass,
  Released: RegistryClass,
  dir: string,
): Promise<{ before: string[]; afterReleased: string[]; afterAck: string[]; retained: string[] }> {
  const file = join(dir, SERVERS_FILE);
  const hostA = "synthetic-host-a";
  const run1 = await open(Current, file);
  await run(run1.add(row(1, hostA, "synthetic-secret-a"), LIMIT));
  await run(run1.add(row(2, "synthetic-live-host", "synthetic-secret-keep"), LIMIT));
  await run(run1.remove(UUID(1), hostA));
  const before = [...run1.removedHostIds];
  await run((await open(Released, file)).add(row(3, null, "synthetic-secret-released"), LIMIT));
  const run2 = await open(Current, file);
  const afterReleased = [...run2.removedHostIds];
  await run(run2.forgetRemovedHost(hostA));
  await run((await open(Released, file)).update(UUID(3), { name: "Synthetic server 3, renamed" }));
  const run3 = await open(Current, file);
  return {
    before,
    afterReleased,
    afterAck: [...run3.removedHostIds],
    retained: run3.servers.map((server) => server.id),
  };
}

const report: Report = {
  status: "fail",
  releaseCommit: RELEASE,
  releasePackageVersion: null,
  currentSource: "working-copy",
  preFixBaselineCommit: BASELINE_PRE_FIX,
  scenarios: [],
};

const temp = await mkdtemp(join(tmpdir(), "openbot-registry-release-e2e-"));
try {
  const releaseVersion = packageVersion(fromGit(RELEASE, "package.json"));
  report.releasePackageVersion = releaseVersion;
  assert.equal(releaseVersion, RELEASE_VERSION, "The pinned commit is the v0.59.0 source.");
  const Released = await registryClass("released", RELEASE);
  const Current = await registryClass("current", "working-copy");

  if (BASELINE_EVIDENCE) {
    // QA evidence only: the pre-fix commit must still lose the pending removal after a released edit.
    const Baseline = await registryClass("pre-fix", BASELINE_PRE_FIX);
    const dir = await mkdtemp(join(temp, "pre-fix-"));
    const result = await pendingAcrossReleasedEdits(Baseline, Released, dir);
    assert.deepEqual(
      result.afterReleased,
      [],
      "The pre-fix baseline loses the pending removal after the released edit.",
    );
    report.status = "pre-fix-loss-reproduced";
    report.scenarios.push({
      scenario: "pending-removal-across-released-edits",
      build: "pre-fix",
      idsBefore: result.before,
      idsAfter: result.afterReleased,
      retainedServerIds: result.retained,
      checks: ["pre-fix commit loses the pending removal after the released edit"],
    });
    process.stdout.write(`PASS: pre-fix baseline ${BASELINE_PRE_FIX.slice(0, 9)} loses the pending removal.\n`);
  } else {
    // Scenario 1: the current build keeps the pending removal across released edits, keeps the rows,
    // and an acknowledged ID stays cleared.
    {
      const dir = await mkdtemp(join(temp, "pending-"));
      const result = await pendingAcrossReleasedEdits(Current, Released, dir);
      assert.deepEqual(result.before, ["synthetic-host-a"], "The removal is recorded.");
      assert.deepEqual(result.afterReleased, ["synthetic-host-a"], "The removal survives a released edit.");
      assert.deepEqual(result.afterAck, [], "An acknowledged ID stays cleared.");
      assert.deepEqual([...result.retained].sort(), [UUID(2), UUID(3)].sort(), "Both rows that stay are kept.");
      assert.equal(
        (await readFile(join(dir, PENDING_FILE), "utf8")).includes("synthetic-secret"),
        false,
        "No secret is in the pending file.",
      );
      report.scenarios.push({
        scenario: "pending-removal-across-released-edits",
        build: "current",
        idsBefore: result.before,
        idsAfter: result.afterReleased,
        retainedServerIds: result.retained,
        checks: [
          "removal survives a released edit",
          "acknowledged ID stays cleared",
          "rows kept",
          "no secret in pending file",
        ],
      });
    }

    // Scenario 2: an ID the earlier build kept in the servers file moves to the pending file first.
    {
      const dir = await mkdtemp(join(temp, "legacy-"));
      const file = join(dir, SERVERS_FILE);
      const legacyHost = "synthetic-legacy-host";
      await writeFile(
        file,
        `${JSON.stringify({ version: 1, servers: [row(4, null, "synthetic-secret-legacy")], removedHostIds: [legacyHost] })}\n`,
      );
      const migrated = await open(Current, file);
      assert.deepEqual([...migrated.removedHostIds], [legacyHost], "The legacy inline ID is read.");
      await run(migrated.add(row(5, null, "synthetic-secret-after-migration"), LIMIT));
      await run((await open(Released, file)).add(row(6, null, "synthetic-secret-released-2"), LIMIT));
      const reopened = await open(Current, file);
      assert.deepEqual([...reopened.removedHostIds], [legacyHost], "A legacy ID survives a released edit.");
      report.scenarios.push({
        scenario: "legacy-inline-id-migration",
        build: "current",
        idsBefore: [legacyHost],
        idsAfter: [...reopened.removedHostIds],
        retainedServerIds: reopened.servers.map((server) => server.id),
        checks: ["legacy inline ID moves to the pending file", "survives a released edit"],
      });
    }

    // Scenario 3: a crash between the two writes leaves a pending ID while its row is still on disk.
    // The row is not deregistered: its ID is held back.
    {
      const dir = await mkdtemp(join(temp, "crash-"));
      const file = join(dir, SERVERS_FILE);
      const liveHost = "synthetic-live-after-crash";
      await run((await open(Current, file)).add(row(7, liveHost, "synthetic-secret-crash"), LIMIT));
      await writeFile(join(dir, PENDING_FILE), `${JSON.stringify({ version: 1, removedHostIds: [liveHost] })}\n`);
      const reopened = await open(Current, file);
      assert.deepEqual([...reopened.removedHostIds], [], "A live row keeps its server: the pending ID is held back.");
      assert.equal(reopened.servers.length, 1, "The row stays after the interrupted write.");
      report.scenarios.push({
        scenario: "interrupted-write-live-row",
        build: "current",
        idsBefore: [liveHost],
        idsAfter: [],
        retainedServerIds: reopened.servers.map((server) => server.id),
        checks: ["pending ID held back while its row is live"],
      });
    }

    // Scenario 4: ordinary edits create no pending file, and reopening or editing a migrated profile
    // does not rewrite it. An atomic write replaces the file with a new inode.
    {
      const dir = await mkdtemp(join(temp, "ordinary-"));
      const file = join(dir, SERVERS_FILE);
      const pending = join(dir, PENDING_FILE);
      const ordinary = await open(Current, file);
      await run(ordinary.add(row(9, null, "synthetic-secret-ordinary"), LIMIT));
      await run(ordinary.update(UUID(9), { name: "Synthetic server 9, renamed" }));
      assert.equal(existsSync(pending), false, "An ordinary edit creates no pending file.");

      const migratedHost = "synthetic-migrated-host";
      await writeFile(
        file,
        `${JSON.stringify({ version: 1, servers: [row(10, null, "synthetic-secret-migrated")], removedHostIds: [migratedHost] })}\n`,
      );
      await open(Current, file);
      const inode = (await stat(pending)).ino;
      const reopened = await open(Current, file);
      await run(reopened.update(UUID(10), { name: "Synthetic server 10, renamed" }));
      await open(Current, file);
      assert.equal((await stat(pending)).ino, inode, "A migrated profile is not rewritten by reopening or editing.");
      report.scenarios.push({
        scenario: "no-rewrite-when-unchanged",
        build: "current",
        idsBefore: [migratedHost],
        idsAfter: [...(await open(Current, file)).removedHostIds],
        retainedServerIds: [UUID(9), UUID(10)],
        checks: ["ordinary edit creates no pending file", "reopen and edit do not rewrite a migrated profile"],
      });
    }

    // Scenario 5: an acknowledged ID cannot come back from an older copy of the servers file that lists it.
    {
      const dir = await mkdtemp(join(temp, "stale-"));
      const file = join(dir, SERVERS_FILE);
      const staleHost = "synthetic-stale-host";
      await writeFile(file, `${JSON.stringify({ version: 1, servers: [], removedHostIds: [staleHost] })}\n`);
      const acknowledging = await open(Current, file);
      assert.deepEqual([...acknowledging.removedHostIds], [staleHost]);
      await run(acknowledging.forgetRemovedHost(staleHost));
      await writeFile(file, `${JSON.stringify({ version: 1, servers: [], removedHostIds: [staleHost] })}\n`);
      const afterStaleCopy = await open(Current, file);
      assert.deepEqual(
        [...afterStaleCopy.removedHostIds],
        [],
        "A stale inline copy does not resurrect an acknowledged ID.",
      );
      report.scenarios.push({
        scenario: "no-resurrection-from-stale-copy",
        build: "current",
        idsBefore: [staleHost],
        idsAfter: [],
        retainedServerIds: [],
        checks: ["acknowledged ID stays cleared after a stale inline copy"],
      });
    }

    // Scenario 6: the pending file is written, then the servers file fails. The row is still on disk,
    // so its ID is held back and the row is kept.
    {
      const dir = await mkdtemp(join(temp, "partial-"));
      const file = join(dir, SERVERS_FILE);
      const liveHost = "synthetic-partial-host";
      const partial = await open(Current, file);
      await run(partial.add(row(11, liveHost, "synthetic-secret-partial"), LIMIT));
      // A directory where the servers file belongs makes its write fail after the pending file is written.
      await rm(file);
      await mkdir(file);
      const failed = await Effect.runPromise(partial.remove(UUID(11), liveHost).pipe(Effect.result));
      assert.ok(Result.isFailure(failed), "The servers write fails.");
      await rm(file, { recursive: true });
      await writeFile(
        file,
        `${JSON.stringify({ version: 1, servers: [row(11, liveHost, "synthetic-secret-partial")] })}\n`,
      );
      const recovered = await open(Current, file);
      assert.deepEqual([...recovered.removedHostIds], [], "A partial write does not leave the live host pending.");
      assert.deepEqual(
        recovered.servers.map((server) => server.id),
        [UUID(11)],
        "The live row stays after a partial write.",
      );
      report.scenarios.push({
        scenario: "partial-write-keeps-live-row",
        build: "current",
        idsBefore: [liveHost],
        idsAfter: [],
        retainedServerIds: [UUID(11)],
        checks: ["partial write does not deregister a live row"],
      });
    }

    // Scenario 7: an unreadable pending file is kept in place. Its servers-file copy of the list is
    // never actionable, writes are refused, and two fresh instances agree on every load.
    for (const [shape, contents] of [
      ["zero-filled", "\0\0\0\0\0\0\0\0"],
      ["unparseable", "{not json"],
    ] as const) {
      const dir = await mkdtemp(join(temp, `unreadable-${shape}-`));
      const file = join(dir, SERVERS_FILE);
      const pending = join(dir, PENDING_FILE);
      const staleInline = "synthetic-stale-inline";
      await writeFile(
        file,
        `${JSON.stringify({ version: 1, servers: [row(12, null, "synthetic-secret-unreadable")], removedHostIds: [staleInline] })}\n`,
      );
      await writeFile(pending, contents);
      // Two fresh instances. An unparseable file fails the load, and a zero-filled one loads as read-only.
      const instances: RegistryLike[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const instance = new Current(file);
        await Effect.runPromise(instance.load().pipe(Effect.result));
        instances.push(instance);
      }
      const [first, second] = instances;
      assert.ok(first !== undefined && second !== undefined);
      for (const instance of instances) {
        assert.deepEqual([...instance.removedHostIds], [], `${shape}: the stale inline ID is not actionable.`);
        assert.equal(instance.readOnly, true, `${shape}: the registry is read-only.`);
      }
      const refused = await Effect.runPromise(
        second.add(row(13, null, "synthetic-secret-refused"), LIMIT).pipe(Effect.result),
      );
      assert.ok(Result.isFailure(refused), `${shape}: writes are refused.`);
      assert.equal(
        await readFile(pending, "utf8"),
        contents,
        `${shape}: the unreadable file stays in place, unchanged.`,
      );
      assert.equal(
        (await readdir(dir)).some((name) => name.startsWith(`${PENDING_FILE}.corrupt-`)),
        false,
        `${shape}: nothing is set aside.`,
      );
      report.scenarios.push({
        scenario: "unreadable-pending-file",
        build: `current:${shape}`,
        idsBefore: [staleInline],
        idsAfter: [],
        retainedServerIds: [UUID(12)],
        checks: [
          "stale inline ID is not actionable on two fresh loads",
          "registry is read-only",
          "writes are refused",
          "unreadable file kept in place, unchanged",
          "nothing set aside",
        ],
      });
    }

    report.status = "pass";
    process.stdout.write(
      `PASS: ${report.scenarios.length} registry scenarios against release ${RELEASE.slice(0, 9)}.\n`,
    );
  }
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  process.stdout.write(`FAIL: ${report.failure}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const name = BASELINE_EVIDENCE ? "pre-fix-baseline-evidence.json" : "report.json";
  await writeFile(join(OUT, name), `${JSON.stringify(report, null, 2)}\n`);
}
