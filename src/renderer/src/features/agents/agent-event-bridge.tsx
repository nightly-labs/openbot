import type { AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { classifyUserError } from "@openbot/user-errors";
import { flush, onSettled } from "solid-js";
import { withoutAgent } from "../../app-message-projection";
import { playCompletionSoundForAgentEvent } from "../../completion-sound";
import { toast } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { queueAfterTurnCompleted } from "../../queue-reconciliation";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useChannels } from "../channels/channels-context";
import { useConversation } from "../conversation/conversation-context";
import { agentConversationKey, promptRequestKey } from "../conversation/conversation-keys";
import { latestIncomingConversationMessage } from "../conversation/conversation-read-state";
import { reconcileQueuesWithRuntimeWork } from "../dynamic-island/dynamic-island-coordinator";
import { useServers } from "../servers/servers-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { cleanAgentMessageText } from "./agent-message-text";
import { reconcileAttentionApprovals, reconcileAttentionPrompts } from "./agent-runtime-snapshot";
import { useAgents } from "./agents-context";

/** A provider quotes what it was given, so an error can carry a whole request body back. */
const ERROR_TOAST_DESCRIPTION_LIMIT = 300;

function errorToastDescription(message: string): string {
  const readable = errorMessage(message, "The agent could not continue. Try again.");
  if (readable.length <= ERROR_TOAST_DESCRIPTION_LIMIT) return readable;
  return `${readable.slice(0, ERROR_TOAST_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

/**
 * The one subscriber to `agent.onEvent`, and the only place a single event is
 * allowed to write to several domains at once.
 *
 * A component rather than a context because it publishes nothing: it is a
 * write-only edge from main into agents, conversation, turns, browser tabs,
 * sidebar, providers and auth. Everything depends on those domains; nothing
 * depends on this, so the import edge only ever points down and the cycle rule
 * is satisfied by construction.
 *
 * It renders `null` and must stay renderable with no view above it - the
 * harnesses in `App.test.tsx` and `App.read-state.test.tsx` mount the providers
 * with no `AppView` at all, and that is how they drive the app: emit an event,
 * assert the state it produced.
 *
 * Conversation invalidations also cover read cursors changed on another device.
 */
export function AgentEventBridge() {
  const channels = useChannels();
  const platform = usePlatform();
  const { activeServerId } = useServers();
  const { invalidateAccountUsage, applyPushedAccountUsage } = useAuth();
  const { applyAgentStatus, refreshAgentProviders } = useProviders();
  const { activeAgent, agentList, setModelOptions, explicitlyOpenedAgentChatId, applyStoredAgents, appendUiError } =
    useAgents();
  const {
    applyRuntimeMessages,
    conversations,
    applyConversationReads,
    agentChatsToRetryRead,
    scheduleConversation,
    isAgentChatReadable,
    autoMarkAgentMessageRead,
    applyConversationDelta,
    applyConversationPage,
    markReplyCompleted,
    clearRecentReply,
  } = useConversation();
  const {
    setActiveTurns,
    setTurnProgress,
    setFailedTurns,
    setQueues,
    setPendingPrompts,
    setPresentedPromptResolutions,
    submittedPromptRequests,
    setSubmittedPromptRequests,
    setPendingApprovals,
    completedTurnByAgent,
    queueSnapshotRequests,
    refreshRoutineIds,
  } = useTurns();
  const { setBrowserControlState, applyBrowserChange } = useBrowserTabs();
  const { setSidebarLayout } = useSidebar();
  let readRefresh = 0;

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "status":
        applyAgentStatus(event.status);
        if (event.status.phase === "ready") {
          void window.openbot.agent
            .listModels()
            .then(setModelOptions)
            .catch(() => undefined);
        }
        return;
      case "usage-changed": {
        // The runtime reads the plan windows for the agent it runs, which is the active one, the
        // same way it reports one `status`. Keeping the payload is what lets the composer say the
        // limit is spent without a second request for what main has already sent.
        const agentId = activeAgent()?.id;
        if (agentId) applyPushedAccountUsage(agentId, event.usage);
        invalidateAccountUsage();
        return;
      }
      case "agents-changed":
        applyStoredAgents(event.agents);
        return;
      case "sidebar-layout-changed":
        setSidebarLayout(event.layout);
        return;
      case "conversation":
        scheduleConversation(event.snapshot);
        return;
      case "conversation-page":
        {
          const existingUnreadCount = conversations[event.page.agentId]?.read?.unreadCount ?? 0;
          const trackingKey = agentConversationKey(activeServerId(), event.page.agentId);
          const markNewMessagesRead =
            isAgentChatReadable(event.page.agentId) &&
            (event.page.readState === undefined || event.page.readState.unreadCount > 0) &&
            (existingUnreadCount === 0 ||
              explicitlyOpenedAgentChatId() === event.page.agentId ||
              agentChatsToRetryRead.has(trackingKey));
          const pageApplied = applyConversationPage(event.page, "latest", "latest");
          const latestIncomingMessage = markNewMessagesRead
            ? latestIncomingConversationMessage(event.page.messages)
            : undefined;
          if (pageApplied && latestIncomingMessage) {
            autoMarkAgentMessageRead(event.page.agentId, latestIncomingMessage.id, existingUnreadCount === 0);
          }
        }
        return;
      case "conversation-invalidated":
        {
          const request = ++readRefresh;
          const serverId = activeServerId();
          void window.openbot.agent
            .listConversationReads()
            .then((reads) => {
              if (request === readRefresh && serverId === activeServerId()) applyConversationReads(reads);
            })
            .catch(() => undefined);
        }
        return;
      case "conversation-delta":
        applyConversationDelta(event);
        return;
      case "turn-progress":
        setTurnProgress((current) => ({
          ...current,
          [event.agentId]: { turnId: event.turnId, detail: cleanAgentMessageText(event.detail) },
        }));
        return;
      case "queue-changed":
        queueSnapshotRequests.set(event.snapshot.agentId, (queueSnapshotRequests.get(event.snapshot.agentId) ?? 0) + 1);
        setQueues((current) => ({
          ...current,
          [event.snapshot.agentId]: event.snapshot,
        }));
        return;
      case "routines-changed":
        refreshRoutineIds(event.agentId, activeServerId());
        return;
      case "browser-changed":
        if (platform.landingPreview) return;
        applyBrowserChange(event.tabs, event.activeTabId);
        return;
      case "browser-control-changed":
        if (platform.landingPreview) return;
        setBrowserControlState(event.state);
        return;
      case "turn-started":
        completedTurnByAgent.delete(event.agentId);
        setTurnProgress((current) => withoutAgent(current, event.agentId));
        clearRecentReply(event.agentId);
        setFailedTurns((current) => withoutAgent(current, event.agentId));
        setActiveTurns((current) => ({
          ...current,
          [event.agentId]: event.turnId,
        }));
        return;
      case "turn-completed":
        completedTurnByAgent.set(event.agentId, event.turnId);
        setTurnProgress((current) =>
          current[event.agentId]?.turnId === event.turnId ? withoutAgent(current, event.agentId) : current,
        );
        setFailedTurns((current) =>
          event.status === "failed"
            ? { ...current, [event.agentId]: event.turnId }
            : withoutAgent(current, event.agentId),
        );
        setActiveTurns((current) => ({ ...current, [event.agentId]: null }));
        setQueues((current) => {
          const snapshot = current[event.agentId];
          if (!snapshot) return current;
          const next = queueAfterTurnCompleted(snapshot, event.turnId);
          return next === snapshot ? current : { ...current, [event.agentId]: next };
        });
        setPendingPrompts((current) => {
          const pending = current[event.agentId];
          const submittedRequestKey = submittedPromptRequests()[event.agentId];
          if (
            pending?.type === "prompt" &&
            promptRequestKey(pending.turnId, pending.requestId) === submittedRequestKey
          ) {
            return current;
          }
          return { ...current, [event.agentId]: undefined };
        });
        setPendingApprovals((current) => ({ ...current, [event.agentId]: undefined }));
        if (event.status === "completed") {
          markReplyCompleted(event.agentId);
          playCompletionSoundForAgentEvent(event, agentList());
        }
        return;
      case "prompt":
        setPendingPrompts((current) => ({ ...current, [event.agentId]: event }));
        setPresentedPromptResolutions((current) => ({ ...current, [event.agentId]: undefined }));
        setSubmittedPromptRequests((current) => ({ ...current, [event.agentId]: undefined }));
        return;
      case "agent-input-resolved":
        if (event.kind === "prompt") {
          setPendingPrompts((current) => {
            const prompt = current[event.agentId];
            return prompt?.type === "prompt" && String(prompt.requestId) === String(event.requestId)
              ? { ...current, [event.agentId]: undefined }
              : current;
          });
        } else {
          setPendingApprovals((current) => {
            const approval = current[event.agentId];
            return approval && String(approval.requestId) === String(event.requestId)
              ? { ...current, [event.agentId]: undefined }
              : current;
          });
        }
        return;
      case "approval":
        setPendingApprovals((current) => ({
          ...current,
          [event.approval.agentId]: event.approval,
        }));
        return;
      case "runtime-snapshot":
        void channels.refresh();
        applyAgentRuntimeSnapshot(event.snapshot);
        return;
      case "browser-takeover-requested":
        setPendingPrompts((current) => ({
          ...current,
          [event.request.agentId]: event,
        }));
        return;
      case "browser-takeover-resolved":
        setPendingPrompts((current) => {
          const pending = current[event.agentId];
          return pending?.type === "browser-takeover-requested" && pending.request.requestId === event.requestId
            ? { ...current, [event.agentId]: undefined }
            : current;
        });
        return;
      case "error": {
        // A provider reports an expired account as a 401 quoted inside the whole HTTP exchange, so
        // the kind has to be read from the text. Naming it here gives the bubble a label the user
        // can act on, and the refresh flips the provider to `sign-in-required`, which is what puts
        // the Sign in notice above the composer. Nothing else knows the account has lapsed until
        // the next probe, so without the refresh the user would have to reopen settings to find out.
        const authFailure = classifyUserError(event.message) === "auth";
        // A failed refresh is not reported: the error the user already has is the report, and a
        // second toast for the probe that went looking for its cause only buries the first.
        if (authFailure) void refreshAgentProviders().catch(() => undefined);
        if (event.agentId) {
          appendUiError(event.agentId, event.message, authFailure ? "Sign in required" : "Error", activeServerId());
        }
        // The inline feed is keyed by agent and by server, so it reaches nobody when the error
        // carries no agent - a provider that fails to start is the common case - and it is unread
        // until the user opens that chat. The message is already redacted in the main process.
        const failing = event.agentId ? agentList().find((agent) => agent.id === event.agentId) : undefined;
        toast.error(failing ? `${failing.name} could not continue` : "Provider error", {
          description: errorToastDescription(event.message),
        });
      }
    }
  }

  function applyAgentRuntimeSnapshot(snapshot: AgentRuntimeSnapshot): void {
    const runtimeTurns = new Map(snapshot.activeTurns.map((turn) => [turn.agentId, turn.turnId]));
    setActiveTurns(Object.fromEntries(runtimeTurns));
    setTurnProgress((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([agentId, progress]) => progress?.turnId === runtimeTurns.get(agentId)),
      ),
    );
    setFailedTurns(Object.fromEntries(snapshot.failedTurns.map((turn) => [turn.agentId, turn.turnId])));
    setQueues((current) => reconcileQueuesWithRuntimeWork(current, snapshot.work, runtimeTurns));
    setPendingPrompts((current) => reconcileAttentionPrompts(current, snapshot, submittedPromptRequests()));
    setPendingApprovals((current) => reconcileAttentionApprovals(current, snapshot));
    applyRuntimeMessages(snapshot.latestMessages);
  }

  onSettled(() => {
    const unsubscribe = window.openbot.agent.onEvent((event) => {
      if (event.type === "channels-changed") {
        void channels.refresh();
        return;
      }
      flush(() => handleAgentEvent(event));
    });
    return () => {
      readRefresh += 1;
      unsubscribe();
      completedTurnByAgent.clear();
    };
  });

  return null;
}
