// The versioned JSON stores keep a file that a newer release wrote. Drives the real stores over real
// files, for each store:
// - each released version loads, and a change writes the current version to the store's path;
// - a file of a newer version (99) stays byte for byte the same: the store starts from its defaults,
//   a change goes to `<path>.v<current>`, and a restart reads that change again;
// - a file that no released version can read (not JSON, not an object, no version, an unknown older
//   version) goes to `<path>.corrupt-<time>` with its bytes, the store starts empty, and a change
//   writes to the path again, so a later release reads it.
// The browser state is read with `readBrowserState`: its writer is the Electron `BrowserHost`, which
// writes to the `writePath` that this read returns.
// `bun run test:versioned-json-stores`. Writes .openbot-build/versioned-json-stores-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { MemoryReviewCursors } from "../src/backend/agent/memory-review-cursors";
import { readBrowserState } from "../src/backend/browser-state";
import { LibraryFoldersStore } from "../src/backend/library-folders-store";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { UserBrowsingLog } from "../src/backend/user-browsing-log";
import { versionedJsonFallbackPath } from "../src/backend/versioned-json-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/versioned-json-stores-e2e");
const FUTURE_VERSION = 99;

/** One open store: `marker` is what the test reads back, and `change` adds `name` to it. */
interface OpenStore {
  marker(): readonly string[];
  change(name: string): Promise<void>;
}

interface StoreCase {
  name: string;
  current: number;
  released: { version: number; file: unknown; marker: readonly string[] }[];
  open(path: string): Promise<OpenStore>;
}

