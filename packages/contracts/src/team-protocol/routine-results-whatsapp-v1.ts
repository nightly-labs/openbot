import { boolean, fields, identifier, list, nullable, oneOf, string } from "./admin-wire";
import { ROUTINE_RESULTS_ROUTES } from "./routine-results-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const ROUTINE_RESULTS_WHATSAPP_CAPABILITY = "routine-results-whatsapp-v1";

export const ROUTINE_RESULTS_WHATSAPP_PLATFORMS = ["slack", "discord", "telegram", "whatsapp"] as const;

const name = string(256);
const platform = oneOf(...ROUTINE_RESULTS_WHATSAPP_PLATFORMS);
const connection = fields({
  connectionId: identifier,
  platform,
  connectionName: name,
  places: list(fields({ id: identifier, name }), 10_000),
  placesFailed: boolean,
});
const answer = fields({
  destination: nullable(
    fields({ connectionId: identifier, platform, connectionName: name, placeId: identifier, placeName: name }),
  ),
});

const RESPONSES: ReadonlyMap<string, (value: unknown) => TeamProtocolV2Json> = new Map([
  [ROUTINE_RESULTS_ROUTES.options, fields({ connections: list(connection, 32) })],
  [ROUTINE_RESULTS_ROUTES.destination, answer],
  [ROUTINE_RESULTS_ROUTES.setDestination, answer],
]);

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}

export function isRoutineResultsRoute(path: string): boolean {
  return RESPONSES.has(pathname(path));
}

export function routineResultsWhatsAppResponse(path: string, value: unknown): TeamProtocolV2Json {
  const decode = RESPONSES.get(pathname(path));
  if (!decode) throw new Error("Invalid admin route.");
  return decode(value);
}
