// Frozen optional host-personality-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any member of a server can
// read the server personality, because each client needs it to show the server's agent chats. Only an
// owner or admin can set it; `requireAdmin` on the host is the only gate for the update route. The
// personality has one field now, `responseStyle`: `natural` (agents write a short update when a
// finding changes the plan or before a long step, and a chat shows each update as a message) or
// `classic` (no updates between steps, and a chat keeps them in the steps). A change applies from the
// next turn of each agent; it does not change stored messages. A host that does not advertise this
// uses the classic prompt. A new field or style needs a second capability string.
import { adminRoute, empty, fields, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const HOST_PERSONALITY_CAPABILITY = "host-personality-v1";

export const HOST_PERSONALITY_ROUTES = {
  settings: "/v1/host/personality",
  update: "/v1/admin/host/personality/update",
} as const;

const responseStyle = oneOf("natural", "classic");
const snapshot = fields({ responseStyle });

export const HOST_PERSONALITY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_PERSONALITY_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_PERSONALITY_ROUTES.update, adminRoute(snapshot, snapshot)],
]);
