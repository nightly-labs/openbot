import { describe, expect, it } from "vitest";
import { bootedSimulatorIds, hasMobileRuntime, hasNewIosDevice, parseDevMobileArgs } from "./dev-mobile";

describe("dev:mobile", () => {
  it("keeps its own flags and passes the rest to mobile:ios", () => {
    expect(parseDevMobileArgs(["--", "--pair-only", "--simulator=ABC", "--port", "8099", "--rocketsim"])).toEqual({
      pairOnly: true,
      simulator: "ABC",
      metroPort: 8099,
      mobileArgs: ["--port", "8099", "--rocketsim"],
    });
    expect(parseDevMobileArgs([]).metroPort).toBe(8081);
  });

  it("waits for the OpenBot runtime, not any app on Metro", () => {
    expect(hasMobileRuntime([{ appId: "com.example.other" }])).toBe(false);
    expect(hasMobileRuntime([{ appId: "run.openbot.mobile" }])).toBe(true);
  });

  it("confirms pairing only from an iOS session created after the link was sent", () => {
    const devices = [{ platform: "ios", connectedAt: 1_000 }];
    expect(hasNewIosDevice(devices, 2_000)).toBe(false);
    expect(hasNewIosDevice(devices, 1_000)).toBe(true);
    expect(hasNewIosDevice([{ platform: "android", connectedAt: 3_000 }], 2_000)).toBe(false);
  });

  it("reads booted simulators from simctl JSON", () => {
    const list = {
      devices: {
        "iOS-26": [
          { udid: "A", state: "Booted" },
          { udid: "B", state: "Shutdown" },
        ],
      },
    };
    expect(bootedSimulatorIds(list)).toEqual(["A"]);
  });
});
