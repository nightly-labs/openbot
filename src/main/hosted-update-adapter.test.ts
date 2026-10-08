import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostedUpdateAdapter, type HostedUpdatePaths } from "./hosted-update-adapter";

// Root, played by each test: it takes a request by writing the state file and removing the request,
// and ends by removing the state file, with or without a staged release.
let root: string;
let paths: HostedUpdatePaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openbot-hosted-adapter-"));
  paths = { requests: join(root, "run"), state: join(root, "state"), stagedReady: join(root, "staged.ready") };
  mkdirSync(paths.requests);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function adapter(latest: string) {
  const updater = new HostedUpdateAdapter({
    currentVersion: "1.0.0",
    arch: "x64",
    paths,
    pollIntervalMs: 5,
    fetch: vi.fn<typeof fetch>(
      async () => new Response(`version: ${latest}\nfiles:\n  - url: OpenBot-${latest}-x86_64.AppImage\n`),
    ),
  });
  const progress = vi.fn();
  const downloaded = vi.fn();
  updater.on("download-progress", progress);
  updater.on("update-downloaded", downloaded);
  return { updater, progress, downloaded };
}

const stageRequest = () => join(paths.requests, "update-stage");

describe("HostedUpdateAdapter", () => {
  it("asks root to stage the release and reports the progress until it is staged", async () => {
    const { updater, progress, downloaded } = adapter("1.1.0");
    const check = await updater.checkForUpdates();
    expect(check.isUpdateAvailable).toBe(true);
    const download = updater.downloadUpdate(check.cancellationToken);

    await vi.waitFor(() => expect(existsSync(stageRequest())).toBe(true));
    writeFileSync(paths.state, "downloading 40\n");
    rmSync(stageRequest());
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(expect.objectContaining({ percent: 40 })));
    writeFileSync(paths.stagedReady, "1.1.0\n");
    rmSync(paths.state);

    await download;
    expect(downloaded).toHaveBeenCalledWith({ version: "1.1.0" });
  });

  it("fails the download when root ends without a staged release", async () => {
    const { updater, downloaded } = adapter("1.1.0");
    const check = await updater.checkForUpdates();
    const download = updater.downloadUpdate(check.cancellationToken);
    const failed = expect(download).rejects.toThrow();

    await vi.waitFor(() => expect(existsSync(stageRequest())).toBe(true));
    rmSync(stageRequest());

    await failed;
    expect(downloaded).not.toHaveBeenCalled();
  });

  it("uses a release that the timer staged, and asks again when a newer one is out", async () => {
    writeFileSync(paths.stagedReady, "1.1.0\n");
    const current = adapter("1.1.0");
    await current.updater.downloadUpdate((await current.updater.checkForUpdates()).cancellationToken);
    expect(current.downloaded).toHaveBeenCalledWith({ version: "1.1.0" });
    expect(existsSync(stageRequest())).toBe(false);

    const newer = adapter("1.2.0");
    const check = await newer.updater.checkForUpdates();
    const download = newer.updater.downloadUpdate(check.cancellationToken);
    await vi.waitFor(() => expect(existsSync(stageRequest())).toBe(true));
    check.cancellationToken?.cancel();
    await expect(download).rejects.toThrow();
    expect(newer.downloaded).not.toHaveBeenCalled();
  });

  it("asks root to install with a request file", () => {
    adapter("1.1.0").updater.quitAndInstall();
    expect(existsSync(join(paths.requests, "update-install"))).toBe(true);
  });
});
