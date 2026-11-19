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

export const ROUTINE_RESULTS_PLATFORMS = ["slack", "discord", "telegram"] as const;
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
