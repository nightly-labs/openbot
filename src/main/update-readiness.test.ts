// @vitest-environment node

import { describe, expect, it } from "vitest";
import { checkRestartReadiness, type RestartReadinessInput } from "./update-readiness";

function idle(): RestartReadinessInput {
  return {
    agentWork: [],
    hostBlockers: [],
    activeBrowserControls: 0,
    activeFileTransfers: false,
    updaterBusy: false,
    initializationPending: false,
  };
}

describe("checkRestartReadiness", () => {
  it("reports safe when nothing holds the instance", () => {
    expect(checkRestartReadiness(idle())).toEqual({ safeToRestart: true, reasons: [] });
  });

  it("carries agent and host reasons through", () => {
    expect(
      checkRestartReadiness({ ...idle(), agentWork: ["agent-turn", "channel-work"], hostBlockers: ["remote-desktop"] }),
    ).toEqual({
      safeToRestart: false,
      reasons: ["agent-turn", "channel-work", "remote-desktop"],
    });
  });

  it("blocks on browser controls, transfers, updater work and initialization", () => {
    expect(
      checkRestartReadiness({
        ...idle(),
        activeBrowserControls: 2,
        activeFileTransfers: true,
        updaterBusy: true,
        initializationPending: true,
      }),
    ).toEqual({
      safeToRestart: false,
      reasons: ["browser-control", "file-transfer", "update-operation", "initialization"],
    });
  });
});
