import { describe, expect, it } from "vitest";
import bots from "./fixtures/v4/host-http-response.json";
import {
  decodeTeamProtocolV4BaseEvent,
  decodeTeamProtocolV4BaseHttpRequest,
  decodeTeamProtocolV4BaseHttpResponse,
} from "./v4-base";
import {
  decodeTeamProtocolV5BaseEvent,
  decodeTeamProtocolV5BaseHttpRequest,
  decodeTeamProtocolV5BaseHttpResponse,
} from "./v5-base";
import {
  decodeTeamProtocolV6BaseEvent,
  decodeTeamProtocolV6BaseHttpRequest,
  decodeTeamProtocolV6BaseHttpResponse,
} from "./v6-base";

// The profile of each released provider-aware protocol. These lists are frozen: a change here changes
// what a shipped peer accepts. A new provider needs a new protocol version.
const v4Providers = ["codex", "claude", "grok", "opencode"];
const v5Providers = [...v4Providers, "antigravity", "acp"];
const v6Providers = [...v5Providers, "cursor", "cline"];
const signedIn = (providers: string[]) => providers.map((provider) => (provider === "codex" ? "chatgpt" : provider));
const bracketModels = ["claude-opus-5-5[1m]", "a", "a/b:c.d_e-f", "a".repeat(160)];
const cursorModels = ["gpt-5.6-sol[context=272k,reasoning=medium,fast=false]", "a,b", "a=b"];

const protocols = [
  {
    version: 4,
    decodeEvent: decodeTeamProtocolV4BaseEvent,
    decodeRequest: decodeTeamProtocolV4BaseHttpRequest,
    decodeResponse: decodeTeamProtocolV4BaseHttpResponse,
    providers: v4Providers,
    authKinds: signedIn(v4Providers),
    models: bracketModels,
  },
  {
    version: 5,
    decodeEvent: decodeTeamProtocolV5BaseEvent,
    decodeRequest: decodeTeamProtocolV5BaseHttpRequest,
    decodeResponse: decodeTeamProtocolV5BaseHttpResponse,
    providers: v5Providers,
    authKinds: signedIn(v5Providers),
    models: bracketModels,
  },
  {
    version: 6,
    decodeEvent: decodeTeamProtocolV6BaseEvent,
    decodeRequest: decodeTeamProtocolV6BaseHttpRequest,
    decodeResponse: decodeTeamProtocolV6BaseHttpResponse,
    providers: v6Providers,
    authKinds: signedIn(v6Providers),
    models: [...bracketModels, ...cursorModels],
  },
];

const candidates = [...v6Providers, "chatgpt", "gemini", "unknown", "", "Codex", " codex", "cursor\u0000"];
const models = [...bracketModels, ...cursorModels, "a".repeat(161), "-a", "[1m]", "a b", "aä", ""];
const bot = bots[0];
const status = {
  phase: "ready",
  cliVersion: null,
  auth: { kind: "claude", email: null },
  providers: [{ id: "claude", state: "available", version: "1.0.0", message: null }],
  capabilities: { chat: "ready", browser: "ready", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};
const option = {
  provider: "claude",
  id: "claude-opus-5-5[1m]",
  name: "Opus",
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium"],
};

function accepts(run: () => unknown): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

describe("provider-aware base codecs", () => {
  for (const protocol of protocols) {
    it(`accepts exactly the protocol ${protocol.version} providers, auth kinds and model ids`, () => {
      const { decodeEvent, decodeRequest, decodeResponse } = protocol;
      for (const value of candidates) {
        const known = protocol.providers.includes(value);
        const agent = { ...bot, provider: value };
        expect(
          accepts(() => decodeResponse("GET", "/v1/agents", 200, [agent])),
          `agent ${value}`,
        ).toBe(known);
        expect(decodeEvent({ type: "bots-changed", bots: [agent] }).kind, `event ${value}`).toBe(
          known ? "known" : "invalid",
        );
        expect(
          accepts(() => decodeRequest("PATCH", "/v1/agents/a1", { provider: value })),
          `update ${value}`,
        ).toBe(known);
        expect(
          accepts(() => decodeResponse("GET", "/v1/agents/models", 200, [{ ...option, provider: value }])),
          `model option ${value}`,
        ).toBe(known);
        const providerStatus = { ...status, providers: [{ ...status.providers[0], id: value }] };
        expect(
          accepts(() => decodeResponse("GET", "/v1/agents/status", 200, providerStatus)),
          `status ${value}`,
        ).toBe(known);
        const auth = { ...status, auth: { kind: value, email: null } };
        expect(
          accepts(() => decodeResponse("GET", "/v1/agents/status", 200, auth)),
          `auth ${value}`,
        ).toBe(protocol.authKinds.includes(value) || value === "unknown");
      }
      for (const model of models) {
        expect(
          accepts(() => decodeResponse("GET", "/v1/agents", 200, [{ ...bot, model }])),
          `model ${model}`,
        ).toBe(protocol.models.includes(model));
      }
    });
  }
});
