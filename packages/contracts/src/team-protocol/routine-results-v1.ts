// Frozen optional routine-results-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server reads the host's enabled messaging connections with the places each one can post in, and
// reads and sets the place where an agent routine of that host sends its answers. `destination: null`
// stops sending. The host takes the connection's name and platform from its own connection, and
// refuses a connection that is off or removed. The host leaves out a connection of a platform that
// this contract does not name, and sends at most `ROUTINE_RESULTS_PLACE_LIMIT` places of one
// connection. A destination applies only to the runs that end after it was set. The deliveries of
// each answer and a second send stay on the host's own computer. A member cannot use any route;
// `requireAdmin` on the host is the only gate. Widening any of it needs a second capability string.
import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const ROUTINE_RESULTS_CAPABILITY = "routine-results-v1";

export const ROUTINE_RESULTS_ROUTES = {
  options: "/v1/admin/routine-results/options",
  destination: "/v1/admin/routine-results/destination",
  setDestination: "/v1/admin/routine-results/destination/update",
} as const;

/** The platforms this contract names. A host leaves out a connection of any other platform. */
export const ROUTINE_RESULTS_PLATFORMS = ["slack", "discord", "telegram"] as const;
/** The most places of one connection; the host sends the first ones. */
export const ROUTINE_RESULTS_PLACE_LIMIT = 10_000;

const name = string(256);
const platform = oneOf(...ROUTINE_RESULTS_PLATFORMS);
const place = fields({ id: identifier, name });
const connection = fields({
  connectionId: identifier,
  platform,
  connectionName: name,
  places: list(place, ROUTINE_RESULTS_PLACE_LIMIT),
  placesFailed: boolean,
});
const destination = fields({
  connectionId: identifier,
  platform,
  connectionName: name,
  placeId: identifier,
  placeName: name,
});
const routine = { agentId: identifier, routineId: identifier };
const answer = fields({ destination: nullable(destination) });

export const ROUTINE_RESULTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ROUTINE_RESULTS_ROUTES.options, adminRoute(empty, fields({ connections: list(connection, 32) }))],
  [ROUTINE_RESULTS_ROUTES.destination, adminRoute(fields(routine), answer)],
  [
    ROUTINE_RESULTS_ROUTES.setDestination,
    adminRoute(
      fields({
        ...routine,
        destination: nullable(fields({ connectionId: identifier, placeId: identifier, placeName: name })),
      }),
      answer,
    ),
  ],
]);
