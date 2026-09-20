// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { MANAGED_RUNTIME_PROVIDERS, MANAGED_TOOL_RUNTIMES, type ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
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

describe("ProviderRuntimeManager", () => {
  it("streams a verified runtime and reports monotonic progress", async () => {
    const root = await temporaryRoot();
    const executable = new TextEncoder().encode(`#!/bin/sh\necho 1.0.22\n${"# runtime\n".repeat(2_000)}`);
    const license = new TextEncoder().encode("license\n");
    const notices = new TextEncoder().encode("notices\n");
    const lock = parseAgentRuntimeLock(structuredClone(lockValue));
    lock.grok.artifacts["darwin-arm64"].downloadBytes = executable.byteLength;
    lock.grok.artifacts["darwin-arm64"].installedBytes = executable.byteLength + 1_024;
    lock.grok.artifacts["darwin-arm64"].assetSha256 = digest(executable);
    lock.grok.licenseSha256 = digest(license);
    lock.grok.noticesSha256 = digest(notices);
    const previousExecutable = join(root, "grok", "darwin-arm64", "1.0.21", "bin", "grok");
    await mkdir(join(previousExecutable, ".."), { recursive: true });
    await writeFile(previousExecutable, "previous runtime");
    const progress: number[] = [];
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/LICENSE")) return new Response(license);
        if (url.endsWith("/THIRD-PARTY-NOTICES")) return new Response(notices);
        return chunkedResponse(executable, 1_024, { etag: '"runtime-1"' });
      },
    });
    const initial = await manager.initialize();
    expect(initial.providers.grok).toMatchObject({
      phase: "not-downloaded",
      version: "1.0.21",
      availableVersion: "1.0.22",
    });
    const finished = waitFor(manager, (snapshot) => snapshot.providers.grok.phase === "ready");
    manager.on("status", (snapshot) => {
      const value = snapshot.providers.grok.progress;
      if (value !== null) progress.push(value);
    });

    const accepted = await manager.download("grok");
    expect(accepted.providers.grok).toMatchObject({
      phase: "downloading",
      version: "1.0.21",
      availableVersion: "1.0.22",
    });
    const snapshot = await finished;

    expect(snapshot.providers.grok).toMatchObject({ phase: "ready", version: "1.0.22", availableVersion: null });
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0))).toBe(true);
    expect(await readFile(previousExecutable, "utf8")).toBe("previous runtime");
    const installed = manager.executablePath("grok");
    if (!installed) throw new Error("The managed Grok path is missing.");
    expect(await readFile(installed, "utf8")).toBe(new TextDecoder().decode(executable));
    expect((await readdir(join(root, "grok"))).some((entry) => entry.startsWith(".staging-"))).toBe(false);
  });

  it.each(["9.0.0", "invalid-version", "1.0.21"])(
    "does not offer an update for an incomplete or newer folder %s",
    async (version) => {
      const root = await temporaryRoot();
      const bin = join(root, "grok", "darwin-arm64", version, "bin");
      await mkdir(bin, { recursive: true });
      if (version !== "1.0.21") await writeFile(join(bin, "grok"), "not an older runtime");
      const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });
      const snapshot = await manager.initialize();
      expect(snapshot.providers.grok).toMatchObject({ phase: "not-downloaded", version: null, availableVersion: null });
    },
  );

  it("offers the pinned version to an older CLI the user installed", async () => {
    const root = await temporaryRoot();
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });
    await manager.initialize();
    const pinned = parseAgentRuntimeLock(structuredClone(lockValue)).grok.version;
    const snapshots: ProviderRuntimeSnapshot[] = [];
    manager.on("status", (snapshot) => snapshots.push(snapshot));

    manager.setSystemVersion("grok", "0.0.1");
    expect(snapshots.at(-1)?.providers.grok).toMatchObject({ version: null, availableVersion: pinned });

    manager.setSystemVersion("grok", pinned);
    expect(manager.getStatus().providers.grok.availableVersion).toBeNull();

    manager.setSystemVersion("grok", pinned);
    expect(snapshots).toHaveLength(2);
  });

  it("does not hide managed updates because an earlier system updater refused them", async () => {
    const root = await temporaryRoot();
    await writeFile(
      join(root, "cli-update-refusals.json"),
      JSON.stringify({ grok: { version: "0.0.1", pinnedVersion: "1.0.22" } }),
    );
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });
    await manager.initialize();
    manager.setSystemVersion("grok", "0.0.1");
    expect(manager.getStatus().providers.grok.availableVersion).toBe("1.0.22");
  });

  it("does not offer or download over an explicit CLI override", async () => {
    const root = await temporaryRoot();
    vi.stubEnv("OPENBOT_GROK_PATH", "/custom/grok");
    const fetchImpl = vi.fn(async () => new Response());
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64", fetchImpl });
    await manager.initialize();
    manager.setSystemVersion("grok", "1.0.5");
    expect(manager.getStatus().providers.grok.availableVersion).toBeNull();
    await expect(manager.downloadAndWait("grok")).rejects.toThrow("explicit CLI path override");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("waits for activation and removes a rejected artifact before restart", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const previous = join(root, "grok", "darwin-arm64", "1.0.21", "bin", "grok");
    await mkdir(dirname(previous), { recursive: true });
    await writeFile(previous, "previous runtime");
    let activate: (() => void) | undefined;
    const activation = new Promise<void>((resolve) => {
      activate = resolve;
    });
    let finishInstall: (() => void) | undefined;
    const installed = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    let failActivation = true;
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock: fixture.lock,
      fetchImpl: async (input) =>
        chunkedResponse(
          String(input).endsWith("/LICENSE")
            ? fixture.license
            : String(input).endsWith("/THIRD-PARTY-NOTICES")
              ? fixture.notices
              : fixture.executable,
          1024,
        ),
      updateRuntime: async (_provider, install) => {
        await install();
        finishInstall?.();
        await activation;
        if (failActivation) throw new Error("Candidate failed. Authorization: Bearer abcdef123456");
      },
    });
    await manager.initialize();
    const update = manager.downloadAndWait("grok");
    await installed;
    expect(manager.getStatus().providers.grok.phase).toBe("finishing");
    activate?.();
    await expect(update).rejects.toThrow("Candidate failed.");
    expect(manager.getStatus().providers.grok.message).toContain("[redacted]");
    expect(manager.getStatus().providers.grok.message).not.toContain("abcdef123456");
    const restarted = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock: fixture.lock,
    });
    expect((await restarted.initialize()).providers.grok).toMatchObject({ phase: "not-downloaded", version: "1.0.21" });
    expect(restarted.executablePath("grok")).toBe(previous);
    expect(await readFile(previous, "utf8")).toBe("previous runtime");
    failActivation = false;
    await manager.downloadAndWait("grok");
    expect(manager.getStatus().providers.grok).toMatchObject({ phase: "ready", version: "1.0.22" });
    const successfulRestart = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock: fixture.lock,
    });
    expect((await successfulRestart.initialize()).providers.grok).toMatchObject({ phase: "ready", version: "1.0.22" });
  });

  it("rejects a binary whose version only contains the pinned version as a prefix", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    fixture.executable = new TextEncoder().encode("#!/bin/sh\necho 1.0.220\n");
    const artifact = fixture.lock.grok.artifacts["darwin-arm64"];
    artifact.downloadBytes = fixture.executable.byteLength;
    artifact.assetSha256 = digest(fixture.executable);
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock: fixture.lock,
      fetchImpl: async (input) =>
        chunkedResponse(
          String(input).endsWith("/LICENSE")
            ? fixture.license
            : String(input).endsWith("/THIRD-PARTY-NOTICES")
              ? fixture.notices
              : fixture.executable,
          1024,
        ),
    });
    await manager.initialize();
    await expect(manager.downloadAndWait("grok")).rejects.toThrow("unexpected version");
  });

  it("allows three transfers and cancels only the selected provider", async () => {
    const root = await temporaryRoot();
    const oldClaude = join(root, "claude", "darwin-arm64", "2.1.246", "bin", "claude");
    await mkdir(join(oldClaude, ".."), { recursive: true });
    await writeFile(oldClaude, "old runtime");
    const responseBody = new Uint8Array(64_000);
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      fetchImpl: async () => slowResponse(responseBody),
    });
    await manager.initialize();

    await Promise.all([manager.download("codex"), manager.download("claude"), manager.download("grok")]);
    // Named one by one rather than read off the snapshot in order: the managed set grows, and a
    // fourth provider nobody asked to download must not read as a fourth transfer here.
    const started = manager.getStatus().providers;
    expect([started.codex.phase, started.claude.phase, started.grok.phase]).toEqual([
      "downloading",
      "downloading",
      "downloading",
    ]);
    expect(started.opencode.phase).toBe("not-downloaded");

    await manager.cancel("claude");
    const snapshot = manager.getStatus();
    expect(snapshot.providers.claude).toMatchObject({
      phase: "not-downloaded",
      version: "2.1.246",
      availableVersion: "2.1.263",
    });
    expect(await readFile(oldClaude, "utf8")).toBe("old runtime");
    expect(snapshot.providers.codex.phase).toBe("downloading");
    expect(snapshot.providers.grok.phase).toBe("downloading");
    await expect(access(join(root, ".downloads", "claude-darwin-arm64-2.1.263.partial"))).rejects.toThrow();
    await manager.stop();
  });

  it("restarts a partial transfer when the vendor ETag changes", async () => {
    const root = await temporaryRoot();
    const executable = new TextEncoder().encode(`#!/bin/sh\necho 1.0.22\n${"# runtime\n".repeat(1_000)}`);
    const license = new TextEncoder().encode("license\n");
    const notices = new TextEncoder().encode("notices\n");
    const lock = parseAgentRuntimeLock(structuredClone(lockValue));
    const artifact = lock.grok.artifacts["darwin-arm64"];
    artifact.downloadBytes = executable.byteLength;
    artifact.installedBytes = executable.byteLength + 1_024;
    artifact.assetSha256 = digest(executable);
    lock.grok.licenseSha256 = digest(license);
    lock.grok.noticesSha256 = digest(notices);
    const url = `${lock.grok.distribution}/${artifact.asset}`;
    const partialRoot = join(root, ".downloads");
    const partial = join(partialRoot, `grok-darwin-arm64-${lock.grok.version}.partial`);
    const offset = 128;
    await mkdir(partialRoot, { recursive: true });
    await writeFile(partial, executable.slice(0, offset));
    await writeFile(
      `${partial}.json`,
      `${JSON.stringify({ url, etag: '"old"', expectedBytes: executable.byteLength })}\n`,
    );
    const ranges: Array<string | null> = [];
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock,
      fetchImpl: async (input, init) => {
        const requestUrl = String(input);
        if (requestUrl.endsWith("/LICENSE")) return new Response(license);
        if (requestUrl.endsWith("/THIRD-PARTY-NOTICES")) return new Response(notices);
        const headers = new Headers(init?.headers);
        ranges.push(headers.get("range"));
        if (ranges.length === 1) {
          return new Response(executable.slice(offset), {
            status: 206,
            headers: {
              etag: '"changed"',
              "content-range": `bytes ${offset}-${executable.byteLength - 1}/${executable.byteLength}`,
            },
          });
        }
        return chunkedResponse(executable, 512, { etag: '"changed"' });
      },
    });
    await manager.initialize();
    const finished = waitFor(manager, (snapshot) => snapshot.providers.grok.phase === "ready");

    await manager.download("grok");
    await finished;

    expect(ranges).toEqual([`bytes=${offset}-`, null]);
  });

  it("resumes a partial transfer after a network error", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const ranges: Array<string | null> = [];
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock: fixture.lock,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/LICENSE")) return chunkedResponse(fixture.license, fixture.license.byteLength);
        if (url.endsWith("/THIRD-PARTY-NOTICES")) {
          return chunkedResponse(fixture.notices, fixture.notices.byteLength);
        }
        const range = new Headers(init?.headers).get("range");
        ranges.push(range);
        if (ranges.length === 1) {
          return chunkedResponse(fixture.executable.slice(0, 512), 512, { etag: '"runtime-1"' });
        }
        const offset = Number(range?.match(/^bytes=(\d+)-$/u)?.[1]);
        return new Response(fixture.executable.slice(offset), {
          status: 206,
          headers: {
            etag: '"runtime-1"',
            "content-range": `bytes ${offset}-${fixture.executable.byteLength - 1}/${fixture.executable.byteLength}`,
          },
        });
      },
    });
    await manager.initialize();
    const failed = waitFor(manager, (snapshot) => snapshot.providers.grok.phase === "download-error");

    await manager.download("grok");
    await failed;
    const ready = waitFor(manager, (snapshot) => snapshot.providers.grok.phase === "ready");
    await manager.download("grok");
    await ready;

    expect(ranges[0]).toBeNull();
    expect(ranges[1]).toMatch(/^bytes=[1-9]\d*-$/u);
  });

  it("restarts from zero when a resumed request returns 200", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    const artifact = fixture.lock.grok.artifacts["darwin-arm64"];
    const partialRoot = join(root, ".downloads");
    const partial = join(partialRoot, `grok-darwin-arm64-${fixture.lock.grok.version}.partial`);
    const url = `${fixture.lock.grok.distribution}/${artifact.asset}`;
    await mkdir(partialRoot, { recursive: true });
    await writeFile(partial, fixture.executable.slice(0, 128));
    await writeFile(
      `${partial}.json`,
      `${JSON.stringify({ url, etag: '"runtime-1"', expectedBytes: fixture.executable.byteLength })}\n`,
    );
    const ranges: Array<string | null> = [];
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock: fixture.lock,
      fetchImpl: async (input, init) => {
        const requestUrl = String(input);
        if (requestUrl.endsWith("/LICENSE")) return chunkedResponse(fixture.license, fixture.license.byteLength);
        if (requestUrl.endsWith("/THIRD-PARTY-NOTICES")) {
          return chunkedResponse(fixture.notices, fixture.notices.byteLength);
        }
        ranges.push(new Headers(init?.headers).get("range"));
        return chunkedResponse(fixture.executable, 512, { etag: '"runtime-1"' });
      },
    });
    await manager.initialize();
    const ready = waitFor(manager, (snapshot) => snapshot.providers.grok.phase === "ready");

    await manager.download("grok");
    await ready;

    expect(ranges).toEqual(["bytes=128-", null]);
  });

  it("removes a partial file after a SHA-256 failure", async () => {
    const root = await temporaryRoot();
    const fixture = grokFixture();
    fixture.lock.grok.artifacts["darwin-arm64"].assetSha256 = digest(new TextEncoder().encode("wrong"));
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      lock: fixture.lock,
      fetchImpl: async () => chunkedResponse(fixture.executable, 512),
    });
    await manager.initialize();
    const failed = waitFor(manager, (snapshot) => snapshot.providers.grok.phase === "download-error");

    await manager.download("grok");
    const snapshot = await failed;

    expect(snapshot.providers.grok.message).toContain("integrity check");
    await expect(
      access(join(root, ".downloads", `grok-darwin-arm64-${fixture.lock.grok.version}.partial`)),
    ).rejects.toThrow();
  });

  it("rejects a transfer before fetch when disk space is too small", async () => {
    const root = await temporaryRoot();
    const fetchImpl = vi.fn(async () => new Response());
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      fetchImpl,
      availableDiskBytes: async () => 0,
    });
    await manager.initialize();
    const failed = waitFor(manager, (snapshot) => snapshot.providers.codex.phase === "download-error");

    await manager.download("codex");
    const snapshot = await failed;

    expect(snapshot.providers.codex.message).toContain("free disk space");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps one store for every profile on this computer", () => {
    // An exact path, because it is what every profile has to agree on to share one download. In
    // development each renderer port and each worktree gets a `userData` of its own; the packaged
    // app's is `appData/OpenBot`, so this is the path released builds already use.
    const appData = join("/home", "someone", ".config");
    expect(providerRuntimeRoot({ appData, userDataOverride: "" })).toBe(join(appData, "OpenBot", "provider-runtimes"));
    expect(providerRuntimeRoot({ appData, userDataOverride: "   " })).toBe(
      join(appData, "OpenBot", "provider-runtimes"),
    );
  });

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

  it("keeps partial transfers out of the store the computer shares", async () => {
    const root = await temporaryRoot();
    const downloadRoot = join(await temporaryRoot(), "profile-downloads");
    const lock = parseAgentRuntimeLock(structuredClone(lockValue));
    lock.grok.artifacts["darwin-arm64"].downloadBytes = 64_000;
    const manager = new ProviderRuntimeManager({
      root,
      downloadRoot,
      platform: "darwin",
      architecture: "arm64",
      lock,
      fetchImpl: async () => slowResponse(new Uint8Array(64_000)),
    });
    await manager.initialize();
    const partial = join(downloadRoot, `grok-darwin-arm64-${lock.grok.version}.partial`);
    const transferring = waitFor(manager, (snapshot) => (snapshot.providers.grok.progress ?? 0) > 0);

    await manager.download("grok");
    await transferring;

    await expect(access(partial)).resolves.toBeUndefined();
    expect(await readdir(root)).not.toContain(".downloads");

    await manager.cancel("grok");
    await expect(access(partial)).rejects.toThrow();
    await manager.stop();
  });

  it("rejects an archive that contains a link", async () => {
    const root = await temporaryRoot();
    const source = join(root, "unsafe-source");
    const archive = join(root, "unsafe.tar.gz");
    await mkdir(join(source, "bin"), { recursive: true });
    await symlink("../outside", join(source, "bin", "codex"));
    execFileSync("tar", ["-czf", archive, "-C", source, "."]);
    const bytes = await readFile(archive);
    const lock = parseAgentRuntimeLock(structuredClone(lockValue));
    const artifact = lock.codex.artifacts["darwin-arm64"];
    artifact.downloadBytes = bytes.byteLength;
    artifact.installedBytes = 1_024;
    artifact.assetSha256 = digest(bytes);
    const manager = new ProviderRuntimeManager({
      root: join(root, "runtimes"),
      platform: "darwin",
      architecture: "arm64",
      lock,
      fetchImpl: async () => new Response(bytes),
    });
    await manager.initialize();
    const failed = waitFor(manager, (snapshot) => snapshot.providers.codex.phase === "download-error");

    await manager.download("codex");
    const snapshot = await failed;

    expect(snapshot.providers.codex.message).toContain("link or special file");
    const providerEntries = await readdir(join(root, "runtimes", "codex")).catch(() => []);
    expect(providerEntries.some((entry) => entry.startsWith(".staging-"))).toBe(false);
  });

  it("installs each runtime under its own name and version", async () => {
    // The manager used to answer "which artifact does this provider get?" with `else grok`, so a
    // provider it had never heard of got Grok's binary in its own directory. Every managed runtime
    // is asked here, so a new one joins this case by joining the registry.
    const root = await temporaryRoot();
    const lock = parseAgentRuntimeLock(structuredClone(lockValue));
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64", lock });

    for (const runtime of [...MANAGED_RUNTIME_PROVIDERS, ...MANAGED_TOOL_RUNTIMES]) {
      expect(manager.executablePath(runtime)).toBe(
        join(root, runtime, "darwin-arm64", lock[runtime].version, "bin", runtime),
      );
    }
  });

  /*
   * OpenCode ships as an npm platform tarball holding exactly `package/package.json` and
   * `package/bin/opencode`, and no licence at all. Staging has to pick those two files out, fetch
   * the licence from the tagged source, and refuse anything else -- this is the whole path a user
   * gets by pressing Download, with no terminal step behind it.
   */
  it("stages the OpenCode binary, its license and its layout file", async () => {
    const root = await temporaryRoot();
    const fixture = await opencodeFixture();
    const manager = opencodeManager(root, fixture);
    await manager.initialize();

    await manager.downloadAndWait("opencode");

    const version = fixture.lock.opencode.version;
    expect(manager.getStatus().providers.opencode).toMatchObject({ phase: "ready", version });
    const installed = join(root, "opencode", "darwin-arm64", version);
    expect(await readFile(join(installed, "bin", "opencode"), "utf8")).toBe(fixture.binaryText);
    expect(await readFile(join(installed, "LICENSE"), "utf8")).toBe(fixture.licenseText);
    expect(JSON.parse(await readFile(join(installed, "opencode-package.json"), "utf8"))).toMatchObject({
      layoutVersion: 1,
      version,
      target: "darwin-arm64",
      executable: "bin/opencode",
    });
  });

  it("refuses a package that is not the pinned OpenCode release", async () => {
    const root = await temporaryRoot();
    // The checksum still matches: this is a correctly transferred tarball of the wrong release, which
    // is what a registry mix-up or a stale mirror hands back.
    const fixture = await opencodeFixture({ manifestVersion: "1.18.29" });
    const manager = opencodeManager(root, fixture);
    await manager.initialize();

    await expect(manager.downloadAndWait("opencode")).rejects.toThrow("does not match the runtime catalog");
  });

  it("refuses a binary whose checksum is not the pinned one", async () => {
    const root = await temporaryRoot();
    const fixture = await opencodeFixture();
    fixture.lock.opencode.artifacts["darwin-arm64"].binarySha256 = digest(new TextEncoder().encode("wrong"));
    const manager = opencodeManager(root, fixture);
    await manager.initialize();

    await expect(manager.downloadAndWait("opencode")).rejects.toThrow("checksum mismatch");
  });

  it("installs nothing when the staged OpenCode reports another version", async () => {
    const root = await temporaryRoot();
    // `OPENCODE_DISABLE_AUTOUPDATE` keeps a managed install on the pin, and this is the check behind
    // it: a binary that answers with any other version must not become the runtime OpenBot starts.
    const fixture = await opencodeFixture({ reportedVersion: "1.18.29" });
    const manager = opencodeManager(root, fixture);
    await manager.initialize();

    await expect(manager.downloadAndWait("opencode")).rejects.toThrow("unexpected version");

    const entries = await readdir(join(root, "opencode")).catch(() => []);
    expect(entries).not.toContain("darwin-arm64");
    expect(entries.some((entry) => entry.startsWith(".staging-"))).toBe(false);
  });

  /*
   * Bun is downloaded for the MCP servers, not for an agent, and the two things a server needs from
   * it are the binary and the second name `bunx`. Bun decides what to do from the name it was
   * started under, so without that name a catalog entry written for `npx` would reach a runtime
   * that reads `-y` as a script flag.
   */
  it("stages Bun with the bunx name beside it, and lends both to the MCP servers", async () => {
    const root = await temporaryRoot();
    const fixture = await bunFixture();
    const manager = bunManager(root, fixture);
    await manager.initialize();
    expect(manager.mcpToolRuntimes()).toEqual({ binDirectories: [], commandAliases: {} });

    await manager.downloadAndWait("bun");

    const version = fixture.lock.bun.version;
    expect(manager.getStatus().toolRuntimes.bun).toMatchObject({ phase: "ready", version });
    const installed = join(root, "bun", "darwin-arm64", version);
    expect(await readFile(join(installed, "bin", "bunx"), "utf8")).toBe(fixture.binaryText);
    expect(await readFile(join(installed, "LICENSE.md"), "utf8")).toBe(fixture.licenseText);
    expect(manager.mcpToolRuntimes()).toEqual({
      binDirectories: [join(installed, "bin")],
      commandAliases: { npx: join(installed, "bin", "bunx") },
    });
  });

  // The connection test waits on this before probing a stdio server: a machine that only needs
  // the download must not answer `Command not found: npx` for it.
  it("waits until the tool runtimes are ready", async () => {
    const root = await temporaryRoot();
    const fixture = await bunFixture();
    const manager = bunManager(root, fixture);
    await manager.initialize();
    expect(manager.mcpToolRuntimes().binDirectories).toEqual([]);

    await manager.ensureToolRuntimesReady();

    expect(manager.getStatus().toolRuntimes.bun).toMatchObject({ phase: "ready" });
    expect(manager.mcpToolRuntimes().binDirectories).toHaveLength(1);
  });

  it("does not offer Bun to the provider cards", async () => {
    // `providers` is what every renderer reader iterates to draw a provider card. A tool runtime in
    // it would become a provider everywhere, from the picker to the model list.
    const root = await temporaryRoot();
    const manager = new ProviderRuntimeManager({ root, platform: "darwin", architecture: "arm64" });

    const snapshot = await manager.initialize();

    expect(Object.keys(snapshot.providers)).toEqual([...MANAGED_RUNTIME_PROVIDERS]);
  });

  it.each([
    ["darwin", "arm64"],
    ["linux", "x64"],
    ["win32", "x64"],
  ] as const)("offers managed downloads on %s %s", async (platform, architecture) => {
    const root = await temporaryRoot();
    const manager = new ProviderRuntimeManager({ root, platform, architecture });

    const snapshot = await manager.initialize();

    for (const provider of MANAGED_RUNTIME_PROVIDERS) {
      expect(snapshot.providers[provider]).toMatchObject({ phase: "not-downloaded", message: null });
    }
    for (const tool of MANAGED_TOOL_RUNTIMES) {
      expect(snapshot.toolRuntimes[tool]).toMatchObject({ phase: "not-downloaded", message: null });
    }
  });

  it("reports an unsupported platform rather than a download that cannot work", async () => {
    const root = await temporaryRoot();
    const manager = new ProviderRuntimeManager({ root, platform: "linux", architecture: "arm64" });

    const snapshot = await manager.initialize();

    expect(snapshot.providers.codex.message).toBe("This platform is not supported.");
  });
});

