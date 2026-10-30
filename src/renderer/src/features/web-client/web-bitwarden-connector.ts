// The Bitwarden connection of the joined server in the browser client (`bitwarden-connector-v1`).
// The API key and the master password go to the host once, in the connect request; no answer carries
// them.

import { runTeamEffect } from "@openbot/team-client";
import { bitwardenConnectorRequest } from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { type BitwardenConnectorPort, polledBitwardenConnectorPort } from "../connectors/bitwarden-connector-port";

/** `request` throws when no server is connected. */
export function webBitwardenConnectorPort(request: () => TeamApiRequest): BitwardenConnectorPort {
  const run = (
    route: Parameters<typeof bitwardenConnectorRequest>[1],
    body?: Parameters<typeof bitwardenConnectorRequest>[2],
  ) =>
    runTeamEffect(
      Effect.suspend(() => bitwardenConnectorRequest(request(), route, body)).pipe(
        Effect.mapError((error) => error.cause),
      ),
    );
  return polledBitwardenConnectorPort({
    status: () => run("status"),
    connectHost: (input) => run("connect", input),
    disconnect: () => run("disconnect"),
  });
}
