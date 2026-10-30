// Runs the real team and remote server stores against settings files that a power loss on NTFS
// filled with zeros. JSON.parse rejected such a file with "Unexpected token '\0'", and the Windows
// error box showed only "Unexpected token '", so OpenBot did not start. The stores must move the file
// aside and start empty. An empty file gets the same result. A file that is not JSON must still stop
// the start, with an error that names the file and quotes nothing from it. A byte order mark must not
// stop the start.
//
// Run: bun scripts/zero-filled-settings-e2e.ts
// It writes .openbot-build/zero-filled-settings-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeJsonFileAtomically } from "../src/backend/atomic-json-file";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { RemoteServerStore } from "../src/main/remote-server-store";
import { emptyStoredRemoteServers } from "../src/main/remote-server-stored-shape";
import { TeamStore } from "../src/main/team-store";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "zero-filled-settings-e2e");
const ZEROS = "\0".repeat(4_096);
const cipher = { encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() };

const root = await mkdtemp(join(tmpdir(), "openbot-zero-filled-"));
const results: { name: string; passed: boolean; detail: string | undefined }[] = [];

async function check(name: string, run: () => Promise<string | undefined>): Promise<void> {
  try {
    results.push({ name, passed: true, detail: await run() });
  } catch (cause) {
    results.push({ name, passed: false, detail: cause instanceof Error ? cause.message : String(cause) });
  }
}

async function setAsideCopies(directory: string, name: string): Promise<string[]> {
  return (await readdir(directory)).filter((entry) => entry.startsWith(`${name}.corrupt-`));
}

async function startError(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error("The load succeeded.");
}

try {
  await check("zero-filled team file is moved aside and the store starts", async () => {
    const directory = join(root, "team");
    await mkdir(directory);
    const path = join(directory, "openbot-team-server-v2.json");
    await writeFile(path, ZEROS);
    const store = new TeamStore(path);
    await runCauseEffect(store.initialize());
    assert.equal(store.getIdentity(), null);
    const copies = await setAsideCopies(directory, "openbot-team-server-v2.json");
    assert.equal(copies.length, 1);
    assert.equal(await readFile(join(directory, copies[0] ?? ""), "utf8"), ZEROS);
    return copies[0];
  });

  await check("zero-filled remote server file is moved aside and the store starts", async () => {
    const directory = join(root, "remote");
    await mkdir(directory);
    const path = join(directory, "openbot-remote-servers-v1.json");
    await writeFile(path, ZEROS);
    const store = new RemoteServerStore({ path, cipher });
    await runCauseEffect(store.load());
    assert.equal(store.servers.length, 0);
    const copies = await setAsideCopies(directory, "openbot-remote-servers-v1.json");
    assert.equal(copies.length, 1);
    return copies[0];
  });

  await check("an empty remote server file is moved aside and the store starts", async () => {
    const directory = join(root, "empty");
    await mkdir(directory);
    const path = join(directory, "openbot-remote-servers-v1.json");
    await writeFile(path, "");
    const store = new RemoteServerStore({ path, cipher });
    await runCauseEffect(store.load());
    assert.equal(store.servers.length, 0);
    assert.equal((await setAsideCopies(directory, "openbot-remote-servers-v1.json")).length, 1);
    return undefined;
  });

  await check("a remote server file that is not JSON stops the start and names the file", async () => {
    const directory = join(root, "malformed");
    await mkdir(directory);
    const path = join(directory, "openbot-remote-servers-v1.json");
    await writeFile(path, '{"version":3,"servers":[{"encryptedToken":"SECRET-TOKEN-VALUE"');
    const message = await startError(() => runCauseEffect(new RemoteServerStore({ path, cipher }).load()));
    assert.equal(message, `OpenBot cannot read ${path}. The file is damaged.`);
    assert.ok(!message.includes("SECRET"));
    assert.deepEqual(await setAsideCopies(directory, "openbot-remote-servers-v1.json"), []);
    return message;
  });

  await check("a byte order mark does not stop the start", async () => {
    const directory = join(root, "bom");
    await mkdir(directory);
    const path = join(directory, "openbot-remote-servers-v1.json");
    await writeFile(path, `﻿${JSON.stringify(emptyStoredRemoteServers())}`);
    await runCauseEffect(new RemoteServerStore({ path, cipher }).load());
    return undefined;
  });

  await check("an atomic write leaves the complete file", async () => {
    const path = join(root, "atomic.json");
    const value = { version: 1, items: Array.from({ length: 1_000 }, (_, index) => index) };
    await runCauseEffect(writeJsonFileAtomically(path, value));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), value);
    assert.deepEqual(
      (await readdir(root)).filter((entry) => entry.endsWith(".tmp")),
      [],
    );
    return undefined;
  });
} finally {
  await rm(root, { recursive: true, force: true });
  const passed = results.length === 6 && results.every((result) => result.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, results }, null, 2)}\n`);
  for (const result of results) {
    process.stdout.write(
      `${result.passed ? "PASS" : "FAIL"} ${result.name}${result.detail ? `: ${result.detail}` : ""}\n`,
    );
  }
  process.stdout.write(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}\n`);
  if (!passed) process.exitCode = 1;
}
