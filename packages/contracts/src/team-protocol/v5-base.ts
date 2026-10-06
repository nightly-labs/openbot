// Frozen provider-aware schema for protocol 5: the protocol 4 schema, with Gemini (`antigravity`) and
// custom ACP agents (`acp`) added to the providers and auth kinds. Versions 1-4 retain their own codec.
// The schema is in `provider-aware-codec.ts`; this file holds only what protocol 5 accepts.
import { createProviderAwareCodec } from "./provider-aware-codec";

export type {
  TeamProtocolProviderAwareCapability as TeamProtocolV5BaseCapability,
  TeamProtocolProviderAwareClientEvent as TeamProtocolV5BaseClientEvent,
  TeamProtocolProviderAwareEvent as TeamProtocolV5BaseEvent,
  TeamProtocolProviderAwareEventDecodeResult as TeamProtocolV5BaseEventDecodeResult,
  TeamProtocolProviderAwareHttpMethod as TeamProtocolV5BaseHttpMethod,
  TeamProtocolProviderAwareJsonObject as TeamProtocolV5BaseJsonObject,
  TeamProtocolProviderAwareJsonValue as TeamProtocolV5BaseJsonValue,
  TeamProtocolSupportProviderAware as TeamProtocolSupportV5Base,
} from "./provider-aware-codec";
export {
  decodeTeamProtocolProviderAwareClientEvent as decodeTeamProtocolV5BaseClientEvent,
  decodeTeamProtocolSupportProviderAware as decodeTeamProtocolSupportV5Base,
  encodeTeamProtocolProviderAwareClientEvent as encodeTeamProtocolV5BaseClientEvent,
  highestCommonTeamProtocol,
  isTeamProtocolProviderAwareCapability as isTeamProtocolV5BaseCapability,
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_ProviderAware_CAPABILITIES as TEAM_PROTOCOL_V5Base_CAPABILITIES,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolProviderAwareHttpRoute as teamProtocolV5BaseHttpRoute,
  teamProtocolUpdateDirection,
} from "./provider-aware-codec";

export const TEAM_PROTOCOL_V5Base = 5;
export const TEAM_PROTOCOL_V5Base_WEBSOCKET = "openbot-team-v5";

const codec = createProviderAwareCodec({
  providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp"],
  authKinds: ["chatgpt", "claude", "grok", "opencode", "antigravity", "acp"],
  // Brackets as in `isAgentModel`: the Claude CLI names a 1M-context model `claude-opus-5-5[1m]`.
  agentModel: /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,159}$/u,
});

export const decodeTeamProtocolV5BaseEvent = codec.decodeEvent;
export const encodeTeamProtocolV5BaseEvent = codec.encodeEvent;
export const decodeTeamProtocolV5BaseHttpRequest = codec.decodeHttpRequest;
export const decodeTeamProtocolV5BaseHttpResponse = codec.decodeHttpResponse;
