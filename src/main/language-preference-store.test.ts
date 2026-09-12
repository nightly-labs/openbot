// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLanguagePreference, writeLanguagePreference } from "./language-preference-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("language preference store", () => {
  it("follows the system language when no preference exists", async () => {
    const root = await temporaryRoot();
    await expect(readLanguagePreference(join(root, "language.json"))).resolves.toEqual({ language: "system" });
  });

  it("persists a chosen language", async () => {
    const root = await temporaryRoot();
    const path = join(root, "language.json");
    await expect(writeLanguagePreference(path, { language: "ja" })).resolves.toEqual({ language: "ja" });
    await expect(readLanguagePreference(path)).resolves.toEqual({ language: "ja" });
  });

  it("follows the system language when the file names one this build no longer ships", async () => {
    // A downgrade reads a file written by a build with more catalogs. The app must still start in
    // a language it has, not in none at all.
    const root = await temporaryRoot();
    const path = join(root, "language.json");
    await writeFile(path, '{"version":1,"language":"kl"}\n');
    await expect(readLanguagePreference(path)).resolves.toEqual({ language: "system" });
  });

  it("follows the system language when the file cannot be read at all", async () => {
    // Startup awaits this read and has no recovery, so a rethrown error here would show the startup
    // error box and quit. A directory in the file's place stands for any unreadable file.
    const root = await temporaryRoot();
    const path = join(root, "language.json");
    await mkdir(path);
    await expect(readLanguagePreference(path)).resolves.toEqual({ language: "system" });
  });

  it("follows the system language when the file is not valid JSON", async () => {
    const root = await temporaryRoot();
    const path = join(root, "language.json");
    await writeFile(path, "{\n");
    await expect(readLanguagePreference(path)).resolves.toEqual({ language: "system" });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-language-preference-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
