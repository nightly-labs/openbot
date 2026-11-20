import { providerDisplayName } from "@openbot/contracts/agent-providers";
import {
  type AgentEvent,
  type AgentRuntimeSnapshot,
  type AttachmentSummary,
  type ConversationMessage,
  LOCAL_SERVER_ID,
} from "@openbot/contracts/ipc";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import { agentNotificationLevel } from "@openbot/team-client/agent-notifications";
import { reconcileQueuesWithRuntimeWork } from "@openbot/team-client/dynamic-island-coordinator";
import { approvalIsCut } from "@openbot/team-client/runtime-attention";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { classifyUserError } from "@openbot/user-errors";
import { flush, onSettled } from "solid-js";
import { showNewAgentBackdrop } from "../../agent-backdrops";
import { withoutAgent } from "../../app-message-projection";
import { playCompletionSoundForAgentEvent, prepareCompletionSound } from "../../completion-sound";
import { usePlatform } from "../../platform";
import { useProviders } from "../../providers";
import { queueAfterTurnCompleted } from "../../queue-reconciliation";
import { useTurns } from "../../turns";
import { useUiErrors } from "../../ui-errors";
import { useAuth } from "../account/account-context";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useBrowserTabs } from "../browser/browser-context";
import { useChannels } from "../channels/channels-context";
import { backgroundWorkKey } from "../conversation/background-work-key";
import { useConversation } from "../conversation/conversation-context";
import { useConversationController } from "../conversation/conversation-controller-context";
import { agentConversationKey, composerDraftKey, promptRequestKey } from "../conversation/conversation-keys";
import { latestIncomingConversationMessage } from "../conversation/conversation-read-state";
import { noteSocialFollowReplyCompleted } from "../conversation/social-follow-prompt";
import { appendTurnStepLine } from "../conversation/turn-step-lines";
import { serverCanManageMcp } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useSettings } from "../settings/settings-context";
import { useSidebar } from "../sidebar/sidebar-context";
import { readDictatedReplies } from "../speech/speech-replies";
import { isReaderAuthor } from "../team/reader-identity";
import { usePresence } from "../team/team-context";
import {
  agentErrorDetails,
  claimErrorToast,
  createRetryNotices,
  providerErrorTitle,
  readableAgentError,
} from "./agent-error-text";
import { createAgentEventSounds } from "./agent-event-sounds";
import {
  attentionAgentId,
  attentionEventKey,
  attentionKey,
  keepEqualList,
  keepEqualRecord,
  reconcileAttentionApprovals,
  reconcileAttentionPrompts,
  sameData,
  withListedPrompts,
  withoutAttention,
} from "./agent-runtime-snapshot";
import { useAgents } from "./agents-context";
import { agentsPort } from "./agents-port";

const agentBackdropPage = {
  title: (message: ConversationMessage) => message.text,
  bytes: async (attachment: AttachmentSummary) => {
    if (!attachment.previewUrl) throw new Error("The page has no address.");
    const response = await fetch(attachment.previewUrl);
    if (!response.ok) throw new Error("The page cannot be read.");
    return new Uint8Array(await response.arrayBuffer());
  },
};