interface OpencodeFixture {
  archive: Uint8Array;
  binaryText: string;
  licenseText: string;
  lock: ReturnType<typeof parseAgentRuntimeLock>;
}

/** A served `opencode-darwin-arm64` tarball with the lock rewritten to match it. */
async function opencodeFixture(options?: {
  manifestVersion?: string;
  reportedVersion?: string;
}): Promise<OpencodeFixture> {
  const lock = parseAgentRuntimeLock(structuredClone(lockValue));
  const artifact = lock.opencode.artifacts["darwin-arm64"];
  const binaryText = `#!/bin/sh\necho ${options?.reportedVersion ?? lock.opencode.version}\n`;
  const licenseText = "MIT license\n";
  const source = await temporaryRoot();
  await mkdir(join(source, "package", "bin"), { recursive: true });
  await writeFile(
    join(source, "package", "package.json"),
    JSON.stringify({ name: artifact.package, version: options?.manifestVersion ?? lock.opencode.version }),
  );
  await writeFile(join(source, "package", "bin", artifact.executable), binaryText, { mode: 0o755 });
  const archivePath = join(source, artifact.asset);
  execFileSync("tar", ["-czf", archivePath, "-C", source, "package"]);
  const archive = await readFile(archivePath);

  artifact.assetSha256 = digest(archive);
  artifact.binarySha256 = digest(new TextEncoder().encode(binaryText));
  artifact.downloadBytes = archive.byteLength;
  artifact.installedBytes = archive.byteLength + 1_024;
  lock.opencode.licenseSha256 = digest(new TextEncoder().encode(licenseText));
  return { archive, binaryText, licenseText, lock };
}

