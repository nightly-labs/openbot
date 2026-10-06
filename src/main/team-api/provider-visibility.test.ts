// @vitest-environment node

import { describe, expect, it } from "vitest";
import { hiddenAgentView, legacyProviderView } from "./provider-visibility";

describe("provider visibility", () => {
  it("hides custom ACP agents and their provider before protocol 5, and keeps an endpoint saved as acp", () => {
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
    for (const view of [
      legacyProviderView(saved, new Set()),
      hiddenAgentView(saved, new Set(), 4),
      hiddenAgentView(saved, new Set(), 5),
    ]) {
      expect(view).toEqual(saved);
    }
    for (const view of [legacyProviderView(payload, new Set()), hiddenAgentView(payload, new Set(), 4)]) {
      expect(view).toMatchObject({
        agents: [{ id: "agent-codex" }],
        providers: [{ id: "codex" }],
        customProviders: [{ id: "acp" }],
        auth: { kind: "unknown" },
      });
    }
    expect(hiddenAgentView(payload, new Set(), 5)).toEqual(payload);
  });

  it("shows Gemini to a protocol 5 peer only", () => {
    const payload = {
      agents: [{ id: "agent-gemini", provider: "antigravity", model: "gemini-3-pro" }],
      providers: [{ id: "antigravity", state: "ready" }],
      auth: { kind: "antigravity", email: null },
    };
    expect(hiddenAgentView(payload, new Set(), 4)).toEqual({ agents: [], providers: [], auth: { kind: "unknown" } });
    expect(hiddenAgentView(payload, new Set(), 5)).toEqual(payload);
  });

  it.each([
    { provider: "cursor", version: "2026.09.28-64d2043" },
    { provider: "cline", version: "3.0.68" },
  ])("shows $provider to a protocol 6 peer only, and keeps an endpoint with its id", ({ provider, version }) => {
    const payload = {
      agents: [{ id: `agent-${provider}`, provider, model: "auto" }],
      providers: [{ id: provider, state: "ready" }],
      customProviders: [{ id: provider, name: "An endpoint saved before the provider existed" }],
      cliVersion: version,
      auth: { kind: provider, email: null },
      message: "Sign in.",
    };
    const hidden = {
      agents: [],
      providers: [],
      customProviders: [{ id: provider, name: "An endpoint saved before the provider existed" }],
      cliVersion: null,
      auth: { kind: "unknown" },
      message: null,
    };
    expect(legacyProviderView(payload, new Set())).toEqual(hidden);
    expect(hiddenAgentView(payload, new Set(), 4)).toEqual(hidden);
    expect(hiddenAgentView(payload, new Set(), 5)).toEqual(hidden);
    expect(hiddenAgentView(payload, new Set(), 6)).toEqual(payload);
  });
});
