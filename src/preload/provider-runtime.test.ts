import { describe, expect, it } from "vitest";
import { decodeProviderRuntimeSnapshot } from "./provider-runtime";

const runtime = { phase: "ready", progress: null, message: null, version: "1.0.0" };
function snapshot(availableVersion?: string | number | null) {
  return { revision: 1, providers: { codex: runtime, claude: { ...runtime, availableVersion }, grok: runtime } };
}

describe("provider runtime decoding", () => {
  it("preserves the update offer across the preload boundary", () => {
    expect(decodeProviderRuntimeSnapshot(snapshot("1.1.0")).providers.claude.availableVersion).toBe("1.1.0");
  });
  it("accepts snapshots from before update offers were added", () => {
    expect(decodeProviderRuntimeSnapshot(snapshot()).providers.claude.availableVersion).toBeNull();
  });
  it("rejects an invalid update version", () => {
    expect(() => decodeProviderRuntimeSnapshot(snapshot(42))).toThrow("Invalid provider runtime response.");
  });
});
