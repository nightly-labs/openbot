// The Slack workspaces where this computer's agents answer. Tokens only travel towards the host; no
// result carries one.

import type { MessagingService } from "../../backend/messaging/messaging-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseSetSlackEnabledInput, parseSetSlackRoutingInput, parseSlackWorkspaceInput } from "./messaging-inputs";

interface MessagingIpcDependencies {
  messaging: Pick<
    MessagingService,
    "slackOverview" | "connectSlackWorkspace" | "disconnectSlackWorkspace" | "reconnect" | "setEnabled" | "setRouting"
  >;
}

export function messagingIpcHandlers({ messaging }: MessagingIpcDependencies): Pick<IpcGroupHandlers, "messaging"> {
  return {
    messaging: {
      getSlackOverview: handler(() => messaging.slackOverview()),
      connectSlackWorkspace: handler(() => messaging.connectSlackWorkspace()),
      disconnectSlackWorkspace: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        messaging.disconnectSlackWorkspace(workspaceId),
      ),
      reconnectSlackWorkspace: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        messaging.reconnect(workspaceId),
      ),
      setSlackEnabled: payloadHandler(parseSetSlackEnabledInput, ({ workspaceId, enabled }) =>
        messaging.setEnabled(workspaceId, enabled),
      ),
      setSlackRouting: payloadHandler(parseSetSlackRoutingInput, (input) => messaging.setRouting(input)),
    },
  };
}
