import { providerDisplayName } from "@openbot/contracts/agent-providers";
import type { AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { reconcileQueuesWithRuntimeWork } from "@openbot/team-client/dynamic-island-coordinator";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { classifyUserError } from "@openbot/user-errors";
import { flush, onSettled } from "solid-js";
import { withoutAgent } from "../../app-message-projection";
import { playCompletionSoundForAgentEvent } from "../../completion-sound";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { queueAfterTurnCompleted } from "../../queue-reconciliation";
import { useTurns } from "../../turns";
import { useUiErrors } from "../../ui-errors";
import { useAuth } from "../account/account-context";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useChannels } from "../channels/channels-context";
import { useConversation } from "../conversation/conversation-context";
import { useConversationController } from "../conversation/conversation-controller-context";
import { agentConversationKey, composerDraftKey, promptRequestKey } from "../conversation/conversation-keys";
import { latestIncomingConversationMessage } from "../conversation/conversation-read-state";
import { appendTurnStepLine } from "../conversation/turn-step-lines";
import { useServers } from "../servers/servers-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { readDictatedReplies } from "../speech/speech-replies";
import { claimErrorToast, providerErrorTitle, readableAgentError } from "./agent-error-text";
import { createAgentEventSounds } from "./agent-event-sounds";
import {
  attentionAgentId,
  attentionEventKey,
  attentionKey,
  reconcileAttentionApprovals,
  reconcileAttentionPrompts,
  withoutAttention,
} from "./agent-runtime-snapshot";
import { useAgents } from "./agents-context";
import { agentsPort } from "./agents-port";

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
 * It renders `null` and must stay renderable with no view above it.
 *
 * Conversation invalidations also cover read cursors changed on another device.
 */
