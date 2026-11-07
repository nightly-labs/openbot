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
  stoppable: false,
};

describe("decodeBackgroundProcesses", () => {
  it("keeps whether OpenBot verified the process", () => {
    expect(decodeBackgroundProcesses([{ ...process, verified: true, stoppable: true }, process])).toEqual([
      { ...process, verified: true, stoppable: true },
      process,
    ]);
  });

  it("drops a process without the verified field instead of the whole list", () => {
    const { verified: _verified, ...unverified } = process;
    expect(decodeBackgroundProcesses([unverified, process])).toEqual([process]);
  });

  it("drops a process without the stoppable field instead of the whole list", () => {
    const { stoppable: _stoppable, ...unstoppable } = process;
    expect(decodeBackgroundProcesses([unstoppable, process])).toEqual([process]);
  });

  it("rejects an answer that is not a list", () => {
    expect(() => decodeBackgroundProcesses({})).toThrow("Invalid background processes.");
  });
});

describe("decodeBackgroundProcessStopResult", () => {
  it("keeps whether the process stopped", () => {
    expect(decodeBackgroundProcessStopResult({ stopped: true })).toEqual({ stopped: true });
    expect(decodeBackgroundProcessStopResult({ stopped: false, reason: "wrong-agent" })).toEqual({
      stopped: false,
      reason: "wrong-agent",
    });
  });

  it("rejects a result without a boolean", () => {
    expect(() => decodeBackgroundProcessStopResult({ stopped: "yes" })).toThrow(
      "Invalid background process stop result.",
    );
  });

  it("rejects an unknown reason", () => {
    expect(() => decodeBackgroundProcessStopResult({ stopped: false, reason: "other" })).toThrow(
      "Invalid background process stop result.",
    );
  });
});
