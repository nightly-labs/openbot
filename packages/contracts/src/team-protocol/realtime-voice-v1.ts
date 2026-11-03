// Optional realtime-voice-v1: host-owned SDP exchange only. No tool or chat execution privilege.
// A signed-in member needs current chat access to the selected agent for each handshake.
import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
export const REALTIME_VOICE_CAPABILITY = "realtime-voice-v1";
export const REALTIME_VOICE_SELECTION_CAPABILITY = "realtime-voice-selection-v1";
export const REALTIME_VOICE_SELECTION_ROUTE = "/v1/realtime-voice/voice";
export const REALTIME_VOICE_ROUTES = {
  status: "/v1/realtime-voice/status",
  settings: "/v1/realtime-voice/settings",
  connect: "/v1/realtime-voice/connect",
  poll: "/v1/realtime-voice/poll",
  reply: "/v1/realtime-voice/reply",
  end: "/v1/realtime-voice/end",
} as const;
export const REALTIME_VOICE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    REALTIME_VOICE_SELECTION_ROUTE,
    adminRoute(fields({ voice: string(128) }), fields({ enabled: boolean, model: string(128), voice: string(128) })),
  ],
  [
    REALTIME_VOICE_ROUTES.settings,
    adminRoute(fields({ enabled: boolean }), fields({ enabled: boolean, model: string(128), voice: string(128) })),
  ],
  [
    REALTIME_VOICE_ROUTES.status,
    adminRoute(empty, fields({ enabled: boolean, model: string(128), voice: string(128) })),
  ],
  [
    REALTIME_VOICE_ROUTES.connect,
    adminRoute(
      fields({ agentId: identifier, sdp: string(65_536) }),
      fields({ sdp: string(65_536) }, { sessionId: identifier }),
    ),
  ],
  [
    REALTIME_VOICE_ROUTES.poll,
    adminRoute(
      fields({ agentId: identifier, sessionId: identifier }),
      fields({ active: boolean, delegation: nullable(fields({ id: identifier, request: string(16_000) })) }),
    ),
  ],
  [
    REALTIME_VOICE_ROUTES.reply,
    adminRoute(
      fields({ agentId: identifier, sessionId: identifier, delegationId: identifier, text: nullable(string(16_000)) }),
      empty,
    ),
  ],
  [REALTIME_VOICE_ROUTES.end, adminRoute(fields({ agentId: identifier, sessionId: identifier }), empty)],
]);
