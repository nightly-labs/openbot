// The registered HTTP adapter of each supported Team API protocol. A caller that holds a negotiated
// protocol number takes its codec from `teamHttpCodec` instead of choosing an adapter itself. Routes
// of a side protocol are not here: they use `teamSideRouteCodec`, which a caller checks first.
//
// Each entry is its frozen adapter itself. An adapter reads only the options it declares, so V1 and V3
// ignore `agentCreateModel`. A protocol older than V3 is served by the V1 adapter.

import { TEAM_API_ROUTES } from "../team-api-routes";
import {
  decodeTeamProtocolV1CurrentHttpRequest,
  decodeTeamProtocolV1CurrentHttpResponse,
  encodeTeamProtocolV1CurrentHttpRequest,
  encodeTeamProtocolV1CurrentHttpResponse,
} from "./v1-adapter";
import { TEAM_PROTOCOL_V3 } from "./v3";
import {
  decodeTeamProtocolV3CurrentHttpRequest,
  decodeTeamProtocolV3CurrentHttpResponse,
  encodeTeamProtocolV3CurrentHttpRequest,
  encodeTeamProtocolV3CurrentHttpResponse,
} from "./v3-adapter";
import { TEAM_PROTOCOL_V4 } from "./v4";
import {
  decodeTeamProtocolV4CurrentHttpRequest,
  decodeTeamProtocolV4CurrentHttpResponse,
  encodeTeamProtocolV4CurrentHttpRequest,
  encodeTeamProtocolV4CurrentHttpResponse,
} from "./v4-adapter";
import { TEAM_PROTOCOL_V5 } from "./v5";
import {
  decodeTeamProtocolV5CurrentHttpRequest,
  decodeTeamProtocolV5CurrentHttpResponse,
  encodeTeamProtocolV5CurrentHttpRequest,
  encodeTeamProtocolV5CurrentHttpResponse,
} from "./v5-adapter";
import { TEAM_PROTOCOL_V6 } from "./v6";
import {
  decodeTeamProtocolV6CurrentHttpRequest,
  decodeTeamProtocolV6CurrentHttpResponse,
  encodeTeamProtocolV6CurrentHttpRequest,
  encodeTeamProtocolV6CurrentHttpResponse,
} from "./v6-adapter";
import { TEAM_PROTOCOL_V7 } from "./v7";
import {
  decodeTeamProtocolV7CurrentHttpRequest,
  decodeTeamProtocolV7CurrentHttpResponse,
  encodeTeamProtocolV7CurrentHttpRequest,
  encodeTeamProtocolV7CurrentHttpResponse,
} from "./v7-adapter";
import { TEAM_PROTOCOL_V8 } from "./v8";
import {
  decodeTeamProtocolV8CurrentHttpRequest,
  decodeTeamProtocolV8CurrentHttpResponse,
  encodeTeamProtocolV8CurrentHttpRequest,
  encodeTeamProtocolV8CurrentHttpResponse,
} from "./v8-adapter";
import { decodeTeamProtocolSupportV9, TEAM_PROTOCOL_V9 } from "./v9";

export interface TeamHttpCodecOptions {
  preserveSemanticTags?: boolean;
  /** Read only by V4 to V8, which accept a model in an agent create request. */
  agentCreateModel?: boolean;
  /** Read only by V7 and V8 responses: the negotiated history-extent-v1 capability. */
  historyExtent?: boolean;
  /** Read only by V7 and V8 responses: the negotiated ui-blocks-v1 capability. */
  uiBlocks?: boolean;
  /** Read only by V7 and V8 responses: the negotiated subagents-v1 capability. */
  subagents?: boolean;
  /** Read only by V7 responses: the negotiated prompt-multi-select-v1 capability. */
  promptMultiSelect?: boolean;
}

type DecodedRequest =
  | ReturnType<typeof decodeTeamProtocolV1CurrentHttpRequest>
  | ReturnType<typeof decodeTeamProtocolV4CurrentHttpRequest>
  | ReturnType<typeof decodeTeamProtocolV5CurrentHttpRequest>
  | ReturnType<typeof decodeTeamProtocolV6CurrentHttpRequest>
  | ReturnType<typeof decodeTeamProtocolV7CurrentHttpRequest>
  | ReturnType<typeof decodeTeamProtocolV8CurrentHttpRequest>;
type DecodedResponse =
  | ReturnType<typeof decodeTeamProtocolV1CurrentHttpResponse>
  | ReturnType<typeof decodeTeamProtocolV4CurrentHttpResponse>
  | ReturnType<typeof decodeTeamProtocolV5CurrentHttpResponse>
  | ReturnType<typeof decodeTeamProtocolV6CurrentHttpResponse>
  | ReturnType<typeof decodeTeamProtocolV7CurrentHttpResponse>
  | ReturnType<typeof decodeTeamProtocolV8CurrentHttpResponse>;

