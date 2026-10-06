// Frozen provider-aware schema for protocol 4. Versions 1-3 retain their own codec.
// The schema is in `provider-aware-codec.ts`; this file holds only what protocol 4 accepts.
import { createProviderAwareCodec } from "./provider-aware-codec";

export type {
  TeamProtocolProviderAwareCapability as TeamProtocolV4BaseCapability,
  TeamProtocolProviderAwareClientEvent as TeamProtocolV4BaseClientEvent,
  TeamProtocolProviderAwareEvent as TeamProtocolV4BaseEvent,
  TeamProtocolProviderAwareEventDecodeResult as TeamProtocolV4BaseEventDecodeResult,
  TeamProtocolProviderAwareHttpMethod as TeamProtocolV4BaseHttpMethod,
  TeamProtocolProviderAwareJsonObject as TeamProtocolV4BaseJsonObject,
  TeamProtocolProviderAwareJsonValue as TeamProtocolV4BaseJsonValue,
  TeamProtocolSupportProviderAware as TeamProtocolSupportV4Base,
} from "./provider-aware-codec";
export {
  decodeTeamProtocolProviderAwareClientEvent as decodeTeamProtocolV4BaseClientEvent,
  decodeTeamProtocolSupportProviderAware as decodeTeamProtocolSupportV4Base,
  encodeTeamProtocolProviderAwareClientEvent as encodeTeamProtocolV4BaseClientEvent,
  highestCommonTeamProtocol,
  isTeamProtocolProviderAwareCapability as isTeamProtocolV4BaseCapability,
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_ProviderAware_CAPABILITIES as TEAM_PROTOCOL_V4Base_CAPABILITIES,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolProviderAwareHttpRoute as teamProtocolV4BaseHttpRoute,
  teamProtocolUpdateDirection,
} from "./provider-aware-codec";

export const TEAM_PROTOCOL_V4Base = 4;
export const TEAM_PROTOCOL_V4Base_WEBSOCKET = "openbot-team-v4";

const codec = createProviderAwareCodec({
  providers: ["codex", "claude", "grok", "opencode"],
  authKinds: ["chatgpt", "claude", "grok", "opencode"],
  // Brackets as in `isAgentModel`: the Claude CLI names a 1M-context model `claude-opus-5-5[1m]`.
  agentModel: /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,159}$/u,
});

export const decodeTeamProtocolV4BaseEvent = codec.decodeEvent;
export const encodeTeamProtocolV4BaseEvent = codec.encodeEvent;
export const decodeTeamProtocolV4BaseHttpRequest = codec.decodeHttpRequest;
export const decodeTeamProtocolV4BaseHttpResponse = codec.decodeHttpResponse;
