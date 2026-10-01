// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLogoColorPreference, writeLogoColorPreference } from "./logo-color-service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("logo color preference", () => {
  it("persists a chosen color", async () => {
    const path = join(await temporaryRoot(), "logo-color.json");
    await expect(readLogoColorPreference(path)).resolves.toEqual({ color: "lavender" });
    await writeLogoColorPreference(path, { color: "white" });
    await expect(readLogoColorPreference(path)).resolves.toEqual({ color: "white" });
  });

  it("reads the default when the file names a color this build does not ship", async () => {
    // A downgrade reads a file written by a build with more colors.
    const path = join(await temporaryRoot(), "logo-color.json");
    await writeFile(path, '{"version":1,"color":"teal"}\n');
    await expect(readLogoColorPreference(path)).resolves.toEqual({ color: "lavender" });
  });

  it("reads the default when the file is not valid JSON or cannot be read", async () => {
    // Startup awaits this read and has no recovery, so an error here would stop the app.
    const root = await temporaryRoot();
    const invalid = join(root, "invalid.json");
    await writeFile(invalid, "{\n");
    await expect(readLogoColorPreference(invalid)).resolves.toEqual({ color: "lavender" });
    const directory = join(root, "directory.json");
    await mkdir(directory);
    await expect(readLogoColorPreference(directory)).resolves.toEqual({ color: "lavender" });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-logo-color-"));
  roots.push(root);
  return root;
}
