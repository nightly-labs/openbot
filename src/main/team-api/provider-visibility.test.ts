// @vitest-environment node

import { describe, expect, it } from "vitest";
import { hiddenAgentView, legacyProviderView } from "./provider-visibility";

describe("provider visibility", () => {
  it("hides custom ACP agents and their provider on every protocol, and keeps an endpoint saved as acp", () => {
    const payload = {
      agents: [
        { id: "agent-goose", provider: "acp", model: "goose/default" },
        { id: "agent-codex", provider: "codex", model: "gpt-5.5" },
      ],
      providers: [
        { id: "acp", state: "ready" },
        { id: "codex", state: "ready" },
      ],
      customProviders: [{ id: "acp", name: "An endpoint saved before the provider existed" }],
      auth: { kind: "acp" },
    };
    // A custom endpoint save or delete reply lists the endpoints under `providers`.
    const saved = { providers: [{ id: "acp", name: "Old endpoint", baseUrl: "http://127.0.0.1:1234/v1" }] };
    for (const view of [legacyProviderView(saved, new Set()), hiddenAgentView(saved, new Set())]) {
      expect(view).toEqual(saved);
    }
    for (const view of [legacyProviderView(payload, new Set()), hiddenAgentView(payload, new Set())]) {
      expect(view).toMatchObject({
        agents: [{ id: "agent-codex" }],
        providers: [{ id: "codex" }],
        customProviders: [{ id: "acp" }],
        auth: { kind: "unknown" },
      });
    }
  });
});
