// Frozen optional routine-results-whatsapp-v1 contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: when a client sends it, the
// answers of the three `routine-results-v1` routes can name the platform `whatsapp`, so an owner or
// admin of a server sees the host's WhatsApp numbers and their places, and an agent routine can send
// its answers to one. Each answer keeps the frozen shape and bounds of `routine-results-v1`. Requests
// do not change. A client that does not send it gets no WhatsApp connection in the options, and
// `destination: null` for a WhatsApp destination. A client that reads these options for its workflow
// places gets the WhatsApp places too. A host serves it only with `routine-results-v1`. A protocol 10
// capability only. Widening any of it needs a second capability string.
import { boolean, fields, identifier, list, nullable, oneOf, string } from "./admin-wire";
import { ROUTINE_RESULTS_ROUTES } from "./routine-results-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const ROUTINE_RESULTS_WHATSAPP_CAPABILITY = "routine-results-whatsapp-v1";

/** The platforms of `routine-results-v1` and WhatsApp. */
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

/** The `routine-results-v1` routes whose successful answers this contract widens. */
export function isRoutineResultsRoute(path: string): boolean {
  return RESPONSES.has(pathname(path));
}

/** A successful answer of an `isRoutineResultsRoute` route, where a platform can be `whatsapp`. */
export function routineResultsWhatsAppResponse(path: string, value: unknown): TeamProtocolV2Json {
  const decode = RESPONSES.get(pathname(path));
  if (!decode) throw new Error("Invalid admin route.");
  return decode(value);
}
