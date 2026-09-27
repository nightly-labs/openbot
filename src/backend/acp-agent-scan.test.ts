// @vitest-environment node

import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAgentCommand } from "./acp-agent-command";
import { scanAcpAgents } from "./acp-agent-scan";

let root = "";
let marker = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-acp-scan-"));
  marker = join(root, "ran");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An executable that leaves a marker file if anything ever starts it. */
async function trap(folder: string, name: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const path = join(folder, name);
  await writeFile(path, `#!/bin/sh\ntouch "${marker}"\n`);
  await chmod(path, 0o755);
  return path;
}

/** The real lookup in the given folders only, so this computer's own PATH does not change the result. */
const foldersOnly: typeof resolveAgentCommand = (command, options = {}) =>
  options.searchPath ? resolveAgentCommand(command, options) : Promise.resolve(null);

describe("scanAcpAgents", () => {
  it("finds only preset names in the listed folders, starts nothing, and suggests a free id", async () => {
    const bin = join(root, "bin");
    const goose = await trap(bin, "goose");
    await trap(bin, "evil-agent");
    await trap(join(root, "home", "tools"), "qwen");

    const rows = await scanAcpAgents({
      folders: [bin, "~/tools"],
      home: join(root, "home"),
      platform: "darwin",
      takenIds: new Set(["goose"]),
      resolve: foldersOnly,
    });

    expect(rows).toEqual([
      { id: "goose-2", name: "Goose", command: goose, args: ["acp"] },
      { id: "qwen", name: "Qwen Code", command: join(root, "home", "tools", "qwen"), args: ["--acp"] },
    ]);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finds nothing after its time", async () => {
    const rows = await scanAcpAgents({
      folders: [],
      takenIds: new Set(),
      timeoutMs: 10,
      resolve: () => new Promise(() => undefined),
    });
    expect(rows).toEqual([]);
  });
});
