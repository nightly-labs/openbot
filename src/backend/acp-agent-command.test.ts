// @vitest-environment node

import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "./acp-agent-command";
import { runCauseEffect } from "./effect-boundary";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-acp-command-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function executable(name: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, 0o755);
  return path;
}

describe("resolveAgentCommand", () => {
  it("refuses shell text and never runs it", async () => {
    const marker = join(root, "marker");
    for (const command of [
      `goose; touch ${marker}`,
      `$(touch ${marker})`,
      `\`touch ${marker}\``,
      `goose && touch ${marker}`,
      "goose acp",
      "-rf",
      "goose\nid",
      " goose",
    ]) {
      await expect(runCauseEffect(resolveAgentCommand(command, { searchPath: [root] })), command).rejects.toThrow();
    }
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finds a bare name in the given folders, and a path in the home folder", async () => {
    const goose = await executable("goose");
    expect(
      await runCauseEffect(resolveAgentCommand("goose", { searchPath: ["relative/bin", root], platform: "darwin" })),
    ).toBe(goose);
    expect(await runCauseEffect(resolveAgentCommand("~/goose", { home: root, platform: "darwin" }))).toBe(goose);
    expect(await runCauseEffect(resolveAgentCommand(goose, { platform: "darwin" }))).toBe(goose);
    expect(await runCauseEffect(resolveAgentCommand("qwen", { searchPath: [root], platform: "darwin" }))).toBeNull();
  });

  it("does not take a file that cannot run", async () => {
    await writeFile(join(root, "notes"), "text");
    expect(await runCauseEffect(resolveAgentCommand("notes", { searchPath: [root], platform: "darwin" }))).toBeNull();
  });
});

describe("argument guards", () => {
  it("refuses a line break and too many arguments", () => {
    expect(() => assertAgentArgs(["acp", "a\nb"])).toThrow();
    expect(() => assertAgentArgs(Array.from({ length: 33 }, () => "x"))).toThrow();
    expect(() => assertAgentArgs(["acp", "--model=a b"])).not.toThrow();
  });

  it("refuses an argument that could leave the one cmd.exe command line", () => {
    for (const arg of ["a&calc", "a|b", "%PATH%", "a^b", '"x"', "a b"]) {
      expect(() => assertWindowsScriptArgs("C:\\tools\\agent.cmd", [arg], "win32"), arg).toThrow();
    }
    expect(() => assertWindowsScriptArgs("C:\\tools\\agent.cmd", ["--acp", "C:\\work"], "win32")).not.toThrow();
    expect(() => assertWindowsScriptArgs("C:\\tools\\agent.exe", ["a&calc"], "win32")).not.toThrow();
    expect(() => assertWindowsScriptArgs("/usr/bin/agent.cmd", ["a&calc"], "darwin")).not.toThrow();
  });
});
