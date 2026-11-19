import { TEAM_PROTOCOL_CAPABILITY_LIMITS } from "./capability-limits";
import { createProviderAwareCodec, decodeTeamProtocolSupportProviderAware } from "./provider-aware-codec";
import { TEAM_REASONING_EFFORTS } from "./reasoning-efforts-v1";

export type {
  TeamProtocolProviderAwareCapability as TeamProtocolV8BaseCapability,
  TeamProtocolProviderAwareClientEvent as TeamProtocolV8BaseClientEvent,
  TeamProtocolProviderAwareEvent as TeamProtocolV8BaseEvent,
  TeamProtocolProviderAwareEventDecodeResult as TeamProtocolV8BaseEventDecodeResult,
  TeamProtocolProviderAwareHttpMethod as TeamProtocolV8BaseHttpMethod,
  TeamProtocolProviderAwareJsonObject as TeamProtocolV8BaseJsonObject,
  TeamProtocolProviderAwareJsonValue as TeamProtocolV8BaseJsonValue,
  TeamProtocolSupportProviderAware as TeamProtocolSupportV8Base,
} from "./provider-aware-codec";
export {
  decodeTeamProtocolProviderAwareClientEvent as decodeTeamProtocolV8BaseClientEvent,
  encodeTeamProtocolProviderAwareClientEvent as encodeTeamProtocolV8BaseClientEvent,
  highestCommonTeamProtocol,
  isTeamProtocolProviderAwareCapability as isTeamProtocolV8BaseCapability,
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_ProviderAware_CAPABILITIES as TEAM_PROTOCOL_V8Base_CAPABILITIES,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolProviderAwareHttpRoute as teamProtocolV8BaseHttpRoute,
  teamProtocolUpdateDirection,
} from "./provider-aware-codec";

export const TEAM_PROTOCOL_V8Base = 8;
export const TEAM_PROTOCOL_V8Base_WEBSOCKET = "openbot-team-v8";

export const decodeTeamProtocolSupportV8Base = (value: unknown) =>
  decodeTeamProtocolSupportProviderAware(value, TEAM_PROTOCOL_CAPABILITY_LIMITS[8]);

const codec = createProviderAwareCodec({
  maximumCapabilities: TEAM_PROTOCOL_CAPABILITY_LIMITS[8],
  providers: "open",
  authKinds: "open",
  agentModel: /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u,
  reasoningEfforts: TEAM_REASONING_EFFORTS,
});

export const decodeTeamProtocolV8BaseEvent = codec.decodeEvent;
export const encodeTeamProtocolV8BaseEvent = codec.encodeEvent;
export const decodeTeamProtocolV8BaseHttpRequest = codec.decodeHttpRequest;
export const decodeTeamProtocolV8BaseHttpResponse = codec.decodeHttpResponse;