export interface TeamHttpCodec {
  encodeRequest(method: string, path: string, value: unknown, options: TeamHttpCodecOptions): string;
  decodeRequest(method: string, path: string, value: unknown, options: TeamHttpCodecOptions): DecodedRequest;
  encodeResponse(method: string, path: string, status: number, value: unknown, options: TeamHttpCodecOptions): string;
  decodeResponse(method: string, path: string, status: number, value: unknown): DecodedResponse;
}

const V1_CODEC: TeamHttpCodec = {
  encodeRequest: encodeTeamProtocolV1CurrentHttpRequest,
  // The V1 request decoder takes no options.
  decodeRequest: (method, path, value) => decodeTeamProtocolV1CurrentHttpRequest(method, path, value),
  encodeResponse: encodeTeamProtocolV1CurrentHttpResponse,
  decodeResponse: decodeTeamProtocolV1CurrentHttpResponse,
};

const V3_CODEC: TeamHttpCodec = {
  encodeRequest: encodeTeamProtocolV3CurrentHttpRequest,
  decodeRequest: decodeTeamProtocolV3CurrentHttpRequest,
  encodeResponse: encodeTeamProtocolV3CurrentHttpResponse,
  decodeResponse: decodeTeamProtocolV3CurrentHttpResponse,
};

const V4_CODEC: TeamHttpCodec = {
  encodeRequest: encodeTeamProtocolV4CurrentHttpRequest,
  decodeRequest: decodeTeamProtocolV4CurrentHttpRequest,
  encodeResponse: encodeTeamProtocolV4CurrentHttpResponse,
  decodeResponse: decodeTeamProtocolV4CurrentHttpResponse,
};

const V5_CODEC: TeamHttpCodec = {
  encodeRequest: encodeTeamProtocolV5CurrentHttpRequest,
  decodeRequest: decodeTeamProtocolV5CurrentHttpRequest,
  encodeResponse: encodeTeamProtocolV5CurrentHttpResponse,
  decodeResponse: decodeTeamProtocolV5CurrentHttpResponse,
};

const V7_CODEC: TeamHttpCodec = {
  encodeRequest: encodeTeamProtocolV7CurrentHttpRequest,
  decodeRequest: decodeTeamProtocolV7CurrentHttpRequest,
  encodeResponse: encodeTeamProtocolV7CurrentHttpResponse,
  decodeResponse: decodeTeamProtocolV7CurrentHttpResponse,
};

const V8_CODEC: TeamHttpCodec = {
  encodeRequest: encodeTeamProtocolV8CurrentHttpRequest,
  decodeRequest: decodeTeamProtocolV8CurrentHttpRequest,
  encodeResponse: encodeTeamProtocolV8CurrentHttpResponse,
  decodeResponse: decodeTeamProtocolV8CurrentHttpResponse,
};

/** Protocol 9 is the protocol 8 wire. Only its compatibility response has up to 256 capabilities. */
const V9_CODEC: TeamHttpCodec = {
  ...V8_CODEC,
  encodeResponse: (method, path, status, value, options) =>
    isCompatibilityRead(method, path, status)
      ? JSON.stringify(decodeTeamProtocolSupportV9(value))
      : V8_CODEC.encodeResponse(method, path, status, value, options),
  decodeResponse: (method, path, status, value) =>
    isCompatibilityRead(method, path, status)
      ? { ...decodeTeamProtocolSupportV9(value) }
      : V8_CODEC.decodeResponse(method, path, status, value),
};

function isCompatibilityRead(method: string, path: string, status: number): boolean {
  return (
    method === "GET" &&
    status === 200 &&
    new URL(path, "http://openbot.invalid").pathname === TEAM_API_ROUTES.compatibility
  );
}

const V6_CODEC: TeamHttpCodec = {
  encodeRequest: encodeTeamProtocolV6CurrentHttpRequest,
  decodeRequest: decodeTeamProtocolV6CurrentHttpRequest,
  encodeResponse: encodeTeamProtocolV6CurrentHttpResponse,
  decodeResponse: decodeTeamProtocolV6CurrentHttpResponse,
};

/** The HTTP adapter of a negotiated protocol. No protocol, or one older than V3, gets V1. */
export function teamHttpCodec(protocol: number | undefined): TeamHttpCodec {
  if (protocol === TEAM_PROTOCOL_V9) return V9_CODEC;
  if (protocol === TEAM_PROTOCOL_V8) return V8_CODEC;
  if (protocol === TEAM_PROTOCOL_V7) return V7_CODEC;
  if (protocol === TEAM_PROTOCOL_V6) return V6_CODEC;
  if (protocol === TEAM_PROTOCOL_V5) return V5_CODEC;
  if (protocol === TEAM_PROTOCOL_V4) return V4_CODEC;
  if (protocol === TEAM_PROTOCOL_V3) return V3_CODEC;
  return V1_CODEC;
}
