import { runTestEffect } from "../backend/effect-test-runtime";
// @vitest-environment node

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUpdatePreference, writeUpdatePreference } from "./update-preference-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("update preference store", () => {
  it("downloads updates automatically when no preference exists", async () => {
    const root = await temporaryRoot();
    await expect(runTestEffect(readUpdatePreference(join(root, "update.json")))).resolves.toEqual({
      autoDownload: true,
      allowRemoteUpdates: true,
      autoInstall: false,
    });
  });

  it("falls back to the default when the stored preference is malformed", async () => {
    const root = await temporaryRoot();
    const path = join(root, "update.json");
    await writeFile(path, '{"version":1,"autoDownload":"yes"}\n');
    await expect(runTestEffect(readUpdatePreference(path))).resolves.toEqual({
      autoDownload: true,
      allowRemoteUpdates: true,
      autoInstall: false,
    });
  });

  it("falls back to the default when the stored preference is not valid JSON", async () => {
    const root = await temporaryRoot();
    const path = join(root, "update.json");
    await writeFile(path, "{ truncated");
    await expect(runTestEffect(readUpdatePreference(path))).resolves.toEqual({
      autoDownload: true,
      allowRemoteUpdates: true,
      autoInstall: false,
    });
  });

  it("persists the last of several overlapping writes", async () => {
    const root = await temporaryRoot();
    const path = join(root, "update.json");

    // Concurrent toggles each rename their own temporary file, so without serialization the earlier
    // write could land last and persist the value the user just turned off.
    const results = await Promise.all([
      runTestEffect(writeUpdatePreference(path, { autoDownload: true })),
      runTestEffect(writeUpdatePreference(path, { autoDownload: false })),
      runTestEffect(writeUpdatePreference(path, { autoDownload: true })),
      runTestEffect(writeUpdatePreference(path, { autoDownload: false })),
    ]);

    expect(results.at(-1)).toEqual({ autoDownload: false, allowRemoteUpdates: true, autoInstall: false });
    await expect(runTestEffect(readUpdatePreference(path))).resolves.toEqual({
      autoDownload: false,
      allowRemoteUpdates: true,
      autoInstall: false,
    });
    expect((await readdir(root)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the other field when one changes, and reads a file from before remote updates", async () => {
    const root = await temporaryRoot();
    const path = join(root, "update.json");
    await writeFile(path, '{"version":1,"autoDownload":false}\n');
    await expect(runTestEffect(readUpdatePreference(path))).resolves.toEqual({
      autoDownload: false,
      allowRemoteUpdates: true,
      autoInstall: false,
    });
    await runTestEffect(writeUpdatePreference(path, { allowRemoteUpdates: false }));
    await expect(runTestEffect(readUpdatePreference(path))).resolves.toEqual({
      autoDownload: false,
      allowRemoteUpdates: false,
      autoInstall: false,
    });
  });

  it("persists an opt-in over a stored opt-out", async () => {
    const root = await temporaryRoot();
    const path = join(root, "update.json");
    await runTestEffect(writeUpdatePreference(path, { autoDownload: false }));
    await expect(runTestEffect(writeUpdatePreference(path, { autoDownload: true }))).resolves.toEqual({
      autoDownload: true,
      allowRemoteUpdates: true,
      autoInstall: false,
    });
    await expect(runTestEffect(readUpdatePreference(path))).resolves.toEqual({
      autoDownload: true,
      allowRemoteUpdates: true,
      autoInstall: false,
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-update-preference-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
