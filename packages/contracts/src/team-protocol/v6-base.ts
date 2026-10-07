// Frozen provider-aware schema for protocol 6: the protocol 5 schema, with Cursor (`cursor`) and Cline
// (`cline`) added to the providers and auth kinds, and `=` and `,` added to the agent model charset for
// Cursor model ids. Versions 1-5 retain their own codec.
// The schema is in `provider-aware-codec.ts`; this file holds only what protocol 6 accepts.
import { createProviderAwareCodec } from "./provider-aware-codec";

export type {
  TeamProtocolProviderAwareCapability as TeamProtocolV6BaseCapability,
  TeamProtocolProviderAwareClientEvent as TeamProtocolV6BaseClientEvent,
  TeamProtocolProviderAwareEvent as TeamProtocolV6BaseEvent,
  TeamProtocolProviderAwareEventDecodeResult as TeamProtocolV6BaseEventDecodeResult,
  TeamProtocolProviderAwareHttpMethod as TeamProtocolV6BaseHttpMethod,
  TeamProtocolProviderAwareJsonObject as TeamProtocolV6BaseJsonObject,
  TeamProtocolProviderAwareJsonValue as TeamProtocolV6BaseJsonValue,
  TeamProtocolSupportProviderAware as TeamProtocolSupportV6Base,
} from "./provider-aware-codec";
export {
  decodeTeamProtocolProviderAwareClientEvent as decodeTeamProtocolV6BaseClientEvent,
  decodeTeamProtocolSupportProviderAware as decodeTeamProtocolSupportV6Base,
  encodeTeamProtocolProviderAwareClientEvent as encodeTeamProtocolV6BaseClientEvent,
  highestCommonTeamProtocol,
  isTeamProtocolProviderAwareCapability as isTeamProtocolV6BaseCapability,
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_ProviderAware_CAPABILITIES as TEAM_PROTOCOL_V6Base_CAPABILITIES,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamProtocolProviderAwareHttpRoute as teamProtocolV6BaseHttpRoute,
  teamProtocolUpdateDirection,
} from "./provider-aware-codec";

export const TEAM_PROTOCOL_V6Base = 6;
export const TEAM_PROTOCOL_V6Base_WEBSOCKET = "openbot-team-v6";

const codec = createProviderAwareCodec({
  providers: ["codex", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"],
  authKinds: ["chatgpt", "claude", "grok", "opencode", "antigravity", "acp", "cursor", "cline"],
  // The charset of `isAgentModel`: the Claude CLI names a 1M-context model `claude-opus-5-5[1m]`, and
  // the Cursor CLI lists ids such as `gpt-5.6-sol[context=272k,reasoning=medium,fast=false]`.
  agentModel: /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]{0,159}$/u,
});

export const decodeTeamProtocolV6BaseEvent = codec.decodeEvent;
export const encodeTeamProtocolV6BaseEvent = codec.encodeEvent;
export const decodeTeamProtocolV6BaseHttpRequest = codec.decodeHttpRequest;
export const decodeTeamProtocolV6BaseHttpResponse = codec.decodeHttpResponse;
