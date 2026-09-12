// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentRuntimeLock } from "./agent-runtime-lock";
import { installGrokRuntime } from "./install-grok-runtime";
import { sha256 } from "./remote-desktop-runtime-release";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.runIf(process.platform !== "win32")("bundled Grok installer", () => {
  // The fixture binary is a shell script, so a Linux target installs and verifies on macOS too.
  it.each([
    ["darwin-arm64", "mac/arm64"],
    ["linux-x64", "linux/x64"],
  ] as const)("installs a verified %s binary into %s and reuses the current runtime", async (target, directory) => {
    const root = await mkdtemp(join(tmpdir(), "openbot-grok-runtime-test-"));
    temporaryPaths.push(root);
    const output = join(root, "output");
    const executable = Buffer.from("#!/bin/sh\nprintf 'grok 1.0.22\\n'\n");
    const license = Buffer.from("Apache license fixture\n");
    const notices = Buffer.from("Third-party notices fixture\n");
    const lock = structuredClone(await loadAgentRuntimeLock());
    lock.grok.artifacts[target].assetSha256 = sha256(executable);
    lock.grok.licenseSha256 = sha256(license);
    lock.grok.noticesSha256 = sha256(notices);
    const values = new Map([
      [lock.grok.artifacts[target].asset, executable],
      ["LICENSE", license],
      ["THIRD-PARTY-NOTICES", notices],
    ]);
    const fetchImpl = async (input: string | URL | Request) => {
      const key = String(input).split("/").at(-1) ?? "";
      return new Response(values.get(key), { status: values.has(key) ? 200 : 404 });
    };

    await expect(installGrokRuntime({ outputRoot: output, target, fetchImpl, lock })).resolves.toBe("installed");
    await expect(installGrokRuntime({ outputRoot: output, target, fetchImpl, lock })).resolves.toBe("current");
    await expect(readFile(join(output, directory, "grok-package.json"), "utf8")).resolves.toContain('"1.0.22"');
    await expect(readFile(join(output, "licenses/Grok-CLI-LICENSE"), "utf8")).resolves.toBe(license.toString());
    const mode = (await stat(join(output, directory, "bin/grok"))).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("rejects a binary with the wrong checksum", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-grok-runtime-test-"));
    temporaryPaths.push(root);
    const lock = structuredClone(await loadAgentRuntimeLock());
    const fetchImpl = async () => new Response("unexpected", { status: 200 });
    await expect(
      installGrokRuntime({ outputRoot: join(root, "output"), target: "darwin-arm64", fetchImpl, lock }),
    ).rejects.toThrow("checksum is invalid");
  });
});
