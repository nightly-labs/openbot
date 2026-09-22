// @vitest-environment node

import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import lockValue from "../../native-runtime.lock.json";
import { parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import {
  ProviderRuntimeManager,
  type ProviderRuntimeManagerOptions,
  providerRuntimeRoot,
} from "./provider-runtime-manager";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A served `opencode-darwin-arm64` tarball with the lock rewritten to match it. */
/** A served `@oven/bun-darwin-aarch64` tarball with the lock rewritten to match it. */
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-provider-runtime-test-"));
  roots.push(root);
  return root;
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function chunkedResponse(value: Uint8Array, chunkSize: number, headers?: HeadersInit): Response {
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const next = value.slice(offset, offset + chunkSize);
        offset += next.byteLength;
        if (next.byteLength > 0) controller.enqueue(next);
        if (offset >= value.byteLength) controller.close();
      },
    }),
    { status: 200, headers },
  );
}

function grokFixture(): {
  executable: Uint8Array<ArrayBuffer>;
  license: Uint8Array<ArrayBuffer>;
  notices: Uint8Array<ArrayBuffer>;
  lock: ReturnType<typeof parseAgentRuntimeLock>;
} {
  const executable = new TextEncoder().encode(`#!/bin/sh\necho 1.0.22\n${"# runtime\n".repeat(1_000)}`);
  const license = new TextEncoder().encode("license\n");
  const notices = new TextEncoder().encode("notices\n");
  const lock = parseAgentRuntimeLock(structuredClone(lockValue));
  lock.grok.artifacts["darwin-arm64"].downloadBytes = executable.byteLength;
  lock.grok.artifacts["darwin-arm64"].installedBytes = executable.byteLength + 1_024;
  lock.grok.artifacts["darwin-arm64"].assetSha256 = digest(executable);
  lock.grok.licenseSha256 = digest(license);
  lock.grok.noticesSha256 = digest(notices);
  return { executable, license, notices, lock };
}

/** Six hours is the staging threshold and thirty days the version one; both are cleared here. */
const STAGING_AGE_MS = 7 * 60 * 60 * 1000;
const VERSION_AGE_MS = 31 * 24 * 60 * 60 * 1000;

/** The claim an instance leaves on a path while it replaces the runtime there. */
async function heldClaim(lock: string, claim: string): Promise<void> {
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "claim"), `${claim}\n`);
}

async function aged(path: string, age = STAGING_AGE_MS): Promise<void> {
  const when = new Date(Date.now() - age);
  await utimes(path, when, when);
}

interface SiblingOptions {
  /** Each instance keeps its partial transfers in a directory of its own. */
  downloadRoot: string;
  /** Holds the executable response, so another instance can commit while this one waits. */
  held?: Promise<void>;
  /** The swap the agent service makes for its running clients. */
  updateRuntime?: ProviderRuntimeManagerOptions["updateRuntime"];
  /** Counts what was asked for, to tell a skipped transfer from a repeated one. */
  onFetch?: (url: string) => void;
}

/** A manager on a store it shares with another, with a profile download directory of its own. */
function siblingManager(
  root: string,
  fixture: ReturnType<typeof grokFixture>,
  options: SiblingOptions,
): ProviderRuntimeManager {
  return new ProviderRuntimeManager({
    root,
    downloadRoot: options.downloadRoot,
    platform: "darwin",
    architecture: "arm64",
    lock: fixture.lock,
    updateRuntime: options.updateRuntime,
    fetchImpl: async (input) => {
      const url = String(input);
      options.onFetch?.(url);
      if (url.endsWith("/LICENSE")) return new Response(fixture.license);
      if (url.endsWith("/THIRD-PARTY-NOTICES")) return new Response(fixture.notices);
      await options.held;
      return chunkedResponse(fixture.executable, 1_024);
    },
  });
}

