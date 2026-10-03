import { Effect } from "effect";
// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_PROVIDER_DETECTION_SETTINGS } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROVIDER_DETECTION_SETTINGS_FILE, ProviderDetectionSettingsStore } from "./provider-detection-settings-store";

let root = "";
let path = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-provider-detection-"));
  path = join(root, "nested", PROVIDER_DETECTION_SETTINGS_FILE);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const settings = {
  enabled: false,
  addresses: ["http://192.168.1.20:11434/v1"],
  folders: ["~/tools/bin"],
  hiddenIds: ["models:http://127.0.0.1:1234/v1"],
};

async function loaded(): Promise<ProviderDetectionSettingsStore> {
  const store = new ProviderDetectionSettingsStore(path);
  await Effect.runPromise(store.load());
  return store;
}

describe("ProviderDetectionSettingsStore", () => {
  it("starts from the defaults and gives a fresh instance the saved settings", async () => {
    const store = await loaded();
    expect(store.get()).toEqual(DEFAULT_PROVIDER_DETECTION_SETTINGS);

    await Effect.runPromise(store.set(settings).pipe(Effect.mapError((error) => error.cause)));

    expect((await loaded()).get()).toEqual(settings);
  });

  it("does not replace a file of another version", async () => {
    await mkdir(dirname(path), { recursive: true });
    const newer = JSON.stringify({ version: 2, settings: { ...settings, extra: true } });
    await writeFile(path, newer);

    const store = await loaded();

    expect(store.get()).toEqual(DEFAULT_PROVIDER_DETECTION_SETTINGS);
    await expect(
      Effect.runPromise(store.set(settings).pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(newer);
  });

  it("does not replace a file that is not JSON", async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{");

    await expect(Effect.runPromise((await loaded()).set(settings))).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{");
  });
});
