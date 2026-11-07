import { describe, expect, it } from "vitest";
import { decodeBackgroundProcesses, decodeBackgroundProcessStopResult } from "./background-process-decoding";

const process = {
  id: "4242:1761830579000",
  pid: 4242,
  command: "curl",
  startedAt: 1_761_830_579_000,
  ports: [8080],
  agentId: "agent-1",
  verified: false,
};

describe("decodeBackgroundProcesses", () => {
  it("keeps whether OpenBot verified the process", () => {
    expect(decodeBackgroundProcesses([{ ...process, verified: true }, process])).toEqual([
      { ...process, verified: true },
      process,
    ]);
  });

  it("rejects a process without the verified field", () => {
    const { verified: _verified, ...unverified } = process;
    expect(() => decodeBackgroundProcesses([unverified])).toThrow("Invalid background process.");
  });
});

describe("decodeBackgroundProcessStopResult", () => {
  it("keeps whether the process stopped", () => {
    expect(decodeBackgroundProcessStopResult({ stopped: true })).toEqual({ stopped: true });
    expect(decodeBackgroundProcessStopResult({ stopped: false })).toEqual({ stopped: false });
  });

  it("rejects a result without a boolean", () => {
    expect(() => decodeBackgroundProcessStopResult({ stopped: "yes" })).toThrow(
      "Invalid background process stop result.",
    );
  });
});
