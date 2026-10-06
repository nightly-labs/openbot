// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installedManagedCli, installOnePasswordCli } from "./onepassword-cli-installer";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-onepassword-cli-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

// The CLI runs as the user and creates a service account, so a changed download must never run.
describe("installOnePasswordCli", () => {
  it("refuses an archive whose hash is not the pinned one and leaves nothing installed", async () => {
    const tampered = new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));

    await expect(
      installOnePasswordCli({
        directory,
        target: "darwin-arm64",
        signal: new AbortController().signal,
        fetch: async () => tampered,
      }),
    ).rejects.toThrow("OpenBot could not install the 1Password CLI");

    expect(await installedManagedCli(directory, "darwin-arm64")).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });
});
