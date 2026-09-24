import { describe, expect, it } from "vitest";
import { loadAgentRuntimeLock, parseAgentRuntimeLock } from "./agent-runtime-lock";

describe("agent runtime lock", () => {
  // The schema strips a key it does not name, so this is what proves the Linux artifacts survive.
  it("keeps the Linux artifact of every provider", async () => {
    const lock = await loadAgentRuntimeLock();

    expect(lock.codex.artifacts["linux-x64"].assetSha256).toHaveLength(64);
    expect(lock.claude.artifacts["linux-x64"].binarySha256).toHaveLength(64);
    expect(lock.opencode.artifacts["linux-x64"].binarySha256).toHaveLength(64);
    expect(lock.grok.artifacts["linux-x64"].assetSha256).toHaveLength(64);
    expect(lock.codex.artifacts["linux-x64"].asset).toContain("unknown-linux-musl");
    expect(lock.claude.artifacts["linux-x64"].platformDirectory).toBe("linux");
    expect(lock.opencode.artifacts["linux-x64"].platformDirectory).toBe("linux");
    expect(lock.grok.artifacts["linux-x64"].platformDirectory).toBe("linux");
  });

  it("rejects incomplete provider checksums", async () => {
    const lock = structuredClone(await loadAgentRuntimeLock());
    lock.codex.artifacts["darwin-arm64"].assetSha256 = "bad";

    expect(() => parseAgentRuntimeLock(lock)).toThrow("complete SHA-256");
  });
});