export function AgentEventBridge() {
  const channels = useChannels();
  const platform = usePlatform();
  const { activeServer, activeServerId } = useServers();
  const { applyAccountUsage } = useAuth();
  const { applyAgentStatus, refreshAgentProviders } = useProviders();
  const { agentList, setModelOptions, explicitlyOpenedAgentChatId, applyStoredAgents, applyUserHiddenAgents } =
    useAgents();
  const { setConversationErrors, setConversationErrorRuns } = useConversationController();
  const { setUiErrors } = useUiErrors();
  const agentTasks = useAgentTasks();
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
    setTurnStepLines,
    setFailedTurns,
    setUsageLimits,
    setUsageLimitedModels,
    setWaitedUsageLimits,
    setContextStates,
    setThreadContextStates,
    setQueues,
    setPendingPrompts,
    setPresentedPromptResolutions,
    submittedPromptRequests,
    setSubmittedPromptRequests,
    setApprovals,
    forgetApproval,
    completedTurnByAgent,
    queueSnapshotRequests,
    setWaits,
    waitSnapshotRequests,
    refreshRoutineIds,
  } = useTurns();
  const { setBrowserControlState, applyBrowserChange } = useBrowserTabs();
  const { setSidebarLayout } = useSidebar();
  // As on web, mute and the notification level of the server decide the sounds too. Before the
  // server list arrives, the sounds play as they did.
  const soundLevel = () => {
    const server = activeServer();
    if (!server) return "all";
    return server.notificationsMuted ? "nothing" : server.notificationLevel;
  };
  const playAgentEventSound = createAgentEventSounds(
    (agentId) => soundLevel() !== "nothing" && agentList().some((agent) => agent.id === agentId && agent.notifications),
  );
  let readRefresh = 0;
  let modelRefresh = 0;

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "status":
        applyAgentStatus(event.status);
        if (event.status.phase === "ready" || event.status.phase === "blocked") {
          const request = ++modelRefresh;
          void agentsPort()
            .agent.listModels()
            .then((models) => {
              if (request === modelRefresh) setModelOptions(models);
            })
            .catch(() => undefined);
        }
        return;
      case "usage-changed":
        applyAccountUsage(event.usage);
        return;
      case "agents-changed":
        applyStoredAgents(event.agents);
        return;
      case "sidebar-layout-changed":
        setSidebarLayout(event.layout);
        return;
      case "hidden-agents-changed":
        applyUserHiddenAgents(event.agents);
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
          void agentsPort()
            .agent.listConversationReads()
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
        setTurnStepLines((current) => appendTurnStepLine(current, event.turnId, cleanAgentMessageText(event.detail)));
        return;
      case "queue-changed":
        queueSnapshotRequests.set(event.snapshot.agentId, (queueSnapshotRequests.get(event.snapshot.agentId) ?? 0) + 1);
        setQueues((current) => ({
          ...current,
          [event.snapshot.agentId]: event.snapshot,
        }));
        return;
      case "waits-changed":
        waitSnapshotRequests.set(event.snapshot.agentId, (waitSnapshotRequests.get(event.snapshot.agentId) ?? 0) + 1);
        setWaits((current) => ({ ...current, [event.snapshot.agentId]: event.snapshot }));
        return;
      case "agent-tasks-changed":
      case "agent-task-conversation":
      case "agent-task-conversation-delta":
        agentTasks.applyEvent(event);
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
        // A steer refusal is about the turn that ended. Kept, it shows below the turn's last reply (#3206).
        setUiErrors((current) => {
          const key = agentConversationKey(activeServerId(), event.agentId);
          const steerStatus = currentText().t("app.errorStatus.steer");
          const errors = current[key];
          if (!errors?.some((error) => error.status === steerStatus)) return current;
          return { ...current, [key]: errors.filter((error) => error.status !== steerStatus) };
        });
        setQueues((current) => {
          const snapshot = current[event.agentId];
          if (!snapshot) return current;
          const next = queueAfterTurnCompleted(snapshot, event.turnId);
          return next === snapshot ? current : { ...current, [event.agentId]: next };
        });
        // Only the wait of this turn's thread: another thread of the agent can still wait for the user.
        setPendingPrompts((current) => {
          const key = attentionKey(event.agentId, event.threadId);
          const pending = current[key];
          const submittedRequestKey = submittedPromptRequests()[event.agentId];
          if (
            pending?.type === "prompt" &&
            promptRequestKey(pending.turnId, pending.requestId) === submittedRequestKey
          ) {
            return current;
          }
          return pending ? withoutAttention(current, (candidate) => attentionEventKey(candidate) === key) : current;
        });
        // Only the approvals of this turn's thread: a task of the agent can still wait for one.
        setApprovals((current) =>
          current.filter((approval) => approval.agentId !== event.agentId || approval.threadId !== event.threadId),
        );
        if (event.status === "completed") {
          markReplyCompleted(event.agentId);
          if (soundLevel() === "all" && !platform.chatWindow) playCompletionSoundForAgentEvent(event, agentList());
        }
        return;
      case "prompt":
        setPendingPrompts((current) => ({ ...current, [attentionEventKey(event)]: event }));
        // The agent id keys the answer marks of the agent's own chat. A side thread's question keeps
        // them and clears only the mark of its own thread.
        if (agentList().some((agent) => agent.id === event.agentId && agent.threadId === event.threadId)) {
          setPresentedPromptResolutions((current) => ({ ...current, [event.agentId]: undefined }));
          setSubmittedPromptRequests((current) => ({ ...current, [event.agentId]: undefined }));
        } else {
          const mark = attentionEventKey(event);
          setSubmittedPromptRequests((current) =>
            current[mark] === undefined ? current : { ...current, [mark]: undefined },
          );
        }
        return;
      case "agent-input-resolved":
        if (event.kind === "prompt") {
          setPendingPrompts((current) =>
            withoutAttention(
              current,
              (prompt) =>
                prompt.type === "prompt" &&
                prompt.agentId === event.agentId &&
                String(prompt.requestId) === String(event.requestId),
            ),
          );
        } else {
          forgetApproval(event.agentId, event.requestId);
        }
        return;
      case "approval":
        setApprovals((current) => [
          ...current.filter(
            (approval) =>
              approval.agentId !== event.approval.agentId ||
              String(approval.requestId) !== String(event.approval.requestId),
          ),
          event.approval,
        ]);
        return;
      case "runtime-snapshot":
        void channels.refresh();
        applyAgentRuntimeSnapshot(event.snapshot);
        return;
      case "browser-takeover-requested":
        setPendingPrompts((current) => ({ ...current, [attentionEventKey(event)]: event }));
        return;
      case "browser-takeover-resolved":
        setPendingPrompts((current) =>
          withoutAttention(
            current,
            (pending) =>
              pending.type === "browser-takeover-requested" &&
              attentionAgentId(pending) === event.agentId &&
              pending.request.requestId === event.requestId,
          ),
        );
        return;
      case "error": {
        // A provider reports an expired account as a 401 quoted inside the whole HTTP exchange, so
        // the kind has to be read from the text. The refresh flips the provider to
        // `sign-in-required`, which is what puts the Sign in notice above the composer. Nothing
        // else knows the account has lapsed until the next probe, so without the refresh the user
        // would have to reopen settings to find out.
        const authFailure = classifyUserError(event.message) === "auth";
        // A failed refresh is not reported: the error the user already has is the report, and a
        // second toast for the probe that went looking for its cause only buries the first.
        if (authFailure) void refreshAgentProviders({ automatic: true }).catch(() => undefined);
        const agentId = event.agentId;
        if (agentId) {
          // The banner above the composer, in the same column as the usage-limit and sign-in
          // notices - not a bubble in the transcript, and no toast. A provider that retries a
          // dropped transport reports the same failure once per attempt, and every report used to
          // become a message the user had to scroll past to reach their own conversation. One
          // entry per chat means the newest report replaces the last, so an outage costs the
          // reader one line whatever its length, and dismissing it clears the whole run.
          const key = composerDraftKey({ agentId, serverId: activeServerId() });
          const message = readableAgentError(event.message);
          setConversationErrors((current) => ({ ...current, [key]: message }));
          // The provider and model above the error let the user report which run failed (#2858).
          const provider = event.provider ? providerDisplayName(event.provider) : null;
          const run =
            provider && event.model ? currentText().t("agent.error.run", { provider, model: event.model }) : provider;
          setConversationErrorRuns((current) => {
            if (run) return { ...current, [key]: { message, run } };
            if (!(key in current)) return current;
            const { [key]: _replaced, ...next } = current;
            return next;
          });
          return;
        }
        // No agent to attach it to - a provider that fails to start is the common case - so this
        // one stays global. The message is already redacted in the main process.
        const toastKey = readableAgentError(event.message);
        if (claimErrorToast(toastKey)) {
          // Codex ignored a setting and runs without it. The provider works, so this is a warning
          // about the user's file, not a provider error.
          if (event.code === "codex_config_ignored") {
            toast.warning(currentText().t("agent.error.codexConfigIgnored"), {
              ...{ description: toastKey },
              report: { operation: "provider", source: "provider", cause_code: classifyFailure(event.message) },
            });
            return;
          }
          // An MCP server left out at hand-off is not the provider failing, and calling it a
          // provider error sends the user to the wrong settings page.
          const { t } = currentText();
          const title =
            event.code === "mcp_server_not_started" ? t("agent.error.mcpNotStarted") : providerErrorTitle(event.code);
          toast.error(title, {
            ...{ description: toastKey },
            report: { operation: "provider", source: "provider", cause_code: classifyFailure(event.message) },
          });
        }
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
    setContextStates(Object.fromEntries((snapshot.contextStates ?? []).map((state) => [state.agentId, state])));
    setThreadContextStates(
      Object.fromEntries((snapshot.threadContextStates ?? []).map((state) => [state.threadId, state])),
    );
    const usageLimits = Object.fromEntries(
      (snapshot.usageLimits ?? []).map((limit) => [limit.agentId, limit.resetsAt]),
    );
    setUsageLimits(usageLimits);
    // A hold that ended takes its "Wait" with it, so the next hold asks again.
    setWaitedUsageLimits((current) =>
      Object.fromEntries(Object.entries(current).filter(([agentId]) => agentId in usageLimits)),
    );
    setUsageLimitedModels(snapshot.usageLimitedModels ?? []);
    setQueues((current) => reconcileQueuesWithRuntimeWork(current, snapshot.work, runtimeTurns));
    setPendingPrompts((current) => reconcileAttentionPrompts(current, snapshot, submittedPromptRequests()));
    setApprovals((current) => reconcileAttentionApprovals(current, snapshot));
    applyRuntimeMessages(snapshot.latestMessages);
  }

  onSettled(() => {
    const unsubscribe = agentsPort().agent.onEvent((event) => {
      if (event.type === "channels-changed") {
        void channels.refresh();
        return;
      }
      flush(() => handleAgentEvent(event));
      // The main window also gets each event, so a chat window does not play or read it a second time.
      if (platform.chatWindow) return;
      playAgentEventSound(event);
      readDictatedReplies(event, activeServerId());
    });
    // After a reload, a question that still waits is only in the runtime snapshot. Main drops
    // events while the page loads, so read the snapshot once here.
    void agentsPort()
      .agent.getRuntimeSnapshot()
      .then((snapshot) => {
        if (snapshot) flush(() => handleAgentEvent({ type: "runtime-snapshot", snapshot }));
      })
      .catch(() => undefined);
    return () => {
      readRefresh += 1;
      unsubscribe();
      completedTurnByAgent.clear();
    };
  });

  return null;
}
