import type { DynamicIslandAction } from "@openbot/contracts/ipc";
import { createEffect, onSettled } from "solid-js";
import { withoutAgent } from "../../app-message-projection";
import { toast } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { useAgents } from "../agents/agents-context";
import { useConversation } from "../conversation/conversation-context";
import { promptRequestKey } from "../conversation/conversation-keys";
import { useServerScope } from "../servers/server-scope";
import { useServerSelection } from "../servers/server-selection";
import { useServerSwitch } from "../servers/server-switch";
import { useServers } from "../servers/servers-context";
import { useDynamicIsland } from "./dynamic-island-context";

/**
 * Island bridge for the visible server: projects workspace state out to main and handles
 * actions coming back. Split from `dynamic-island.tsx` (which owns the coordinator above the
 * per-server domains) so the coordinator survives a server switch while the projection stays
 * scoped to the active server. See docs/ARCHITECTURE.md.
 *
 * Projection waits for scope `loaded()` to avoid publishing a new server id next to a
 * half-filled workspace. Cross-server actions republish through `server-switch.tsx` because
 * the switch disposes this bridge; prompt answers and approval responses resolve directly
 * against the coordinator so the island reflects before the renderer catches up.
 */
export function DynamicIslandBridge() {
  const platform = usePlatform();
  const { activeServerId } = useServers();
  const { dynamicIslandCoordinator, publishDynamicIslandPresentation } = useDynamicIsland();
  const { selectServer } = useServerSelection();
  const { loaded } = useServerScope();
  const { pendingIslandAction, setPendingIslandAction } = useServerSwitch();
  const { agentList, appendUiError } = useAgents();
  const {
    activeTurns,
    queues,
    pendingPrompts,
    setPendingPrompts,
    setSubmittedPromptRequests,
    pendingApprovals,
    setPendingApprovals,
    failedTurns,
    setFailedTurns,
  } = useTurns();
  const { unreadReplies, conversations } = useConversation();
  const { selectAgent, openAgentMessage } = useNavigation();
  /** The handoff this bridge published, so it never consumes or clears its own. */
  let publishedAction: DynamicIslandAction | null = null;

  createEffect(
    () => {
      if (platform.landingPreview || !loaded()) return null;
      return {
        serverId: activeServerId(),
        agents: agentList(),
        activeTurns: activeTurns(),
        queues: queues(),
        unreadReplies: unreadReplies(),
        unreadMessageIds: Object.fromEntries(
          Object.entries(conversations).map(([agentId, conversation]) => [
            agentId,
            conversation.read?.firstUnreadMessageId ?? null,
          ]),
        ),
        liveMessages: Object.fromEntries(
          Object.entries(conversations).map(([id, conversation]) => [id, conversation.messages]),
        ),
        pendingPrompts: pendingPrompts(),
        pendingApprovals: pendingApprovals(),
        failedTurns: failedTurns(),
      };
    },
    (input) => {
      if (!input) return;
      dynamicIslandCoordinator.replaceServer(input);
      publishDynamicIslandPresentation();
    },
  );

  createEffect(
    () => ({ action: pendingIslandAction(), ready: loaded() }),
    ({ action, ready }) => {
      if (!action) return;
      // The bridge that published the handoff is still mounted when the signal
      // changes; consuming or clearing it here would drop the intent before the
      // switch lands.
      if (action === publishedAction) return;
      if (activeServerId() !== action.serverId) {
        // Another server landed instead - the selection was superseded, or the
        // user moved on. The intent named a server that is no longer coming.
        setPendingIslandAction(null);
        return;
      }
      // The action opens a message or a failure inside this workspace, so it has
      // to wait for the workspace. Acting on a half-loaded scope reads an agent list
      // and a conversation window that are still empty.
      if (!ready) return;
      setPendingIslandAction(null);
      void handleDynamicIslandAction(action).catch(() => undefined);
    },
  );

  onSettled(() => {
    if (platform.landingPreview) return;
    return window.openbot.dynamicIsland.onAction((action) => {
      void handleDynamicIslandAction(action).catch((error) => {
        toast.error("Could not open this remote item", {
          description: errorMessage(error, "Could not open this item. Try again."),
        });
      });
    });
  });

  async function handleDynamicIslandAction(action: DynamicIslandAction): Promise<void> {
    if (action.type === "open-app") return;
    if (action.type === "answer-prompt") {
      dynamicIslandCoordinator.resolveAction(action);
      const prompt = pendingPrompts()[action.agentId];
      if (prompt?.type === "prompt" && String(prompt.requestId) === String(action.requestId)) {
        setPendingPrompts((current) => ({ ...current, [action.agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({
          ...current,
          [action.agentId]: promptRequestKey(prompt.turnId, prompt.requestId) ?? undefined,
        }));
      }
      publishDynamicIslandPresentation();
      return;
    }
    if (action.type === "respond-approval") {
      dynamicIslandCoordinator.resolveAction(action);
      setPendingApprovals((current) => {
        const approval = current[action.agentId];
        return approval && String(approval.requestId) === String(action.requestId)
          ? { ...current, [action.agentId]: undefined }
          : current;
      });
      publishDynamicIslandPresentation();
      return;
    }
    if (activeServerId() !== action.serverId) {
      // The switch replaces this bridge along with the rest of the scope, so the
      // action is handed to the one that lands rather than finished here against
      // domains that are about to be disposed.
      publishedAction = action;
      setPendingIslandAction(action);
      // A newer action may have replaced this one while the selection was in
      // flight, and being superseded is exactly why that selection returns
      // false. Clearing unconditionally would delete the newer intent before
      // its own switch lands.
      if (!(await selectServer(action.serverId, false)) && pendingIslandAction() === action) {
        setPendingIslandAction(null);
      }
      return;
    }
    if (!loaded()) {
      // The right workspace, but it has not filled yet. `selectAgent` against an
      // empty agent list and a read against an empty conversation are the same
      // half-loaded scope the handoff effect above already waits out, so this
      // action joins it there. Nothing disposes this bridge in the meantime, so
      // it is the one that consumes its own entry once `loaded()` turns true -
      // which is why `publishedAction` stays untouched.
      setPendingIslandAction(action);
      return;
    }
    selectAgent(action.agentId);
    if (action.type === "open-message") await openAgentMessage(action.agentId, action.messageId);
    if (action.type === "open-failure") {
      try {
        await window.openbot.agent.acknowledgeFailedTurn({ agentId: action.agentId, turnId: action.turnId });
      } catch (error) {
        appendUiError(action.agentId, error, "Acknowledge failed", action.serverId);
        return;
      }
      setFailedTurns((current) =>
        current[action.agentId] === action.turnId ? withoutAgent(current, action.agentId) : current,
      );
      dynamicIslandCoordinator.resolveAction(action);
      publishDynamicIslandPresentation();
    }
  }

  return null;
}
