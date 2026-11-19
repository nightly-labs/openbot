import { runTeamEffect } from "@openbot/team-client";
import { onePasswordConnectorRequest } from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import {
  type OnePasswordConnectorPort,
  polledOnePasswordConnectorPort,
} from "../connectors/onepassword-connector-port";

export function webOnePasswordConnectorPort(request: () => TeamApiRequest): OnePasswordConnectorPort {
  const run = (
    route: Parameters<typeof onePasswordConnectorRequest>[1],
    body?: Parameters<typeof onePasswordConnectorRequest>[2],
  ) =>
    runTeamEffect(
      Effect.suspend(() => onePasswordConnectorRequest(request(), route, body)).pipe(
        Effect.mapError((error) => error.cause),
      ),
    );
  return polledOnePasswordConnectorPort({
    status: () => run("status"),
    connectWithToken: (token) => run("connect", { token: token.trim() }),
    disconnect: () => run("disconnect"),
  });
}
