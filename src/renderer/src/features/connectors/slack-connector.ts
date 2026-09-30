import type { SlackOverview } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import { type SlackConnectorPort, slackConnectorPort } from "./slack-connector-port";

/** How often the Slack page reads the connections while it shows: a connection changes on its own. */
const POLL_MS = 3_000;

export interface SlackConnectorController {
  /** Null until the first read. */
  overview: () => SlackOverview | null;
  busy: () => boolean;
  /** Reads the connections now and then every few seconds. Call the result to stop. */
  watch: () => () => void;
  connectWorkspace: () => void;
  disconnectWorkspace: (workspaceId: string) => void;
  createApp: (agentId: string, workspaceId: string) => void;
  openInstall: (agentId: string) => void;
  reconnect: (agentId: string) => void;
  setEnabled: (agentId: string, enabled: boolean) => void;
  remove: (agentId: string) => void;
}

/**
 * The Slack apps of this computer's agents, for Server settings > Connectors. `serverId` is the
 * local server, which the agent calls name. Main sends no event for a connection, and the workspace
 * and install steps end in the browser, so a page that shows the state calls `watch`.
 *
 * Each app's icon follows its agent's avatar: it is drawn once for each agent while this controller
 * lives, and main sends it to Slack only when it changed. A failure leaves Slack's default icon.
 */
export function createSlackConnector(
  serverId: () => string,
  port: () => SlackConnectorPort = slackConnectorPort,
): SlackConnectorController {
  const [overview, setOverview] = createSignal<SlackOverview | null>(null);
  const [busy, setBusy] = createSignal(false);
  const iconsSent = new Set<string>();
  let disposed = false;
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;

  const syncIcons = (next: SlackOverview) => {
    for (const connection of next.connections) {
      // A removed app is sent its icon again when the agent is added back.
      if (connection.credentials !== "saved") iconsSent.delete(connection.agentId);
      if (connection.credentials !== "saved" || iconsSent.has(connection.agentId)) continue;
      iconsSent.add(connection.agentId);
      const { agentId } = connection;
      void port()
        .slackIcon(agentId)
        .then((bytes) =>
          port().messaging.setSlackIcon({ agentId, image: { mimeType: "image/png", bytes } }, serverId()),
        )
        .catch(() => undefined);
    }
  };
  // A failed read keeps the last overview. The next poll or action reads again.
  const reload = () => {
    const read = ++reads;
    void port()
      .messaging.getSlackOverview()
      .then((next) => {
        if (disposed || read !== reads) return;
        setOverview(next);
        syncIcons(next);
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
        toast.error(t("connector.slack.actionFailed"), {
          description: errorMessage(error, t("connector.slack.actionFailed")),
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
    connectWorkspace: () => run(() => messaging().connectSlackWorkspace()),
    disconnectWorkspace: (workspaceId) => run(() => messaging().disconnectSlackWorkspace({ workspaceId }, serverId())),
    createApp: (agentId, workspaceId) => run(() => messaging().createSlackApp({ agentId, workspaceId }, serverId())),
    openInstall: (agentId) => run(() => messaging().openSlackInstall({ agentId }, serverId())),
    reconnect: (agentId) => run(() => messaging().reconnect({ agentId }, serverId())),
    setEnabled: (agentId, enabled) => run(() => messaging().setEnabled({ agentId, enabled }, serverId())),
    remove: (agentId) => run(() => messaging().disconnect({ agentId }, serverId())),
  };
}
