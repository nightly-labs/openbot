// The registered HTTP adapter of each supported Team API protocol. A caller that holds a negotiated
// protocol number takes its codec from `teamHttpCodec` instead of choosing an adapter itself. Routes
// of a side protocol are not here: they use `teamSideRouteCodec`, which a caller checks first.
//
// Each entry is its frozen adapter itself. An adapter reads only the options it declares, so V1 and V3
// ignore `agentCreateModel`. A protocol older than V3 is served by the V1 adapter.
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

export interface TeamHttpCodecOptions {
  preserveSemanticTags?: boolean;
  /** Read only by V4, which accepts a model in an agent create request. */
  agentCreateModel?: boolean;
}

type DecodedRequest =
  | ReturnType<typeof decodeTeamProtocolV1CurrentHttpRequest>
  | ReturnType<typeof decodeTeamProtocolV4CurrentHttpRequest>;
type DecodedResponse =
  | ReturnType<typeof decodeTeamProtocolV1CurrentHttpResponse>
  | ReturnType<typeof decodeTeamProtocolV4CurrentHttpResponse>;

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

/** The HTTP adapter of a negotiated protocol. No protocol, or one older than V3, gets V1. */
export function teamHttpCodec(protocol: number | undefined): TeamHttpCodec {
  if (protocol === TEAM_PROTOCOL_V4) return V4_CODEC;
  if (protocol === TEAM_PROTOCOL_V3) return V3_CODEC;
  return V1_CODEC;
}