function waitFor(
  manager: ProviderRuntimeManager,
  predicate: (snapshot: ProviderRuntimeSnapshot) => boolean,
): Promise<ProviderRuntimeSnapshot> {
  return new Promise((resolve) => {
    const listener = (snapshot: ProviderRuntimeSnapshot) => {
      if (!predicate(snapshot)) return;
      manager.off("status", listener);
      resolve(snapshot);
    };
    manager.on("status", listener);
  });
}
describe("ProviderRuntimeManager (2/3)", () => {
  it("keeps the store inside a user data directory the caller named", () => {
    const override = join("/tmp", "openbot-automation");
    expect(providerRuntimeRoot({ appData: "/home/someone/.config", userDataOverride: `${override} ` })).toBe(
      join(override, "provider-runtimes"),
    );
  });

  it("keeps a staging directory another instance is still writing", async () => {
    const root = await temporaryRoot();
    const live = join(root, "grok", ".staging-darwin-arm64-1.0.22-999-abcd1234");
    const abandoned = join(root, "grok", ".staging-darwin-arm64-1.0.22-998-deadbeef");
    const replaced = join(root, "grok", ".replaced-darwin-arm64-1.0.22-c0ffee11");
    // What a released build, whose manager stages under the older name, left in the shared store.
    const released = join(root, "grok", ".installing-darwin-arm64-1.0.22");
    await Promise.all([live, abandoned, replaced, released].map((path) => mkdir(path, { recursive: true })));
    await Promise.all([abandoned, replaced, released].map((path) => aged(path)));
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });

    await manager.initialize();

    expect((await readdir(join(root, "grok"))).sort()).toEqual([basename(live)]);
  });

  it("stages an install where a released build's cleanup does not look", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    let staged: Promise<string[]> = Promise.resolve([]);
    const manager = siblingManager(root, fixture, {
      downloadRoot: join(root, ".downloads"),
      // The licence is read while the stage is on disk, which is the only moment its name is
      // visible from outside the manager.
      onFetch: (url) => {
        if (url.endsWith("/LICENSE")) staged = readdir(join(root, "grok"));
      },
    });
    await manager.initialize();

    await manager.downloadAndWait("grok");

    // Released builds share this store, and the manager they carry deletes every `.installing-`
    // directory when it starts, whatever its age and whoever is filling it.
    expect((await staged).filter((entry) => entry.startsWith("."))).toEqual([
      expect.stringMatching(/^\.staging-darwin-arm64-1\.0\.22-/),
    ]);
  });

  it("keeps a version directory another instance still uses", async () => {
    const root = await temporaryRoot();
    const kept = join(root, "grok", "darwin-arm64", "1.0.19");
    const collected = join(root, "grok", "darwin-arm64", "1.0.20");
    await Promise.all([kept, collected].map((path) => mkdir(path, { recursive: true })));
    // 1.0.21 is the newest older version, so it is kept by rank and says nothing about age.
    await mkdir(join(root, "grok", "darwin-arm64", "1.0.21"), { recursive: true });
    await aged(collected, VERSION_AGE_MS);
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });

    await manager.initialize();

    expect((await readdir(join(root, "grok", "darwin-arm64"))).sort()).toEqual(["1.0.19", "1.0.21"]);
  });

  it("keeps the fallback version an instance with an older pin still runs", async () => {
    const root = await temporaryRoot();
    const targetRoot = join(root, "grok", "darwin-arm64");
    const fallback = join(targetRoot, "1.0.20");
    const spare = join(targetRoot, "1.0.21");
    for (const version of [fallback, spare]) {
      await mkdir(join(version, "bin"), { recursive: true });
      await writeFile(join(version, "bin", "grok"), `#!/bin/sh\necho ${basename(version)}\n`);
    }
    await aged(fallback, VERSION_AGE_MS);
    const lock = parseAgentRuntimeLock(structuredClone(lockValue));
    lock.grok.version = "1.0.21";
    // A worktree one pin behind: 1.0.20 is the CLI its agent service runs until 1.0.21 is installed.
    const behind = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64", lock });
    const ahead = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });

    expect((await behind.initialize()).providers.grok.version).toBe("1.0.20");
    await ahead.initialize();

    // The other instance collects by its own reckoning, where 1.0.20 is neither the pinned version
    // nor its own spare. What the first instance left on the directory is the only thing that says
    // the version is in use, and a CLI removed under a running agent cannot be started again.
    await expect(access(join(fallback, "bin", "grok"))).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("starts when an old version cannot be collected", async () => {
    // The portable stand-in for Windows, where the binary a sibling instance runs refuses to be
    // removed. Housekeeping must never be what stops the app from starting.
    const root = await temporaryRoot();
    const targetRoot = join(root, "grok", "darwin-arm64");
    const collected = join(targetRoot, "1.0.20");
    await mkdir(collected, { recursive: true });
    await mkdir(join(targetRoot, "1.0.21"), { recursive: true });
    await aged(collected, VERSION_AGE_MS);
    await chmod(targetRoot, 0o500);
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });

    try {
      const snapshot = await manager.initialize();
      expect(snapshot.providers.grok).toMatchObject({ phase: "not-downloaded", availableVersion: null });
      await expect(access(collected)).resolves.toBeUndefined();
    } finally {
      await chmod(targetRoot, 0o700);
    }
  });

  it("adopts the runtime a sibling instance installed first", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sibling = siblingManager(root, fixture, { downloadRoot: join(root, "downloads-b") });
    const heldManager = siblingManager(root, fixture, { downloadRoot: join(root, "downloads-a"), held });
    await Promise.all([sibling.initialize(), heldManager.initialize()]);

    const waiting = heldManager.downloadAndWait("grok");
    await waitFor(heldManager, (snapshot) => snapshot.providers.grok.phase === "downloading");
    await sibling.downloadAndWait("grok");
    const installed = sibling.executablePath("grok");
    if (!installed) throw new Error("The managed Grok path is missing.");
    const committed = (await stat(installed)).ino;
    release?.();
    await waiting;

    for (const manager of [sibling, heldManager]) {
      expect(manager.getStatus().providers.grok).toMatchObject({ phase: "ready", version: "1.0.22" });
    }
    // The same file, not an identical one. A sibling already running this binary holds it open, and
    // on Windows would refuse to let it be replaced, so the second install has to adopt what is
    // there rather than take it away and put its own copy back.
    expect((await stat(installed)).ino).toBe(committed);
    expect(await readFile(installed, "utf8")).toBe(new TextDecoder().decode(fixture.executable));
    expect((await readdir(join(root, "grok"))).filter((entry) => entry.startsWith("."))).toEqual([]);
  });

  it("keeps a sibling's runtime when the copy it adopted cannot be activated", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sibling = siblingManager(root, fixture, { downloadRoot: join(root, "downloads-b") });
    const heldManager = siblingManager(root, fixture, {
      downloadRoot: join(root, "downloads-a"),
      held,
      updateRuntime: async (_provider, install) => {
        await install();
        throw new Error("Grok rejected the credentials.");
      },
    });
    await Promise.all([sibling.initialize(), heldManager.initialize()]);

    const waiting = expect(heldManager.downloadAndWait("grok")).rejects.toThrow("Grok rejected the credentials.");
    await waitFor(heldManager, (snapshot) => snapshot.providers.grok.phase === "downloading");
    await sibling.downloadAndWait("grok");
    const installed = sibling.executablePath("grok");
    if (!installed) throw new Error("The managed Grok path is missing.");
    release?.();

    await waiting;

    // The rejected-artifact rule takes away what this instance wrote. It wrote nothing here: the
    // sibling committed the version first, so the store holds the sibling's install, and the
    // sibling is running its CLI from it.
    expect(await readFile(installed, "utf8")).toBe(new TextDecoder().decode(fixture.executable));
    expect(sibling.getStatus().providers.grok).toMatchObject({ phase: "ready", version: "1.0.22" });
  });

  it("puts the runtime a sibling instance left in the store into use", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const activated: string[] = [];
    const fetched: string[] = [];
    const adopter = siblingManager(root, fixture, {
      downloadRoot: join(root, "downloads-b"),
      onFetch: (url) => fetched.push(url),
      updateRuntime: async (_provider, install) => {
        activated.push(await install());
      },
    });
    // This instance starts before the store holds the version, the way a running app does when the
    // offer appears; the sibling installs it while the offer waits on screen.
    await adopter.initialize();
    const installer = siblingManager(root, fixture, { downloadRoot: join(root, "downloads-a") });
    await installer.initialize();
    await installer.downloadAndWait("grok");

    await adopter.downloadAndWait("grok");

    // The whole point of the second instance's update: the agent service swaps its running clients
    // onto the pinned executable. Reporting "ready" without it left the old CLI in use, and the
    // offer on screen with no way left to answer it.
    expect(activated).toEqual([join(root, "grok", "darwin-arm64", "1.0.22", "bin", "grok")]);
    expect(fetched).toEqual([]);
    expect(adopter.getStatus().providers.grok).toMatchObject({ phase: "ready", version: "1.0.22" });
  });

  it("transfers once when two requests arrive together", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const fetched: string[] = [];
    const manager = siblingManager(root, fixture, {
      downloadRoot: join(root, ".downloads"),
      onFetch: (url) => fetched.push(url),
    });
    await manager.initialize();

    // Two presses of Update, or an update and the agent service asking for the same CLI. The second
    // has to find the first task rather than start a transfer of its own over the same file.
    const [first, second] = await Promise.all([manager.download("grok"), manager.download("grok")]);
    await manager.downloadAndWait("grok");

    expect(first.providers.grok.phase).toBe("downloading");
    expect(second.providers.grok.phase).toBe("downloading");
    expect(fetched.filter((url) => !url.endsWith("/LICENSE") && !url.endsWith("/THIRD-PARTY-NOTICES"))).toHaveLength(1);
  });

  it("replaces an installed version that no longer verifies", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const destination = join(root, "grok", "darwin-arm64", "1.0.22", "bin", "grok");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "#!/bin/sh\necho 1.0.22\n");
    const manager = siblingManager(root, fixture, { downloadRoot: join(root, ".downloads") });
    expect((await manager.initialize()).providers.grok.phase).toBe("not-downloaded");

    await manager.downloadAndWait("grok");

    expect(await readFile(destination, "utf8")).toBe(new TextDecoder().decode(fixture.executable));
    expect((await readdir(join(root, "grok"))).filter((entry) => entry.startsWith("."))).toEqual([]);
  });

  it("leaves a damaged runtime to the instance already replacing it", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const destination = join(root, "grok", "darwin-arm64", "1.0.22", "bin", "grok");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "#!/bin/sh\necho 1.0.22\n");
    const manager = siblingManager(root, fixture, { downloadRoot: join(root, ".downloads") });
    await manager.initialize();
    // The claim a sibling instance holds while it puts its own copy in place of the damaged one.
    await heldClaim(join(root, "grok", ".locking-darwin-arm64-1.0.22"), "4242-c0ffee11");

    await expect(manager.downloadAndWait("grok")).rejects.toThrow(/another instance/);

    // Untouched: the sibling is entitled to finish, and the install it commits is the one both use.
    expect(await readFile(destination, "utf8")).toBe("#!/bin/sh\necho 1.0.22\n");
  });

  it("replaces a damaged runtime when the instance that claimed it is gone", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const destination = join(root, "grok", "darwin-arm64", "1.0.22", "bin", "grok");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "#!/bin/sh\necho 1.0.22\n");
    const manager = siblingManager(root, fixture, { downloadRoot: join(root, ".downloads") });
    await manager.initialize();
    // An instance killed while it held the claim. Age is the only evidence there is that no one is
    // coming back for it, so the store must not stay unwritable because of it.
    const lock = join(root, "grok", ".locking-darwin-arm64-1.0.22");
    await heldClaim(lock, "4242-c0ffee11");
    await aged(lock);

    await manager.downloadAndWait("grok");

    expect(await readFile(destination, "utf8")).toBe(new TextDecoder().decode(fixture.executable));
    expect((await readdir(join(root, "grok"))).filter((entry) => entry.startsWith("."))).toEqual([]);
  });

  // Windows refuses to move a directory onto another, even an empty one, so there the unfinished
  // claim is cleared by age like any other.
  it.skipIf(process.platform === "win32")("replaces a damaged runtime when a claim was never finished", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const destination = join(root, "grok", "darwin-arm64", "1.0.22", "bin", "grok");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "#!/bin/sh\necho 1.0.22\n");
    const manager = siblingManager(root, fixture, { downloadRoot: join(root, ".downloads") });
    await manager.initialize();
    // A claim directory with no claim in it names no owner, so it can only be what an instance
    // killed part-way through making one left. The store must not stay unwritable because of it.
    await mkdir(join(root, "grok", ".locking-darwin-arm64-1.0.22"), { recursive: true });

    await manager.downloadAndWait("grok");

    expect(await readFile(destination, "utf8")).toBe(new TextDecoder().decode(fixture.executable));
    expect((await readdir(join(root, "grok"))).filter((entry) => entry.startsWith("."))).toEqual([]);
  });
});
