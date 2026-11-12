import { createEffect, untrack } from "solid-js";
import { useNavigation } from "../../navigation";
import { useAuth } from "../account/account-context";
import { useServerSelection } from "../servers/server-selection";
import { useServers } from "../servers/servers-context";
import { useAgents } from "./agents-context";
import { finishStartupAgentChat, pendingStartupAgentChat } from "./startup-agent-chat-preference";

/**
 * The server switch of this launch. It is at module level because the switch disposes the scope
 * that started it, and the scope that it opens must not start it again.
 */
let startupSwitch: "none" | "running" | "done" = "none";

/**
 * Opens the agent chat that General settings chose for the start of the app. It goes to the
 * server of the chat first. When the server or the agent is gone, the window keeps the chat that
 * it restored. Mount it only in the main window.
 */
export function StartupAgentChat() {
  const { centralAuth } = useAuth();
  const { servers, serversLoaded, activeServerId } = useServers();
  const { selectServer } = useServerSelection();
  const { agentList, agentListSettled } = useAgents();
  const { selectAgent } = useNavigation();

  createEffect(
    () => {
      // The saved channel opens when the account is known, so the chat opens after that.
      if (!serversLoaded() || centralAuth().status === "loading") return null;
      const target = pendingStartupAgentChat();
      if (!target) return null;
      return { target, serverId: activeServerId(), settled: agentListSettled() };
    },
    (state) =>
      untrack(() => {
        if (!state) return;
        const { target } = state;
        if (target.serverId !== state.serverId) {
          if (startupSwitch === "running") return;
          if (startupSwitch === "done" || !servers().some((server) => server.id === target.serverId)) {
            finishStartupAgentChat();
            return;
          }
          startupSwitch = "running";
          void selectServer(target.serverId, false).then(
            (selected) => {
              startupSwitch = "done";
              if (!selected) finishStartupAgentChat();
            },
            () => {
              startupSwitch = "done";
              finishStartupAgentChat();
            },
          );
          return;
        }
        // A later switch to another server, before the roster settles, is the user's: it cancels the chat.
        startupSwitch = "done";
        if (!state.settled) return;
        finishStartupAgentChat();
        if (agentList().some((agent) => agent.id === target.agentId)) selectAgent(target.agentId);
      }),
  );

  return null;
}
