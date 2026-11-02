// The WhatsApp account connection of the joined server in the browser client
// (`whatsapp-account-connector-v1`). The host runs the link and keeps the keys of the linked device.
// The phone number of a link with a code goes to the host once, in a submit request; no answer
// carries it.

import { runTeamEffect } from "@openbot/team-client";
import { whatsappAccountConnectorRequest } from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import {
  polledWhatsAppAccountConnectorPort,
  type WhatsAppAccountConnectorPort,
} from "../connectors/whatsapp-account-connector-port";

/** `request` throws when no server is connected. */
export function webWhatsAppAccountConnectorPort(request: () => TeamApiRequest): WhatsAppAccountConnectorPort {
  const run = <Route extends Parameters<typeof whatsappAccountConnectorRequest>[1]>(
    route: Route,
    body: Parameters<typeof whatsappAccountConnectorRequest<Route>>[2],
  ) =>
    runTeamEffect(
      Effect.suspend(() => whatsappAccountConnectorRequest(request(), route, body)).pipe(
        Effect.mapError((error) => error.cause),
      ),
    );
  return polledWhatsAppAccountConnectorPort({
    status: () => run("status", {}),
    connect: (input) => run("connect", input),
    submit: (input) => run("submit", input),
    cancel: () => run("cancel", {}),
    disconnect: () => run("disconnect", {}),
    setSending: (enabled) => run("setSending", { enabled }),
  });
}
