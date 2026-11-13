import { describe, expect, it } from "vitest";
import { type CpuProfile, isProfileFrame, isProfileStack, summarizeCpuProfile } from "./main-loop-profile";

const APP = "/Users/alice/Applications/OpenBot.app/Contents/Resources/app.asar";

function profile(frames: { functionName: string; url: string; lineNumber?: number }[]): CpuProfile {
  // One chain: each frame calls the next one, and each has 10 ms of own time.
  const nodes = [
    { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: -1 }, children: [2] },
    ...frames.map((frame, index) => ({
      id: index + 2,
      callFrame: { functionName: frame.functionName, url: frame.url, lineNumber: frame.lineNumber ?? 0 },
      children: index + 1 < frames.length ? [index + 3] : [],
    })),
  ];
  return {
    nodes,
    startTime: 0,
    endTime: frames.length * 10_000,
    samples: frames.map((_, index) => index + 2),
    timeDeltas: frames.map(() => 10_000),
  };
}

// Failure modes: a home directory, a file outside the application, a URL, or a name from evaluated
// text or other code reaches the log file or the analytics event.
describe("summarizeCpuProfile", () => {
  it("keeps names of application code and no directory", () => {
    const summary = summarizeCpuProfile(
      profile([
        { functionName: "listThreads", url: `file://${APP}/out/main/index.js`, lineNumber: 41 },
        { functionName: "all", url: "" },
        { functionName: "readFileSync", url: "node:fs" },
        { functionName: "parse", url: `file://${APP}/node_modules/@scope/pkg/dist/index.js` },
        { functionName: "", url: `${APP}/out/main/chunks/db-AbC1.js`, lineNumber: 6 },
      ]),
      APP,
    );
    expect(summary.top.map((entry) => entry.frame).sort()).toEqual(
      [
        "listThreads app:index.js:42",
        "all native",
        "readFileSync node:fs",
        "parse npm:@scope/pkg",
        "(anonymous) app:db-AbC1.js:7",
      ].sort(),
    );
    expect(summary.top.find((entry) => entry.frame === "all native")?.stack).toBe("listThreads app:index.js:42");
    expect(JSON.stringify(summary)).not.toContain("alice");
  });

  it("matches a Windows application path with another drive letter case", () => {
    const summary = summarizeCpuProfile(
      profile([
        { functionName: "kept", url: "file:///c:/Program%20Files/OpenBot/resources/app.asar/out/main/index.js" },
      ]),
      "C:\\Program Files\\OpenBot\\resources\\app.asar",
    );
    expect(summary.top.map((entry) => entry.frame)).toEqual(["kept app:index.js:1"]);
  });

  it("replaces other code and unsafe names with a fixed label", () => {
    const summary = summarizeCpuProfile(
      profile([
        { functionName: "secretPlugin", url: "file:///Users/alice/OpenBot/Bots/acme/tool.js" },
        { functionName: "run", url: "https://alice:hunter2@example.com/app.js?token=sk-live-abcdefgh1234" },
        { functionName: "", url: "" },
        { functionName: "token=sk-live-abcdefgh1234", url: `file://${APP}/out/main/index.js` },
        { functionName: "load", url: `file://${APP}/out/main/sk live.js` },
        { functionName: "outside", url: `file://${APP}-other/out/main/index.js` },
        { functionName: "escape", url: `file://${APP}/../../Documents/private.js` },
        { functionName: "raw", url: `${APP}/../../Documents/private.js` },
        { functionName: "encoded", url: `file://${APP}/..%2F..%2FDocuments/private.js` },
        { functionName: "named", url: "node:home/alice/private" },
        { functionName: "kept", url: `file://${APP}/out/main/index.js` },
      ]),
      APP,
    );
    const text = JSON.stringify(summary);
    for (const leak of ["alice", "hunter2", "sk-live", "example.com", "secretPlugin", "acme", "private", "outside"]) {
      expect(text).not.toContain(leak);
    }
    expect(summary.top.map((entry) => entry.frame).sort()).toEqual([
      "(anonymous) app:index.js:1",
      "(external)",
      "kept app:index.js:1",
    ]);
    for (const entry of summary.top) {
      expect(isProfileFrame(entry.frame)).toBe(true);
      expect(isProfileStack(entry.stack)).toBe(true);
    }
  });

  it("rejects a frame or a stack that the summary cannot make", () => {
    expect(isProfileFrame("run app:/Users/alice/index.js:1")).toBe(false);
    expect(isProfileFrame("run file:///Users/alice/index.js")).toBe(false);
    expect(isProfileFrame("sk-live-abcdefgh1234")).toBe(false);
    expect(isProfileStack("kept app:index.js:1 < /Users/alice/private.txt")).toBe(false);
    expect(isProfileFrame("run npm:Users/alice/Documents/secret")).toBe(false);
    expect(isProfileFrame("run node:/Users/alice/x")).toBe(false);
    expect(isProfileStack("kept app:index.js:1 < all native")).toBe(true);
    expect(isProfileFrame("listOnTimeout node:internal/timers")).toBe(true);
    expect(isProfileFrame("parse npm:@scope/pkg")).toBe(true);
  });
});