export function AgentEventBridge() {
  const channels = useChannels();
  const platform = usePlatform();
  const { activeServer, activeServerId } = useServers();
  const { setSkillsMarketplaceOpen } = useSettings();
  const { applyAccountUsage, accountUsageTargetKey, refreshAccountUsage, centralAuth } = useAuth();
  const { readerMemberId } = usePresence();
  const isReader = (senderId: string) => {
    const state = centralAuth();
    return isReaderAuthor(senderId, {
      memberId: readerMemberId(),
      accountUserId: state.status === "signed_in" ? state.user.id : null,
      onOwnComputer: activeServer()?.kind === "local",
    });
  };
  const backdropPage = { ...agentBackdropPage, isReader };
  const { applyAgentStatus, refreshAgentProviders } = useProviders();
  const {
    agentList,
    setModelOptions,
    explicitlyOpenedAgentChatId,
    applyStoredAgents,
    applyUserHiddenAgents,
    ownAgentLevels,
    applyOwnAgentLevels,
  } = useAgents();
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
    isAgentChatOpen,
    autoMarkAgentMessageRead,
    applyConversationDelta,
    flushConversationDeltas,
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
    setSubagentTurns,
    setBackgroundWork,
    setUsageLimitedModels,
    setFailedModels,
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
  const { setSidebarLayout, receiveServerPins } = useSidebar();
  const soundLevel = (agentId: string | null) => {
    const server = activeServer();
    if (!server) return "all";
    if (server.notificationsMuted) return "nothing";
    if (agentId === null) return server.notificationLevel;
    return agentNotificationLevel(server.notificationLevel, ownAgentLevels(), agentId);
  };
  const playAgentEventSound = createAgentEventSounds(
    (agentId) =>
      soundLevel(agentId) !== "nothing" && agentList().some((agent) => agent.id === agentId && agent.notifications),
  );
  const retryNotices = createRetryNotices();
  let readRefresh = 0;
  let snapshotReceived = false;
  let promptListRead: "idle" | "reading" | "again" = "idle";
  const endedDuringPromptListRead = new Set<string>();
  let modelRefresh = 0;

  function handleAgentEvent(event: AgentEvent) {
    if (
      event.type !== "conversation-delta" &&
      event.type !== "turn-progress" &&
      event.type !== "agent-task-conversation-delta"
    ) {
      flushConversationDeltas();
    }
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
      case "usage-credits-changed": {
        const target = accountUsageTargetKey();
        if (target) void refreshAccountUsage(target).catch(() => undefined);
        return;
      }
      case "agents-changed":
        applyStoredAgents(event.agents);
        return;
      case "sidebar-layout-changed":
        setSidebarLayout(event.layout);
        return;
      case "sidebar-pins-changed":
        receiveServerPins(activeServerId(), { items: event.items, updatedAt: event.updatedAt });
        return;
      case "hidden-agents-changed":
        applyUserHiddenAgents(event.agents);
        return;
      case "agent-notification-levels-changed":
        applyOwnAgentLevels(event);
        return;
      case "conversation":
        showNewAgentBackdrop<AttachmentSummary, ConversationMessage>(
          event.snapshot.agentId,
          event.snapshot.messages,
          backdropPage,
        );
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
          showNewAgentBackdrop<AttachmentSummary, ConversationMessage>(
            event.page.agentId,
            event.page.messages,
            backdropPage,
          );
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
      case "turn-progress": {
        const detail = cleanAgentMessageText(event.detail);
        setTurnProgress((current) => {
          const progress = current[event.agentId];
          if (
            progress?.turnId === event.turnId &&
            progress.detail === detail &&
            progress.running === (event.running ? true : undefined) &&
            progress.activity === (event.activity || undefined)
          ) {
            return;
          }
          current[event.agentId] = {
            turnId: event.turnId,
            detail,
            ...(event.running ? { running: true } : {}),
            ...(event.activity ? { activity: event.activity } : {}),
          };
        });
        setTurnStepLines((current) => appendTurnStepLine(current, event.turnId, detail, event.error));
        return;
      }
      case "queue-changed":
        queueSnapshotRequests.set(event.snapshot.agentId, (queueSnapshotRequests.get(event.snapshot.agentId) ?? 0) + 1);
        setQueues((current) =>
          sameData(current[event.snapshot.agentId], event.snapshot)
            ? current
            : { ...current, [event.snapshot.agentId]: event.snapshot },
        );
        return;
      case "waits-changed":
        waitSnapshotRequests.set(event.snapshot.agentId, (waitSnapshotRequests.get(event.snapshot.agentId) ?? 0) + 1);
        setWaits((current) =>
          sameData(current[event.snapshot.agentId], event.snapshot)
            ? current
            : { ...current, [event.snapshot.agentId]: event.snapshot },
        );
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
        setTurnProgress((current) => {
          delete current[event.agentId];
        });
        clearRecentReply(event.agentId);
        setFailedTurns((current) => withoutAgent(current, event.agentId));
        setActiveTurns((current) =>
          current[event.agentId] === event.turnId ? current : { ...current, [event.agentId]: event.turnId },
        );
        if (soundLevel(event.agentId) === "all" && !platform.chatWindow) prepareCompletionSound();
        return;
      case "turn-completed": {
        completedTurnByAgent.set(event.agentId, event.turnId);
        if (promptListRead !== "idle") endedDuringPromptListRead.add(`turn:${event.turnId}`);
        const bannerKey = composerDraftKey({ agentId: event.agentId, serverId: activeServerId() });
        retryNotices.clearAtTurnEnd(bannerKey, setConversationErrors, setConversationErrorRuns);
        setTurnProgress((current) => {
          if (current[event.agentId]?.turnId === event.turnId) delete current[event.agentId];
        });
        setFailedTurns((current) =>
          event.status === "failed"
            ? { ...current, [event.agentId]: event.turnId }
            : withoutAgent(current, event.agentId),
        );
        setActiveTurns((current) =>
          current[event.agentId] === null ? current : { ...current, [event.agentId]: null },
        );
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
        setPendingPrompts((current) => {
          const key = attentionKey(event.agentId, event.threadId);
          const pending = current[key];
          const submittedRequestKey = submittedPromptRequests()[event.agentId];
          if (
            pending?.type === "browser-takeover-requested" ||
            (pending?.type === "prompt" &&
              (pending.detached ||
                activeServerId() !== LOCAL_SERVER_ID ||
                promptRequestKey(pending.turnId, pending.requestId) === submittedRequestKey))
          ) {
            return current;
          }
          return pending ? withoutAttention(current, (candidate) => attentionEventKey(candidate) === key) : current;
        });
        setApprovals((current) =>
          current.filter((approval) => approval.agentId !== event.agentId || approval.threadId !== event.threadId),
        );
        if (event.status === "completed") {
          markReplyCompleted(event.agentId);
          if (soundLevel(event.agentId) === "all" && !platform.chatWindow)
            playCompletionSoundForAgentEvent(event, agentList());
          if (!platform.chatWindow && !event.quiet && !event.continues) noteSocialFollowReplyCompleted();
        }
        return;
      }
      case "thread-turn-completed":
        if (event.routine && soundLevel(event.turn.agentId) === "all" && !platform.chatWindow)
          playCompletionSoundForAgentEvent(event.turn, agentList());
        return;
      case "prompt":
        setPendingPrompts((current) => ({ ...current, [attentionEventKey(event)]: event }));
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
          if (promptListRead !== "idle") endedDuringPromptListRead.add(`request:${event.requestId}`);
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
      case "subagent-failed": {
        const agent = agentList().find((candidate) => candidate.id === event.agentId);
        if (!agent?.notifications || soundLevel(event.agentId) !== "all" || platform.chatWindow) return;
        if (!platform.appFocused() || isAgentChatOpen(event.agentId)) return;
        const { t } = currentText();
        toast.error(agent.name, {
          description: event.title
            ? t("notification.subagentFailedFor", { task: event.title })
            : t("notification.subagentFailed"),
        });
        return;
      }
      case "runtime-snapshot":
        if (activeServerId() !== LOCAL_SERVER_ID || !snapshotReceived) void channels.resync();
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
        const authFailure = classifyUserError(event.message) === "auth";
        if (authFailure) void refreshAgentProviders({ automatic: true }).catch(() => undefined);
        const agentId = event.agentId;
        if (agentId) {
          const key = composerDraftKey({ agentId, serverId: activeServerId() });
          const message = readableAgentError(event.message);
          retryNotices.noteError(key, event.message, message);
          setConversationErrors((current) => ({ ...current, [key]: message }));
          const provider = event.provider ? providerDisplayName(event.provider) : null;
          const run =
            provider && event.model ? currentText().t("agent.error.run", { provider, model: event.model }) : provider;
          const link = event.link;
          const details = agentErrorDetails(event.message, message);
          setConversationErrorRuns((current) => {
            if (run || link || details)
              return {
                ...current,
                [key]: { message, run, ...(link ? { link } : {}), ...(details ? { details } : {}) },
              };
            if (!(key in current)) return current;
            const { [key]: _replaced, ...next } = current;
            return next;
          });
          return;
        }
        const toastKey = readableAgentError(event.message);
        if (claimErrorToast(toastKey)) {
          const { t } = currentText();
          const mcp = event.code === "mcp_server_not_started";
          toast.error(mcp ? t("agent.error.mcpNotStarted") : providerErrorTitle(event.code), {
            ...{ description: toastKey },
            ...(mcp && serverCanManageMcp(activeServer())
              ? {
                  action: {
                    label: t("agent.error.openMarketplace"),
                    onClick: () => setSkillsMarketplaceOpen(true),
                  },
                }
              : {}),
            report: { operation: "provider", source: "provider", cause_code: classifyFailure(event.message) },
          });
        }
      }
    }
  }

  function readListedPrompts(): void {
    if (promptListRead !== "idle") {
      promptListRead = "again";
      return;
    }
    promptListRead = "reading";
    endedDuringPromptListRead.clear();
    const refresh = readRefresh;
    const serverId = activeServerId();
    const current = () => refresh === readRefresh && serverId === activeServerId();
    void agentsPort()
      .agent.listPendingPrompts(serverId)
      .then((prompts) => {
        if (!current()) return;
        const open = prompts.filter(
          (prompt) =>
            !endedDuringPromptListRead.has(`request:${prompt.requestId}`) &&
            (prompt.detached === true || !endedDuringPromptListRead.has(`turn:${prompt.turnId}`)),
        );
        flush(() => setPendingPrompts((pending) => withListedPrompts(pending, open, submittedPromptRequests())));
      })
      .catch(() => undefined)
      .finally(() => {
        const again = promptListRead === "again";
        promptListRead = "idle";
        if (again && current()) readListedPrompts();
      });
  }

  function applyAgentRuntimeSnapshot(snapshot: AgentRuntimeSnapshot): void {
    const runtimeTurns = new Map(snapshot.activeTurns.map((turn) => [turn.agentId, turn.turnId]));
    setActiveTurns((current) => keepEqualRecord(current, Object.fromEntries(runtimeTurns)));
    setTurnProgress((current) => {
      for (const agentId of Object.keys(current)) {
        if (current[agentId]?.turnId !== runtimeTurns.get(agentId)) delete current[agentId];
      }
    });
    setFailedTurns((current) =>
      keepEqualRecord(current, Object.fromEntries(snapshot.failedTurns.map((turn) => [turn.agentId, turn.turnId]))),
    );
    setContextStates((current) =>
      keepEqualRecord(
        current,
        Object.fromEntries((snapshot.contextStates ?? []).map((state) => [state.agentId, state])),
      ),
    );
    setThreadContextStates((current) =>
      keepEqualRecord(
        current,
        Object.fromEntries((snapshot.threadContextStates ?? []).map((state) => [state.threadId, state])),
      ),
    );
    const usageLimits = Object.fromEntries(
      (snapshot.usageLimits ?? []).map((limit) => [limit.agentId, limit.resetsAt]),
    );
    setUsageLimits((current) => keepEqualRecord(current, usageLimits));
    setWaitedUsageLimits((current) =>
      Object.keys(current).every((agentId) => agentId in usageLimits)
        ? current
        : Object.fromEntries(Object.entries(current).filter(([agentId]) => agentId in usageLimits)),
    );
    setUsageLimitedModels((current) => keepEqualList(current, [...(snapshot.usageLimitedModels ?? [])]));
    setFailedModels((current) => keepEqualList(current, [...(snapshot.failedModels ?? [])]));
    setSubagentTurns((current) =>
      keepEqualRecord(
        current,
        Object.fromEntries((snapshot.subagentTurns ?? []).map((turn) => [turn.agentId, turn.turnId])),
      ),
    );
    setBackgroundWork((current) =>
      keepEqualRecord(
        current,
        Object.fromEntries(
          (snapshot.backgroundWork ?? []).map((work) => [backgroundWorkKey(work.agentId, work.taskId), work.since]),
        ),
      ),
    );
    setQueues((current) =>
      keepEqualRecord(current, reconcileQueuesWithRuntimeWork(current, snapshot.work, runtimeTurns)),
    );
    setPendingPrompts((current) => reconcileAttentionPrompts(current, snapshot, submittedPromptRequests()));
    if (!snapshot.attentionComplete) readListedPrompts();
    setApprovals((current) => {
      const next = reconcileAttentionApprovals(current, snapshot);
      return next.some(approvalIsCut) ? next : keepEqualList(current, next);
    });
    applyRuntimeMessages(snapshot.latestMessages);
  }

  onSettled(() => {
    if (soundLevel(null) === "all" && !platform.chatWindow) prepareCompletionSound();
    const unsubscribe = agentsPort().agent.onEvent((event) => {
      if (event.type === "channels-changed") {
        void channels.changed(event.channelId);
        return;
      }
      flush(() => handleAgentEvent(event));
      if (event.type === "runtime-snapshot") snapshotReceived = true;
      if (platform.chatWindow) return;
      playAgentEventSound(event);
      readDictatedReplies(event, activeServerId());
    });
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
