import { describe, expect, it } from "vitest";
import { ELECTRON_RUNTIME_ENV_KEYS, withoutElectronRuntimeFlags } from "./electron-spawn-env";

describe("electron spawn environment", () => {
  it("strips the flags the Electron runtime reads", () => {
    const child = withoutElectronRuntimeFlags({
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_EXTRA_LAUNCH_ARGS: "--no-sandbox",
      OPENBOT_API_PORT: "3100",
    });

    for (const key of ELECTRON_RUNTIME_ENV_KEYS) expect(child[key]).toBeUndefined();
    expect(child.OPENBOT_API_PORT).toBe("3100");
  });

  it("leaves the parent environment untouched", () => {
    const parent: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };

    withoutElectronRuntimeFlags(parent);

    expect(parent.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});
