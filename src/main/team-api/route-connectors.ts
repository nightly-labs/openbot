import { CONNECTOR_MESSAGING_PLATFORMS, type MessagingConnectPage } from "@openbot/contracts/ipc";
import { CONNECTORS_CAPABILITY, CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiConnectors } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const ROUTES: ReadonlySet<string> = new Set(Object.values(CONNECTORS_ROUTES));

const page = (opened: MessagingConnectPage | null) => ({ url: opened?.url ?? null, nonce: opened?.nonce ?? null });

/**
 * The connections of this host that an administrator manages from their own computer. Frozen by
 * `connectors-v1`.
 *
 * A connect or a disconnect opens no page on this host: the client opens GitHub's, Slack's, Discord's
 * or Telegram's page in the user's own browser. No answer carries a token. `requireAdmin` runs on
 * every route.
 */
export async function routeConnectors(
  context: TeamApiRequestContext,
  connectors: TeamApiConnectors | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!connectors || !capabilities.has(CONNECTORS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `connectors-v1` codec.
  const body = await readJson(request);
  const { github, messaging } = connectors;
  const status = (current: ReturnType<typeof github.status>) => ({ ...current, ...github.pages() });
  // The codec allows only these values; a GitHub route has no platform.
  // WhatsApp is not one of them: a number is managed only on its host.
  const platform = CONNECTOR_MESSAGING_PLATFORMS.find((id) => id === body.platform) ?? "telegram";
  const workspaceId = () => stringField(body, "workspaceId", false, 128);
  switch (url.pathname) {
    case CONNECTORS_ROUTES.githubStatus:
      return json(200, status(github.status()));
    case CONNECTORS_ROUTES.githubConnect:
      return json(200, status(await runCauseEffect(github.connect(false))));
    case CONNECTORS_ROUTES.githubCancel:
      return json(200, status(github.cancel()));
    case CONNECTORS_ROUTES.githubDisconnect:
      return json(200, status(await runCauseEffect(github.disconnect(false))));
    case CONNECTORS_ROUTES.githubRepositories:
      return json(200, await runCauseEffect(github.repositories()));
    case CONNECTORS_ROUTES.messagingOverview:
      return json(
        200,
        platform === "slack"
          ? messaging.slackOverview()
          : platform === "discord"
            ? messaging.discordOverview()
            : messaging.telegramOverview(),
      );
    case CONNECTORS_ROUTES.messagingConnect: {
      const opened =
        platform === "slack"
          ? messaging.connectSlackWorkspace(false)
          : platform === "discord"
            ? messaging.connectDiscordGuild(false)
            : messaging.connectTelegramChat(body.place === "direct" ? "direct" : "group", false);
      return json(200, page(await runCauseEffect(opened)));
    }
    case CONNECTORS_ROUTES.messagingComplete: {
      const nonce = stringField(body, "nonce", false, 128);
      const grant = stringField(body, "grant", false, 16_384);
      const accepted = await runCauseEffect(
        platform === "slack"
          ? messaging.completeSlackWorkspace(nonce, grant)
          : messaging.completeDiscordGuild(nonce, grant),
      );
      return json(200, { accepted });
    }
    case CONNECTORS_ROUTES.messagingDisconnect:
      await runCauseEffect(
        platform === "slack"
          ? messaging.disconnectSlackWorkspace(workspaceId())
          : platform === "discord"
            ? messaging.disconnectDiscordGuild(workspaceId())
            : messaging.disconnectTelegramChat(workspaceId()),
      );
      return json(200, {});
    case CONNECTORS_ROUTES.messagingReconnect:
      return json(200, page(await runCauseEffect(messaging.reconnect(platform, workspaceId(), false))));
    case CONNECTORS_ROUTES.messagingEnabled:
      await runCauseEffect(messaging.setEnabled(platform, workspaceId(), body.enabled === true));
      return json(200, {});
    default: {
      // The orchestrator starts on a new agent's default provider and model, as the host picks it.
      const added =
        platform === "telegram" || body.workspaceId === null
          ? messaging.addTelegramOrchestrator({})
          : messaging.addOrchestrator(platform, { workspaceId: workspaceId() });
      return json(200, await runCauseEffect(added));
    }
  }
}
