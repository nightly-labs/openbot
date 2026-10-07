import type { MessagingOverview } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { SlackOrchestratorModels } from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { type DiscordConnectorPort, discordConnectorPort } from "./discord-connector-port";
import type { SlackConnectorController } from "./slack-connector";

/** How often the Discord page reads the connections while it shows: a connection changes on its own. */
const POLL_MS = 3_000;

/** The Discord page has the same controls as the Slack page. A workspace is a Discord server (a guild). */
export type DiscordConnectorController = SlackConnectorController;

/**
 * The Discord servers of this computer, for Server settings > Connectors. Main sends no event for a
 * connection, and the authorization ends in the browser, so a page that shows the state calls `watch`.
 */
export function createDiscordConnector(
  port: () => DiscordConnectorPort = discordConnectorPort,
  models: () => SlackOrchestratorModels | undefined = () => undefined,
  /** Called with the sidebar section that main put the new orchestrator in. */
  onOrchestratorSection: (sectionId: string) => void = () => undefined,
): DiscordConnectorController {
  const [overview, setOverview] = createSignal<MessagingOverview | null>(null);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;

  // A failed read keeps the last overview. The next poll or action reads again.
  const reload = () => {
    const read = ++reads;
    void port()
      .messaging.getDiscordOverview()
      .then((next) => {
        if (!disposed && read === reads) setOverview(next);
      })
      .catch(() => undefined);
  };
  onCleanup(() => {
    disposed = true;
  });

  const run = (action: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    void action()
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(t("connector.discord.actionFailed"), {
          ...{
            description: errorMessage(error, t("connector.discord.actionFailed")),
          },
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
      })
      .finally(() => {
        if (disposed) return;
        setBusy(false);
        reload();
      });
  };
  const messaging = () => port().messaging;

  return {
    overview,
    busy,
    watch: () => {
      reload();
      const timer = setInterval(reload, POLL_MS);
      return () => clearInterval(timer);
    },
    connectWorkspace: () => run(() => messaging().connectDiscordGuild()),
    disconnectWorkspace: (workspaceId) => run(() => messaging().disconnectDiscordGuild({ workspaceId })),
    reconnect: (workspaceId) => run(() => messaging().reconnectDiscordGuild({ workspaceId })),
    setEnabled: (workspaceId, enabled) => run(() => messaging().setDiscordEnabled({ workspaceId, enabled })),
    models,
    addOrchestrator: (workspaceId, choice) =>
      run(async () => {
        const { sectionId } = await messaging().addDiscordOrchestrator({ workspaceId, ...(choice ?? {}) });
        if (sectionId) onOrchestratorSection(sectionId);
      }),
  };
}
