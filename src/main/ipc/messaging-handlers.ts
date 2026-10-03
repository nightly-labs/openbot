import { Effect } from "effect";
// The Slack workspaces where this computer's agents answer. Tokens only travel towards the host; no
// result carries one.

import type { MessagingService } from "../../backend/messaging/messaging-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseAddSlackOrchestratorInput,
  parseSetSlackEnabledInput,
  parseSlackWorkspaceInput,
} from "./messaging-inputs";

interface MessagingIpcDependencies {
  messaging: Pick<
    MessagingService,
    | "slackOverview"
    | "connectSlackWorkspace"
    | "disconnectSlackWorkspace"
    | "reconnect"
    | "setEnabled"
    | "addOrchestrator"
  >;
}

export function messagingIpcHandlers({ messaging }: MessagingIpcDependencies): Pick<IpcGroupHandlers, "messaging"> {
  return {
    messaging: {
      getSlackOverview: handler(() => messaging.slackOverview()),
      connectSlackWorkspace: handler(() =>
        Effect.runPromise(messaging.connectSlackWorkspace().pipe(Effect.mapError((error) => error.cause))),
      ),
      disconnectSlackWorkspace: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        Effect.runPromise(
          messaging.disconnectSlackWorkspace(workspaceId).pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      reconnectSlackWorkspace: payloadHandler(parseSlackWorkspaceInput, ({ workspaceId }) =>
        Effect.runPromise(messaging.reconnect(workspaceId).pipe(Effect.mapError((error) => error.cause))),
      ),
      setSlackEnabled: payloadHandler(parseSetSlackEnabledInput, ({ workspaceId, enabled }) =>
        Effect.runPromise(messaging.setEnabled(workspaceId, enabled).pipe(Effect.mapError((error) => error.cause))),
      ),
      addSlackOrchestrator: payloadHandler(parseAddSlackOrchestratorInput, (input) =>
        Effect.runPromise(messaging.addOrchestrator(input).pipe(Effect.mapError((error) => error.cause))),
      ),
    },
  };
}
