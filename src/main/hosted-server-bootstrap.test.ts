import { describe, expect, it } from "vitest";
import { takeHostedServerEnvironment } from "./hosted-server-bootstrap";

const HOST_ID = "0b6f7a52-4c1e-4d7e-9c55-2f9a3c1d8e70";

describe("takeHostedServerEnvironment", () => {
  it("removes the claim from the environment that agents inherit", () => {
    const environment: NodeJS.ProcessEnv = {
      OPENBOT_HOSTED_SERVER: "1",
      OPENBOT_HOSTED_HOST_ID: HOST_ID.toUpperCase(),
      OPENBOT_HOSTED_CLAIM: "claim-secret",
    };
    expect(takeHostedServerEnvironment(environment, true, "linux")).toEqual({ hostId: HOST_ID, claim: "claim-secret" });
    expect(environment).not.toHaveProperty("OPENBOT_HOSTED_CLAIM");
  });

  it("is off outside a packaged Linux build that the server template started", () => {
    for (const [environment, isPackaged, platform] of [
      [{ OPENBOT_HOSTED_SERVER: "1", OPENBOT_HOSTED_HOST_ID: HOST_ID }, false, "linux"],
      [{ OPENBOT_HOSTED_SERVER: "1", OPENBOT_HOSTED_HOST_ID: HOST_ID }, true, "darwin"],
      [{ OPENBOT_HOSTED_HOST_ID: HOST_ID }, true, "linux"],
      [{ OPENBOT_HOSTED_SERVER: "1", OPENBOT_HOSTED_HOST_ID: "not-a-host" }, true, "linux"],
    ] as const) {
      const copy: NodeJS.ProcessEnv = { ...environment, OPENBOT_HOSTED_CLAIM: "claim-secret" };
      expect(takeHostedServerEnvironment(copy, isPackaged, platform)).toBeNull();
      expect(copy).not.toHaveProperty("OPENBOT_HOSTED_CLAIM");
    }
  });
});
