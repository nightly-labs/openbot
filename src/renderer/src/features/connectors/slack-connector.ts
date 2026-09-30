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
  reconnect: (workspaceId: string) => void;
  setEnabled: (workspaceId: string, enabled: boolean) => void;
  setRouting: (workspaceId: string, routerAgentId: string | null, agentIds: string[]) => void;
}

/**
 * The Slack workspaces of this computer, for Server settings > Connectors. Main sends no event for a
 * connection, and the install ends in the browser, so a page that shows the state calls `watch`.
 */
export function createSlackConnector(port: () => SlackConnectorPort = slackConnectorPort): SlackConnectorController {
  const [overview, setOverview] = createSignal<SlackOverview | null>(null);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;

  // A failed read keeps the last overview. The next poll or action reads again.
  const reload = () => {
    const read = ++reads;
    void port()
      .messaging.getSlackOverview()
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
    disconnectWorkspace: (workspaceId) => run(() => messaging().disconnectSlackWorkspace({ workspaceId })),
    reconnect: (workspaceId) => run(() => messaging().reconnectSlackWorkspace({ workspaceId })),
    setEnabled: (workspaceId, enabled) => run(() => messaging().setSlackEnabled({ workspaceId, enabled })),
    setRouting: (workspaceId, routerAgentId, agentIds) =>
      run(() => messaging().setSlackRouting({ workspaceId, routerAgentId, agentIds })),
  };
}
