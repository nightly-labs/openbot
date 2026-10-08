import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { ProviderUseSettingsStore } from "./provider-use-settings-store";

let root: string;
let path: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "provider-use-"));
  path = join(root, "settings.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function load() {
  const store = new ProviderUseSettingsStore(path);
  await runCauseEffect(store.load());
  return store;
}

it("keeps both switch directions across restarts and preserves other switches", async () => {
  const store = await load();
  expect(store.off()).toEqual([]);
  await Promise.all([runCauseEffect(store.set("codex", false)), runCauseEffect(store.set("claude", false))]);
  const next = await load();
  expect(next.off()).toEqual(["codex", "claude"]);
  await runCauseEffect(next.set("codex", true));
  expect((await load()).off()).toEqual(["claude"]);
});

it.each(['{"version":2,"off":["codex"]}', '{"version":1,"off":["unknown"]}', "bad json"])(
  "preserves an unreadable settings file: %s",
  async (content) => {
    await writeFile(path, content);
    const store = await load();
    await expect(runCauseEffect(store.set("claude", false))).rejects.toThrow("saved provider settings cannot be read");
    expect(await readFile(path, "utf8")).toBe(content);
  },
);
