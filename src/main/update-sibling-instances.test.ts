// @vitest-environment node

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { listSiblingOpenBotInstances, parseSiblingInstances, SiblingScanFailed } from "./update-sibling-instances";

const processMock = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => processMock);

const EXECUTABLE = "/Applications/OpenBot.app/Contents/MacOS/OpenBot";

const PS_OUTPUT = [
  "  101   501 /Applications/OpenBot.app/Contents/MacOS/OpenBot",
  "  202   502 /Applications/OpenBot.app/Contents/MacOS/OpenBot",
  "  303   501 /Applications/OpenBot.app/Contents/Frameworks/OpenBot Helper.app/Contents/MacOS/OpenBot Helper",
  "  404   501 /usr/sbin/systemstats",
  "garbage line without numbers",
  "",
].join("\n");

describe("parseSiblingInstances", () => {
  it("finds another user's session and skips this process", () => {
    expect(parseSiblingInstances(PS_OUTPUT, { executablePath: EXECUTABLE, currentPid: 101 })).toEqual([
      { pid: 202, uid: 502 },
    ]);
  });

  it("matches the executable with arguments appended", () => {
    const output = `111 501 ${EXECUTABLE} --user-data-dir /tmp/x`;
    expect(parseSiblingInstances(output, { executablePath: EXECUTABLE, currentPid: 999 })).toEqual([
      { pid: 111, uid: 501 },
    ]);
  });

  it("never mistakes an Electron helper for the main process", () => {
    const output = `303 501 ${EXECUTABLE.replace("MacOS/OpenBot", "Frameworks/OpenBot Helper")}`;
    expect(parseSiblingInstances(output, { executablePath: EXECUTABLE, currentPid: 999 })).toEqual([]);
  });

  it("ignores malformed lines and an empty executable path", () => {
    expect(parseSiblingInstances("garbage\n\n", { executablePath: EXECUTABLE, currentPid: 1 })).toEqual([]);
    expect(parseSiblingInstances(PS_OUTPUT, { executablePath: "   ", currentPid: 1 })).toEqual([]);
  });
});

describe("listSiblingOpenBotInstances", () => {
  it("blocks installation when the OS process command fails", async () => {
    processMock.execFile.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error, stdout: string) => void) => {
        callback(new Error("output buffer overflow"), "");
      },
    );
    await expect(
      runCauseEffect(listSiblingOpenBotInstances({ executablePath: EXECUTABLE, currentPid: 101, platform: "darwin" })),
    ).rejects.toThrow("Could not verify other OpenBot sessions");
    expect(processMock.execFile).toHaveBeenCalledWith(
      "/bin/ps",
      ["-ax", "-o", "pid=,uid=,comm="],
      expect.any(Function),
    );
  });
  it("scans with ps on macOS", async () => {
    const listProcesses = vi.fn(() => Effect.succeed(PS_OUTPUT));
    const siblings = await runCauseEffect(
      listSiblingOpenBotInstances({
        executablePath: EXECUTABLE,
        currentPid: 101,
        platform: "darwin",
        listProcesses,
      }),
    );
    expect(listProcesses).toHaveBeenCalledOnce();
    expect(siblings).toEqual([{ pid: 202, uid: 502 }]);
  });

  it("rejects a failed scan instead of reporting no siblings", async () => {
    await expect(
      runCauseEffect(
        listSiblingOpenBotInstances({
          executablePath: EXECUTABLE,
          currentPid: 101,
          platform: "darwin",
          listProcesses: () => Effect.fail(new SiblingScanFailed({ cause: new Error("scan failed") })),
        }),
      ),
    ).rejects.toThrow("scan failed");
  });

  it.each([
    ["win32", PS_OUTPUT],
    // Chromium children on Linux run the main executable, so a scan would find this session itself.
    ["linux", "  101  1000 /tmp/.mount_OpenBo/openbot\n  102  1000 /tmp/.mount_OpenBo/openbot --type=zygote"],
  ] as const)("does not scan on %s", async (platform, output) => {
    const listProcesses = vi.fn(() => Effect.succeed(output));
    const siblings = await runCauseEffect(
      listSiblingOpenBotInstances({
        executablePath: platform === "linux" ? "/tmp/.mount_OpenBo/openbot" : EXECUTABLE,
        currentPid: 101,
        platform,
        listProcesses,
      }),
    );
    expect(listProcesses).not.toHaveBeenCalled();
    expect(siblings).toEqual([]);
  });
});
