import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "./capability-limits";
import { createProviderAwareCodec, decodeTeamProtocolSupportProviderAware } from "./provider-aware-codec";

export type {
  TeamProtocolProviderAwareCapability as TeamProtocolV7BaseCapability,
  TeamProtocolProviderAwareClientEvent as TeamProtocolV7BaseClientEvent,
  TeamProtocolProviderAwareEvent as TeamProtocolV7BaseEvent,
  TeamProtocolProviderAwareEventDecodeResult as TeamProtocolV7BaseEventDecodeResult,
  TeamProtocolProviderAwareHttpMethod as TeamProtocolV7BaseHttpMethod,
  TeamProtocolProviderAwareJsonObject as TeamProtocolV7BaseJsonObject,
  TeamProtocolProviderAwareJsonValue as TeamProtocolV7BaseJsonValue,
  TeamProtocolSupportProviderAware as TeamProtocolSupportV7Base,
} from "./provider-aware-codec";
export {
  decodeTeamProtocolProviderAwareClientEvent as decodeTeamProtocolV7BaseClientEvent,
  encodeTeamProtocolProviderAwareClientEvent as encodeTeamProtocolV7BaseClientEvent,
  highestCommonTeamProtocol,
  isTeamProtocolProviderAwareCapability as isTeamProtocolV7BaseCapability,
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_ProviderAware_CAPABILITIES as TEAM_PROTOCOL_V7Base_CAPABILITIES,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolProviderAwareHttpRoute as teamProtocolV7BaseHttpRoute,
  teamProtocolUpdateDirection,
} from "./provider-aware-codec";

export const TEAM_PROTOCOL_V7Base = 7;
export const TEAM_PROTOCOL_V7Base_WEBSOCKET = "openbot-team-v7";

export const decodeTeamProtocolSupportV7Base = (value: unknown) =>
  decodeTeamProtocolSupportProviderAware(value, TEAM_PROTOCOL_CAPABILITY_LIMITS[7]);

const codec = createProviderAwareCodec({
  maximumCapabilities: TEAM_PROTOCOL_CAPABILITY_LIMITS[7],
  providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline", "pi", "muse"],
  authKinds: ["chatgpt", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline", "pi", "muse"],
  agentModel: /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u,
});

export const decodeTeamProtocolV7BaseEvent = codec.decodeEvent;
export const encodeTeamProtocolV7BaseEvent = codec.encodeEvent;
export const decodeTeamProtocolV7BaseHttpRequest = codec.decodeHttpRequest;
export const decodeTeamProtocolV7BaseHttpResponse = codec.decodeHttpResponse;
