import { mkdir, mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonFileAtomically } from "./atomic-json-file";

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "openbot-atomic-json-"));
}

describe("writeJsonFileAtomically", () => {
  it("creates a missing directory and writes one line only the user can read", async () => {
    const path = join(await temporaryRoot(), "nested", "settings.json");

    await writeJsonFileAtomically(path, { version: 1, enabled: true }, { createDirectory: true });

    await expect(readFile(path, "utf8")).resolves.toBe('{"version":1,"enabled":true}\n');
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("removes its temporary file when the rename fails", async () => {
    const root = await temporaryRoot();
    const path = join(root, "settings.json");
    // A directory at the target makes the rename fail after the temporary file is written.
    await mkdir(path);

    await expect(writeJsonFileAtomically(path, { version: 1 })).rejects.toThrow();

    expect(await readdir(root)).toEqual(["settings.json"]);
  });
});