interface StoreReport {
  store: string;
  released: { version: number; loaded: readonly string[]; writtenVersion: number | null }[];
  future: { bytesUnchanged: boolean; fallback: string; fallbackVersion: number | null; reloaded: readonly string[] };
  damaged: { contents: string; setAside: string; bytesKept: boolean; startedEmpty: boolean }[];
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

const SECTION_ID = randomUUID();
const sidebarFile = (version: 1 | 2) => ({
  version,
  revision: 3,
  sections: [{ id: SECTION_ID, name: "Released" }],
  order: [SIDEBAR_PEOPLE_SECTION_ID, SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID],
  agentAssignments: { "agent-a": SECTION_ID },
  ...(version === 2 ? { agentOrder: ["agent-a"] } : {}),
});

const FOLDER_ID = randomUUID();
const AGENTS = new Set(["agent-a"]);

const browserTab = (url: string) => ({ id: `tab-${url.length}`, url, ownerThreadId: null, ownerAgentId: null });

const STORES: StoreCase[] = [
  {
    name: "sidebar layout",
    current: 2,
    released: [
      { version: 1, file: sidebarFile(1), marker: ["Released"] },
      { version: 2, file: sidebarFile(2), marker: ["Released"] },
    ],
    async open(path) {
      const store = new SidebarLayoutStore(path);
      await run(store.initialize());
      return {
        marker: () => store.getSnapshot().sections.map((section) => section.name),
        change: async (name) => {
          await run(store.mutate({ type: "create", name }, AGENTS));
        },
      };
    },
  },
  {
    name: "library folders",
    current: 1,
    released: [
      {
        version: 1,
        file: {
          version: 1,
          revision: 2,
          folders: [{ id: FOLDER_ID, agentId: "agent-a", name: "Released" }],
          placement: {},
        },
        marker: ["Released"],
      },
    ],
    async open(path) {
      const store = new LibraryFoldersStore(path);
      await run(store.initialize());
      return {
        marker: () => store.getSnapshot().folders.map((folder) => folder.name),
        change: async (name) => {
          await run(
            store.mutate(
              { type: "create", id: randomUUID(), agentId: "agent-a", name },
              { agentIds: AGENTS, fileAgent: () => undefined },
            ),
          );
        },
      };
    },
  },
  {
    name: "user browsing log",
    current: 1,
    released: [
      {
        version: 1,
        file: {
          version: 1,
          agents: [
            { agentId: "agent-a", steps: [{ at: Date.now(), kind: "page", host: "example.com", path: "/released" }] },
          ],
        },
        marker: ["/released"],
      },
    ],
    async open(path) {
      const log = new UserBrowsingLog(path);
      await run(log.load());
      const steps: string[] = (await run(log.pending("agent-a"))).map((step) => step.path);
      return {
        marker: () => steps,
        change: async (name) => {
          await run(log.record("agent-a", { kind: "page", host: "example.com", path: `/${name}` }));
          steps.splice(0, steps.length, ...(await run(log.pending("agent-a"))).map((step) => step.path));
        },
      };
    },
  },
  {
    name: "memory review cursors",
    current: 1,
    released: [
      {
        version: 1,
        file: { version: 1, cursors: [{ agentId: "agent-a", threadId: null, cursor: "Released" }] },
        marker: ["Released"],
      },
    ],
    async open(path) {
      const cursors = new MemoryReviewCursors(path);
      await run(cursors.load());
      const read = () => [cursors.get("agent-a", null), cursors.get("agent-a", "thread-b")].filter((c) => c !== null);
      return {
        marker: read,
        change: async (name) => {
          await run(cursors.set("agent-a", "thread-b", name));
        },
      };
    },
  },
];

/** Bytes of the file, or null when there is none. */
async function bytes(path: string): Promise<Buffer | null> {
  return readFile(path).catch(() => null);
}

/** The `version` of the JSON file, or null when there is no file or no numeric version. */
async function version(path: string): Promise<number | null> {
  const contents = await bytes(path);
  if (contents === null) return null;
  const file: { version?: unknown } = JSON.parse(contents.toString("utf8"));
  return typeof file.version === "number" ? file.version : null;
}

async function caseFor(root: string, store: StoreCase): Promise<StoreReport> {
  const directory = join(root, store.name.replaceAll(" ", "-"));
  await mkdir(directory, { recursive: true });
  const report: StoreReport = {
    store: store.name,
    released: [],
    future: { bytesUnchanged: false, fallback: "", fallbackVersion: null, reloaded: [] },
    damaged: [],
  };

  for (const released of store.released) {
    const path = join(directory, `released-v${released.version}.json`);
    await writeFile(path, `${JSON.stringify(released.file)}\n`);
    const opened = await store.open(path);
    const loaded = [...opened.marker()];
    assert.deepEqual(loaded, released.marker, `${store.name}: version ${released.version} did not load`);
    await opened.change("Changed");
    const writtenVersion = await version(path);
    assert.equal(writtenVersion, store.current, `${store.name}: a change did not write version ${store.current}`);
    assert.equal(await bytes(versionedJsonFallbackPath(path, store.current)), null, `${store.name}: a fallback file`);
    report.released.push({ version: released.version, loaded, writtenVersion });
  }

  const futurePath = join(directory, "future.json");
  const futureBytes = Buffer.from(
    `${JSON.stringify({ version: FUTURE_VERSION, data: { kept: "written by a newer release" } }, null, 2)}\n`,
  );
  await writeFile(futurePath, futureBytes);
  const first = await store.open(futurePath);
  assert.deepEqual(first.marker(), [], `${store.name}: the newer file did not start from the defaults`);
  await first.change("Downgraded");
  const fallback = versionedJsonFallbackPath(futurePath, store.current);
  const fallbackVersion = await version(fallback);
  assert.equal(fallbackVersion, store.current, `${store.name}: the change did not go to ${basename(fallback)}`);
  const reopened = await store.open(futurePath);
  const reloaded = [...reopened.marker()];
  assert.equal(reloaded.length, 1, `${store.name}: a restart lost the change in ${basename(fallback)}`);
  await reopened.change("Again");
  const bytesUnchanged = (await bytes(futurePath))?.equals(futureBytes) === true;
  assert.ok(bytesUnchanged, `${store.name}: the newer file changed`);
  report.future = { bytesUnchanged, fallback: basename(fallback), fallbackVersion, reloaded };

  report.damaged = await damagedCases(directory, async (path) => {
    const opened = await store.open(path);
    const empty = opened.marker().length === 0;
    await opened.change("After damage");
    return empty;
  });
  return report;
}

/** Files that no released version can read. None of them may move the saves to a fallback file. */
const DAMAGED_FILES = ['{"version": 1, "cut off', "[1, 2]", '{"data": {}}', '{"version": 0}'];

/**
 * `startsEmpty` opens the store and, when it can change, changes it: the change must go to the path,
 * where a later release reads it, and never to `<path>.v<current>`.
 */
async function damagedCases(directory: string, startsEmpty: (path: string) => Promise<boolean>) {
  const results: StoreReport["damaged"] = [];
  for (const [index, contents] of DAMAGED_FILES.entries()) {
    const path = join(directory, `damaged-${index}.json`);
    const damaged = Buffer.from(contents);
    await writeFile(path, damaged);
    const startedEmpty = await startsEmpty(path);
    const setAside = (await readdir(dirname(path))).find((name) => name.startsWith(`${basename(path)}.corrupt-`)) ?? "";
    assert.ok(setAside, `${contents}: the damaged file was not set aside`);
    assert.ok(!(await bytes(path))?.equals(damaged), `${contents}: the damaged file stayed at the path`);
    const fallbacks = (await readdir(dirname(path))).filter((name) => name.startsWith(`${basename(path)}.v`));
    assert.deepEqual(fallbacks, [], `${contents}: the saves went to a fallback file`);
    const bytesKept = (await bytes(join(directory, setAside)))?.equals(damaged) === true;
    assert.ok(bytesKept, `${contents}: the set-aside file lost bytes`);
    assert.ok(startedEmpty, `${contents}: the store did not start empty`);
    results.push({ contents, setAside, bytesKept, startedEmpty });
  }
  return results;
}

async function browserCase(root: string): Promise<StoreReport> {
  const directory = join(root, "browser-state");
  await mkdir(directory, { recursive: true });
  const report: StoreReport = {
    store: "browser state (read)",
    released: [],
    future: { bytesUnchanged: false, fallback: "", fallbackVersion: null, reloaded: [] },
    damaged: [],
  };
  for (const released of [1, 2]) {
    const path = join(directory, `released-v${released}.json`);
    const url = `https://example.com/released-v${released}`;
    await writeFile(path, `${JSON.stringify({ version: released, activeTabId: null, tabs: [browserTab(url)] })}\n`);
    const { state, writePath } = await run(readBrowserState(path));
    assert.deepEqual(
      state.tabs.map((tab) => tab.url),
      [url],
      `browser state: version ${released} did not load`,
    );
    assert.equal(writePath, path, "browser state: a released file does not write to its path");
    report.released.push({ version: released, loaded: [url], writtenVersion: state.version });
  }

  const futurePath = join(directory, "future.json");
  const futureBytes = Buffer.from(
    `${JSON.stringify({ version: FUTURE_VERSION, tabs: [browserTab("https://example.com/newer")] })}\n`,
  );
  await writeFile(futurePath, futureBytes);
  const future = await run(readBrowserState(futurePath));
  const fallback = versionedJsonFallbackPath(futurePath, 2);
  assert.deepEqual(future.state.tabs, [], "browser state: the newer file did not start with no tabs");
  assert.equal(future.writePath, fallback, "browser state: the saves do not go to the fallback file");
  // What `BrowserHost` saves after a tab opens, read again at the next start.
  const saved = { version: 2, activeTabId: null, tabs: [browserTab("https://example.com/downgraded")] };
  await writeFile(future.writePath, `${JSON.stringify(saved)}\n`);
  const reread = await run(readBrowserState(futurePath));
  assert.equal(reread.writePath, fallback);
  const reloaded = reread.state.tabs.map((tab) => tab.url);
  assert.deepEqual(reloaded, ["https://example.com/downgraded"], "browser state: a restart lost the fallback tabs");
  const bytesUnchanged = (await bytes(futurePath))?.equals(futureBytes) === true;
  assert.ok(bytesUnchanged, "browser state: the newer file changed");
  report.future = { bytesUnchanged, fallback: basename(fallback), fallbackVersion: 2, reloaded };

  report.damaged = await damagedCases(directory, async (path) => {
    const { state, writePath } = await run(readBrowserState(path));
    assert.equal(writePath, path, "browser state: a damaged file moved the saves to a fallback file");
    return state.tabs.length === 0;
  });
  return report;
}

const root = await mkdtemp(join(tmpdir(), "openbot-versioned-json-stores-e2e-"));
const report: { passed: boolean; stores: StoreReport[]; failure?: string } = { passed: false, stores: [] };
try {
  await mkdir(OUT, { recursive: true });
  for (const store of STORES) report.stores.push(await caseFor(root, store));
  report.stores.push(await browserCase(root));
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${report.passed ? "passed" : `failed: ${report.failure}`} - ${join(OUT, "report.json")}\n`);
