// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANAGED_RUNTIME_PROVIDERS, MANAGED_TOOL_RUNTIMES, type ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import lockValue from "../../native-runtime.lock.json";
import { parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { ProviderRuntimeManager } from "./provider-runtime-manager";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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

/** Six hours is the staging threshold and thirty days the version one; both are cleared here. */
/** The claim an instance leaves on a path while it replaces the runtime there. */
/** A manager on a store it shares with another, with a profile download directory of its own. */
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
describe("ProviderRuntimeManager (3/3)", () => {
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
