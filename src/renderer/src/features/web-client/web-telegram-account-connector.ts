// The Telegram account connection of the joined server in the browser client
// (`telegram-account-connector-v1`). The host runs the sign-in and keeps the session. The phone number,
// the code and the two-step password go to the host once each, in a submit request; no answer carries
// them.

import { runTeamEffect } from "@openbot/team-client";
import { telegramAccountConnectorRequest } from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import {
  polledTelegramAccountConnectorPort,
  TELEGRAM_APPS_URL,
  type TelegramAccountConnectorPort,
} from "../connectors/telegram-account-connector-port";

/** `request` throws when no server is connected. */
export function webTelegramAccountConnectorPort(request: () => TeamApiRequest): TelegramAccountConnectorPort {
  const run = <Route extends Parameters<typeof telegramAccountConnectorRequest>[1]>(
    route: Route,
    body: Parameters<typeof telegramAccountConnectorRequest<Route>>[2],
  ) =>
    runTeamEffect(
      Effect.suspend(() => telegramAccountConnectorRequest(request(), route, body)).pipe(
        Effect.mapError((error) => error.cause),
      ),
    );
  return polledTelegramAccountConnectorPort(
    {
      status: () => run("status", {}),
      connect: (input) => run("connect", input),
      submit: (input) => run("submit", input),
      cancel: () => run("cancel", {}),
      disconnect: () => run("disconnect", {}),
      setSending: (enabled) => run("setSending", { enabled }),
    },
    async () => {
      window.open(TELEGRAM_APPS_URL, "_blank", "noopener,noreferrer");
    },
  );
}
