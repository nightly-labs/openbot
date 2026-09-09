// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import lockValue from "../../native-runtime.lock.json";
import { parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { ProviderRuntimeManager } from "./provider-runtime-manager";

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
    expect((await readdir(join(root, "grok"))).some((entry) => entry.startsWith(".installing-"))).toBe(false);
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
    expect(Object.values(manager.getStatus().providers).map((status) => status.phase)).toEqual([
      "downloading",
      "downloading",
      "downloading",
    ]);

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
    expect(providerEntries.some((entry) => entry.startsWith(".installing-"))).toBe(false);
  });
});

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
  executable: Uint8Array;
  license: Uint8Array;
  notices: Uint8Array;
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
