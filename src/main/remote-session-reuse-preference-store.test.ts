// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteSessionReusePreferenceStore } from "./remote-session-reuse-preference-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function preferencePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-remote-session-reuse-"));
  directories.push(directory);
  return join(directory, "openbot-remote-session-reuse-preference-v1.json");
}

describe("RemoteSessionReusePreferenceStore", () => {
  it("is on by default and for a file it cannot read, and keeps the user's choice", async () => {
    const path = await preferencePath();
    const fresh = new RemoteSessionReusePreferenceStore(path);
    await Effect.runPromise(fresh.load());
    expect(fresh.get()).toEqual({ keepBetweenRuns: true });

    await writeFile(path, "{");
    const unreadable = new RemoteSessionReusePreferenceStore(path);
    await Effect.runPromise(unreadable.load());
    expect(unreadable.get()).toEqual({ keepBetweenRuns: true });

    expect(await Effect.runPromise(fresh.set({ keepBetweenRuns: false }))).toEqual({ keepBetweenRuns: false });
    const next = new RemoteSessionReusePreferenceStore(path);
    await Effect.runPromise(next.load());
    expect(next.get()).toEqual({ keepBetweenRuns: false });
  });
});