/** A served `@oven/bun-darwin-aarch64` tarball with the lock rewritten to match it. */
async function bunFixture(): Promise<OpencodeFixture> {
  const lock = parseAgentRuntimeLock(structuredClone(lockValue));
  const artifact = lock.bun.artifacts["darwin-arm64"];
  const binaryText = `#!/bin/sh\necho ${lock.bun.version}\n`;
  const licenseText = "MIT license\n";
  const source = await temporaryRoot();
  await mkdir(join(source, "package", "bin"), { recursive: true });
  await writeFile(
    join(source, "package", "package.json"),
    JSON.stringify({ name: artifact.package, version: lock.bun.version }),
  );
  await writeFile(join(source, "package", "bin", artifact.executable), binaryText, { mode: 0o755 });
  const archivePath = join(source, artifact.asset);
  execFileSync("tar", ["-czf", archivePath, "-C", source, "package"]);
  const archive = await readFile(archivePath);

  artifact.assetSha256 = digest(archive);
  artifact.binarySha256 = digest(new TextEncoder().encode(binaryText));
  artifact.downloadBytes = archive.byteLength;
  artifact.installedBytes = archive.byteLength + 1_024;
  lock.bun.licenseSha256 = digest(new TextEncoder().encode(licenseText));
  return { archive, binaryText, licenseText, lock };
}

function bunManager(root: string, fixture: OpencodeFixture): ProviderRuntimeManager {
  return new ProviderRuntimeManager({
    root,
    platform: "darwin",
    architecture: "arm64",
    lock: fixture.lock,
    fetchImpl: async (input) =>
      String(input).endsWith("/LICENSE.md")
        ? new Response(new TextEncoder().encode(fixture.licenseText))
        : chunkedResponse(fixture.archive, 4_096),
  });
}

function opencodeManager(root: string, fixture: OpencodeFixture): ProviderRuntimeManager {
  return new ProviderRuntimeManager({
    root,
    platform: "darwin",
    architecture: "arm64",
    lock: fixture.lock,
    fetchImpl: async (input) =>
      String(input).endsWith("/LICENSE")
        ? new Response(new TextEncoder().encode(fixture.licenseText))
        : chunkedResponse(fixture.archive, 4_096),
  });
}

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

function slowResponse(value: Uint8Array): Response {
  let offset = 0;
  return new Response(
    new ReadableStream({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (offset >= value.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(value.slice(offset, offset + 256));
        offset += 256;
      },
    }),
    { status: 200, headers: { etag: '"slow"' } },
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
