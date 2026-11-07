import { describe, expect, it } from "vitest";
import { decodeProviderRuntimeSnapshot } from "./provider-runtime";

const runtime = { phase: "ready", progress: null, message: null, version: "1.0.0" };
function snapshot(availableVersion?: string | number | null) {
  return {
    revision: 1,
    providers: {
      codex: runtime,
      claude: { ...runtime, availableVersion },
      grok: runtime,
      opencode: runtime,
      antigravity: runtime,
      cursor: runtime,
      cline: runtime,
      kimi: runtime,
      pi: runtime,
      muse: runtime,
      devin: runtime,
      copilot: runtime,
      mistral: runtime,
    },
    // The tool runtimes travel beside the provider CLIs and are decoded the same way. Main and
    // preload are one build, so a snapshot without them is a main process this one cannot trust.
    toolRuntimes: { bun: runtime },
  };
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
  it("keeps a Hermes installer status only when main sends one", () => {
    expect(decodeProviderRuntimeSnapshot(snapshot()).providers.hermes).toBeUndefined();
    const withHermes = snapshot();
    const installing = { phase: "downloading", progress: 40, message: null, version: null };
    expect(
      decodeProviderRuntimeSnapshot({ ...withHermes, providers: { ...withHermes.providers, hermes: installing } })
        .providers.hermes,
    ).toEqual({ ...installing, availableVersion: null });
  });
  it("rejects an invalid Hermes installer status", () => {
    const withHermes = snapshot();
    expect(() =>
      decodeProviderRuntimeSnapshot({ ...withHermes, providers: { ...withHermes.providers, hermes: { phase: "x" } } }),
    ).toThrow("Invalid provider runtime response.");
  });
});
