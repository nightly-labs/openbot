import type {
  AgentApproval,
  AgentContextState,
  AgentEvent,
  AgentModelChoice,
  AgentWaitsSnapshot,
  QueueSnapshot,
  RoutineFields,
} from "@openbot/contracts/ipc";
import type { AgentActiveQueues } from "@openbot/contracts/team-protocol/agent-active-queues-v1";
import { approvalIsCut, withWholeApproval } from "@openbot/team-client/runtime-attention";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, untrack } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { useAnsweredPrompts } from "./answered-prompts";
import {
  attentionKey,
  type PendingAttentionPrompts,
  seededAttentionPrompts,
} from "./features/agents/agent-runtime-snapshot";
import { useAgents } from "./features/agents/agents-context";
import { agentConversationKey, promptRequestKey } from "./features/conversation/conversation-keys";
import type { PromptAnswerOptions } from "./features/conversation/conversation-types";
import type { TurnStepLines } from "./features/conversation/turn-step-lines";
import { useDynamicIsland } from "./features/dynamic-island/dynamic-island-context";
import { useServers } from "./features/servers/servers-context";
import { queuedDeliveriesInOrder } from "./queue-reconciliation";
import { isRoutineSteerRefusal } from "./routine-steer-refusal";
import { createScopeGuard } from "./scope-lifetime";
import { createSimpleContext } from "./simple-context";
import { turnsPort } from "./turns-port";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;
type RoutineSnapshot = { routines: RoutineFields[]; current: boolean };

const Turns = createSimpleContext({
  name: "Turns",
  init: () => {
    const { activeServerId, activeServer } = useServers();
    const { dynamicIslandCoordinator } = useDynamicIsland();
    const { activeAgent, activeAgentId, agentList, agentListSettled, agentStatus, appendUiError } = useAgents();
    const scopeIsCurrent = createScopeGuard();

    const scopeServerId = untrack(activeServerId);
    const seed = dynamicIslandCoordinator.serverState(scopeServerId);
    const [activeTurns, setActiveTurns] = createSignal<Record<string, string | null>>(seed?.activeTurns ?? {});
    const [turnProgressStore, setTurnProgress] = createStore<
      Record<string, { turnId: string; detail: string; running?: boolean; activity?: string } | undefined>
    >({ ...seed?.turnProgress });
    const turnProgress = () => turnProgressStore;
    const [turnStepLines, setTurnStepLines] = createSignal<TurnStepLines>({});
    const [failedTurns, setFailedTurns] = createSignal<Record<string, string | undefined>>(seed?.failedTurns ?? {});
    const [contextStates, setContextStates] = createSignal<Record<string, AgentContextState>>({});
    const [threadContextStates, setThreadContextStates] = createSignal<Record<string, AgentContextState>>({});
    const [usageLimits, setUsageLimits] = createSignal<Record<string, number | null>>({});
    const [subagentTurns, setSubagentTurns] = createSignal<Record<string, string>>({});
    const [backgroundWork, setBackgroundWork] = createSignal<Record<string, number>>({});
    const [usageLimitedModels, setUsageLimitedModels] = createSignal<AgentModelChoice[]>([]);
    const [failedModels, setFailedModels] = createSignal<AgentModelChoice[]>([]);
    const [waitedUsageLimits, setWaitedUsageLimits] = createSignal<Record<string, number | null>>({});
    const [queues, setQueues] = createSignal<Record<string, QueueSnapshot>>(seed?.queues ?? {});
    const [waits, setWaits] = createSignal<Record<string, AgentWaitsSnapshot>>({});
    const [routinesByConversation, setRoutinesByConversation] = createSignal<
      Record<string, RoutineSnapshot | undefined>
    >({});
    const {
      presentedPromptResolutions,
      setPresentedPromptResolutions,
      submittedPromptRequests,
      setSubmittedPromptRequests,
    } = useAnsweredPrompts().promptMarkersFor(scopeServerId);
    const [pendingPrompts, setPendingPrompts] = createSignal<PendingAttentionPrompts>(
      untrack(() =>
        seededAttentionPrompts(seed?.pendingPrompts, presentedPromptResolutions(), submittedPromptRequests()),
      ),
    );
    const [approvals, setApprovals] = createSignal<AgentApproval[]>(
      Object.values(seed?.pendingApprovals ?? {}).filter((approval) => approval !== undefined),
    );
    const pendingApprovals = createMemo(() =>
      Object.fromEntries(approvals().map((approval) => [approval.agentId, approval] as const)),
    );

    function approvalOfThread(agentId: string, threadId: string | null | undefined): AgentApproval | undefined {
      return approvals().find((approval) => approval.agentId === agentId && approval.threadId === threadId);
    }

    function forgetApproval(agentId: string, requestId: string | number): void {
      setApprovals((current) =>
        current.some((approval) => approval.agentId === agentId && String(approval.requestId) === String(requestId))
          ? current.filter(
              (approval) => approval.agentId !== agentId || String(approval.requestId) !== String(requestId),
            )
          : current,
      );
    }
    const wholeApprovalReads = new Set<string>();
    createEffect(
      () => approvals().filter(approvalIsCut),
      (cut) => {
        for (const approval of cut) {
          const key = JSON.stringify([scopeServerId, approval.agentId, approval.turnId, approval.requestId]);
          if (wholeApprovalReads.has(key)) continue;
          wholeApprovalReads.add(key);
          void turnsPort()
            .agent.readPendingApproval({ agentId: approval.agentId, requestId: approval.requestId })
            .then((whole) => {
              if (!whole) {
                wholeApprovalReads.delete(key);
                return;
              }
              if (!scopeIsCurrent()) return;
              setApprovals((current) => {
                const next = withWholeApproval(current, whole);
                return next === current ? current : [...next];
              });
            })
            .catch(() => wholeApprovalReads.delete(key));
        }
      },
    );
    const completedTurnByAgent = new Map<string, string>();
    const queueSnapshotRequests = new Map<string, number>();
    const waitSnapshotRequests = new Map<string, number>();
    const routineSnapshotRequests = new Map<string, number>();

    function refreshRoutineIds(agentId: string, serverId: string): void {
      const key = agentConversationKey(serverId, agentId);
      const request = (routineSnapshotRequests.get(key) ?? 0) + 1;
      routineSnapshotRequests.set(key, request);
      setRoutinesByConversation((current) => {
        const snapshot = current[key];
        return snapshot ? { ...current, [key]: { ...snapshot, current: false } } : current;
      });
      void turnsPort()
        .agent.listRoutines(agentId)
        .then((routines) => {
          if (routineSnapshotRequests.get(key) !== request) return;
          setRoutinesByConversation((current) => ({ ...current, [key]: { routines, current: true } }));
        })
        .catch(() => undefined);
    }

    createEffect(
      () => ({ agentId: activeAgentId(), agentPhase: agentStatus().phase, serverId: activeServerId() }),
      ({ agentId, serverId }) => {
        if (agentId) refreshRoutineIds(agentId, serverId);
      },
    );

    function loadQueue(agentId: string): void {
      const queueRequest = (queueSnapshotRequests.get(agentId) ?? 0) + 1;
      queueSnapshotRequests.set(agentId, queueRequest);
      void turnsPort()
        .agent.listQueue(agentId)
        .then((queue) => {
          if (!scopeIsCurrent() || queueSnapshotRequests.get(agentId) !== queueRequest) return;
          setQueues((current) => ({ ...current, [agentId]: queue }));
        })
        .catch(() => undefined);
    }

    createEffect(
      () => ({ agentId: activeAgentId(), agentPhase: agentStatus().phase, serverId: activeServerId() }),
      ({ agentId }) => {
        if (agentId) loadQueue(agentId);
      },
    );

    function loadWaits(agentId: string): void {
      const request = (waitSnapshotRequests.get(agentId) ?? 0) + 1;
      waitSnapshotRequests.set(agentId, request);
      void turnsPort()
        .agent.listWaits(agentId)
        .then((snapshot) => {
          if (!scopeIsCurrent() || waitSnapshotRequests.get(agentId) !== request) return;
          setWaits((current) => ({ ...current, [agentId]: snapshot }));
        })
        .catch(() => undefined);
    }

    const connectionSequence = createMemo(() => activeServer()?.connectionSequence);
    createEffect(
      () => ({
        agentId: activeAgentId(),
        agentPhase: agentStatus().phase,
        serverId: activeServerId(),
        connectionSequence: connectionSequence(),
      }),
      ({ agentId }) => {
        if (agentId) loadWaits(agentId);
      },
    );

    function loadQueues(agentIds: string[]): void {
      const opened = untrack(activeAgentId);
      if (opened && agentIds.includes(opened)) loadQueue(opened);
      const rows = agentIds.filter((agentId) => agentId !== opened);
      if (rows.length === 0) return;
      const requests = new Map(
        rows.map((agentId) => {
          const queueRequest = (queueSnapshotRequests.get(agentId) ?? 0) + 1;
          queueSnapshotRequests.set(agentId, queueRequest);
          return [agentId, queueRequest] as const;
        }),
      );
      void readQueues(rows).then((queues) => {
        if (!scopeIsCurrent()) return;
        const active = untrack(activeAgentId);
        const loaded = queues.flatMap((queue) =>
          queue.agentId !== active && queueSnapshotRequests.get(queue.agentId) === requests.get(queue.agentId)
            ? [[queue.agentId, queue] as const]
            : [],
        );
        if (loaded.length > 0) setQueues((current) => ({ ...current, ...Object.fromEntries(loaded) }));
      });
    }

    async function readQueues(agentIds: string[]): Promise<QueueSnapshot[]> {
      let listed: AgentActiveQueues | null;
      try {
        listed = await turnsPort().agent.listActiveQueues(agentIds);
      } catch {
        listed = null;
      }
      const each = await Promise.all(
        (listed?.omitted ?? agentIds).map((agentId) =>
          turnsPort()
            .agent.listQueue(agentId)
            .catch(() => null),
        ),
      );
      return [...(listed?.queues ?? []), ...each.filter((queue) => queue !== null)];
    }

    createEffect(
      () => ({
        agentIds: agentListSettled()
          ? agentList()
              .map((agent) => agent.id)
              .join("\0")
          : "",
        agentPhase: agentStatus().phase,
        serverId: activeServerId(),
      }),
      (next, previous) => {
        if (
          previous &&
          next.agentIds === previous.agentIds &&
          next.agentPhase === previous.agentPhase &&
          next.serverId === previous.serverId
        ) {
          return;
        }
        if (!next.agentIds) return;
        const activeLoads =
          !previous?.agentIds || next.agentPhase !== previous.agentPhase || next.serverId !== previous.serverId;
        const active = activeLoads ? untrack(activeAgentId) : null;
        loadQueues(next.agentIds.split("\0").filter((agentId) => agentId !== active));
      },
    );

    async function answerPrompt(
      answers: Record<string, string[]>,
      options?: PromptAnswerOptions,
      threadId?: string,
    ): Promise<boolean> {
      const agent = activeAgent();
      const prompt = agent ? pendingPrompts()[attentionKey(agent.id, threadId ?? agent.threadId)] : undefined;
      if (!agent || prompt?.type !== "prompt") return false;
      const mark = threadId === undefined ? agent.id : attentionKey(agent.id, threadId);
      return submitPromptAnswers(agent.id, mark, prompt, answers, options);
    }

    async function answerPromptRequest(
      agentId: string,
      threadId: string | null,
      requestId: string | number,
      answers: Record<string, string[]>,
    ): Promise<boolean> {
      const prompt = pendingPrompts()[attentionKey(agentId, threadId)];
      if (prompt?.type !== "prompt" || String(prompt.requestId) !== String(requestId)) return false;
      const own = agentList().some((agent) => agent.id === agentId && agent.threadId === threadId);
      return submitPromptAnswers(agentId, own ? agentId : attentionKey(agentId, threadId), prompt, answers);
    }

    async function submitPromptAnswers(
      agentId: string,
      mark: string,
      prompt: PromptEvent,
      answers: Record<string, string[]>,
      options?: PromptAnswerOptions,
    ): Promise<boolean> {
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      setSubmittedPromptRequests((current) => ({
        ...current,
        [mark]: promptRequestKey(prompt.turnId, prompt.requestId) ?? undefined,
      }));
      try {
        await turnsPort().agent.respondToPrompt({
          requestId: prompt.requestId,
          answers,
        });
        analytics.track("agent_input_action", {
          kind: "prompt",
          decision: "answered",
          result: "succeeded",
        });
        return true;
      } catch (error) {
        setSubmittedPromptRequests((current) => ({ ...current, [mark]: undefined }));
        analytics.track("agent_input_action", {
          kind: "prompt",
          decision: "answered",
          result: "failed",
          failure_code: "response_failed",
        });
        if (options?.onError) options.onError(error);
        else appendUiError(agentId, error, currentText().t("app.errorStatus.answer"), serverId);
        return false;
      }
    }

    async function respondToApprovalRequest(
      agentId: string,
      requestId: string | number,
      decision: "accept" | "decline",
      options?: PromptAnswerOptions,
    ): Promise<boolean> {
      const serverId = activeServerId();
      const approval = approvals().find(
        (item) => item.agentId === agentId && String(item.requestId) === String(requestId),
      );
      if (!approval) return false;
      const analytics = desktopAnalytics.scope();
      try {
        await turnsPort().agent.respondToApproval({
          requestId: approval.requestId,
          decision,
        });
        forgetApproval(agentId, approval.requestId);
        analytics.track("agent_input_action", { kind: "approval", decision, result: "succeeded" });
        return true;
      } catch (error) {
        analytics.track("agent_input_action", {
          kind: "approval",
          decision,
          result: "failed",
          failure_code: "response_failed",
        });
        if (options?.onError) options.onError(error);
        else appendUiError(agentId, error, currentText().t("app.errorStatus.approval"), serverId);
        return false;
      }
    }

    async function respondToApproval(decision: "accept" | "decline"): Promise<boolean> {
      const agent = activeAgent();
      const approval = agent ? approvalOfThread(agent.id, agent.threadId) : undefined;
      if (!agent || !approval) return false;
      return respondToApprovalRequest(agent.id, approval.requestId, decision);
    }

    async function respondToBrowserTakeover(
      decision: "complete" | "cancel",
      threadId?: string,
      options?: PromptAnswerOptions,
    ): Promise<boolean> {
      const agent = activeAgent();
      const thread = threadId ?? agent?.threadId ?? null;
      const event = agent ? pendingPrompts()[attentionKey(agent.id, thread)] : undefined;
      if (!agent || event?.type !== "browser-takeover-requested") return false;
      return respondToBrowserTakeoverRequest(agent.id, thread, event.request.requestId, decision, options);
    }

    async function respondToBrowserTakeoverRequest(
      agentId: string,
      threadId: string | null,
      requestId: string | number,
      decision: "complete" | "cancel",
      options?: PromptAnswerOptions,
    ): Promise<boolean> {
      const key = attentionKey(agentId, threadId);
      const event = pendingPrompts()[key];
      if (event?.type !== "browser-takeover-requested" || String(event.request.requestId) !== String(requestId))
        return false;
      const serverId = activeServerId();
      try {
        await turnsPort().agent.respondToBrowserTakeover({ requestId: event.request.requestId, decision });
        setPendingPrompts((current) => ({ ...current, [key]: undefined }));
        return true;
      } catch (error) {
        if (options?.onError) options.onError(error);
        else appendUiError(agentId, error, currentText().t("app.errorStatus.browserTakeover"), serverId);
        return false;
      }
    }

    function cancelQueuedMessage(deliveryId: string) {
      const agent = activeAgent();
      if (!agent) return;
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      void turnsPort()
        .agent.cancelQueuedMessage({ agentId: agent.id, deliveryId })
        .then(() => analytics.track("queue_action", { action: "cancel", result: "succeeded" }))
        .catch((error) => {
          analytics.track("queue_action", { action: "cancel", result: "failed", failure_code: "cancel_failed" });
          appendUiError(agent.id, error, currentText().t("app.errorStatus.cancel"), serverId);
        });
    }

    function cancelWait(waitId: string) {
      const agent = activeAgent();
      if (!agent) return;
      const serverId = activeServerId();
      void turnsPort()
        .agent.cancelWait({ agentId: agent.id, waitId })
        .then(() => loadWaits(agent.id))
        .catch((error) => appendUiError(agent.id, error, currentText().t("app.errorStatus.waitCancel"), serverId));
    }

    function steerQueuedMessage(deliveryId: string) {
      const agent = activeAgent();
      const turnId = agent ? activeTurns()[agent.id] : null;
      if (!agent || !turnId) return;
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      void turnsPort()
        .agent.steerQueuedMessage({ agentId: agent.id, deliveryId, expectedTurnId: turnId })
        .then(() => analytics.track("queue_action", { action: "steer", result: "succeeded" }))
        .catch((error) => {
          analytics.track("queue_action", { action: "steer", result: "failed", failure_code: "steer_failed" });
          if (activeTurns()[agent.id] !== turnId) return;
          const delivery = queues()[agent.id]?.deliveries.find((item) => item.id === deliveryId);
          if (delivery && delivery.status !== "queued") return;
          if (isRoutineSteerRefusal(error)) return;
          appendUiError(agent.id, error, currentText().t("app.errorStatus.steer"), serverId);
        });
    }

    function sendQueuedMessageNow(deliveryId: string) {
      const agent = activeAgent();
      const turnId = agent ? activeTurns()[agent.id] : null;
      if (!agent || !turnId) return;
      const queued = queuedDeliveriesInOrder(queues()[agent.id]);
      const head = queued[0];
      if (head?.editing && head.id !== deliveryId) return;
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      const ids = queued.map((delivery) => delivery.id);
      const port = turnsPort().agent;
      const failed = (error: unknown, status: string) => {
        analytics.track("queue_action", { action: "send_now", result: "failed", failure_code: "send_now_failed" });
        appendUiError(agent.id, error, status, serverId);
      };
      const reorder =
        ids[0] === deliveryId
          ? Promise.resolve(true)
          : port
              .reorderQueue({ agentId: agent.id, deliveryIds: [deliveryId, ...ids.filter((id) => id !== deliveryId)] })
              .then(
                () => true,
                (error: unknown) => {
                  failed(error, currentText().t("app.errorStatus.reorder"));
                  return false;
                },
              );
      void reorder.then((moved) => {
        if (!moved || activeTurns()[agent.id] !== turnId) return;
        return port
          .interrupt({ agentId: agent.id, turnId })
          .then(() => analytics.track("queue_action", { action: "send_now", result: "succeeded" }))
          .catch((error: unknown) => failed(error, currentText().t("app.errorStatus.stop")));
      });
    }

    async function updateQueuedMessage(
      deliveryId: string,
      text: string,
      keepAttachmentIds: string[],
      attachmentDraftIds: string[],
      target?: { agentId: string; serverId: string },
    ): Promise<boolean> {
      const agentId = target?.agentId ?? activeAgent()?.id;
      const serverId = target?.serverId ?? activeServerId();
      if (!agentId) return false;
      const analytics = desktopAnalytics.scope();
      try {
        const input = {
          agentId,
          deliveryId,
          text,
          keepAttachmentIds,
          attachmentDraftIds,
        };
        await turnsPort().agent.updateQueuedMessage(input, serverId);
        analytics.track("queue_action", { action: "edit", result: "succeeded" });
        return true;
      } catch (error) {
        analytics.track("queue_action", { action: "edit", result: "failed", failure_code: "edit_failed" });
        appendUiError(agentId, error, currentText().t("app.errorStatus.edit"), serverId);
        return false;
      }
    }

    function reorderQueue(deliveryIds: string[]) {
      const agent = activeAgent();
      if (!agent) return;
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      void turnsPort()
        .agent.reorderQueue({ agentId: agent.id, deliveryIds })
        .then(() => analytics.track("queue_action", { action: "reorder", result: "succeeded" }))
        .catch((error) => {
          analytics.track("queue_action", { action: "reorder", result: "failed", failure_code: "reorder_failed" });
          appendUiError(agent.id, error, currentText().t("app.errorStatus.reorder"), serverId);
        });
    }

    function stoppableSubagentTurn(agent: { id: string; provider: string } | undefined): string | null {
      return agent?.provider === "codex" ? (subagentTurns()[agent.id] ?? null) : null;
    }

    function stopActiveTurn() {
      const agent = activeAgent();
      const turnId = agent ? (activeTurns()[agent.id] ?? stoppableSubagentTurn(agent)) : null;
      if (!agent || !turnId) return;
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      void turnsPort()
        .agent.interrupt({ agentId: agent.id, turnId })
        .then(() => analytics.track("queue_action", { action: "interrupt", result: "succeeded" }))
        .catch((error) => {
          analytics.track("queue_action", {
            action: "interrupt",
            result: "failed",
            failure_code: "interrupt_failed",
          });
          appendUiError(agent.id, error, currentText().t("app.errorStatus.stop"), serverId);
        });
    }

    const activeQueue = createMemo(() => {
      const agent = activeAgent();
      return agent ? queues()[agent.id] : undefined;
    });
    const activeWaits = createMemo(() => {
      const agent = activeAgent();
      return agent ? (waits()[agent.id]?.waits ?? []) : [];
    });
    const activeRoutineSnapshot = createMemo(() => {
      const agent = activeAgent();
      return agent ? routinesByConversation()[agentConversationKey(activeServerId(), agent.id)] : undefined;
    });
    const activeRoutineIds = createMemo(() => {
      const snapshot = activeRoutineSnapshot();
      return snapshot?.current ? snapshot.routines.map((routine) => routine.id) : undefined;
    });
    const activeRoutines = createMemo(() => activeRoutineSnapshot()?.routines);

    return {
      activeTurns,
      setActiveTurns,
      turnProgress,
      setTurnProgress,
      turnStepLines,
      setTurnStepLines,
      failedTurns,
      setFailedTurns,
      contextStates,
      setContextStates,
      threadContextStates,
      setThreadContextStates,
      usageLimits,
      setUsageLimits,
      subagentTurns,
      setSubagentTurns,
      backgroundWork,
      setBackgroundWork,
      usageLimitedModels,
      setUsageLimitedModels,
      failedModels,
      setFailedModels,
      waitedUsageLimits,
      setWaitedUsageLimits,
      queues,
      setQueues,
      setWaits,
      waitSnapshotRequests,
      routinesByConversation,
      pendingPrompts,
      setPendingPrompts,
      presentedPromptResolutions,
      setPresentedPromptResolutions,
      submittedPromptRequests,
      setSubmittedPromptRequests,
      approvals,
      setApprovals,
      pendingApprovals,
      approvalOfThread,
      forgetApproval,
      completedTurnByAgent,
      queueSnapshotRequests,
      activeQueue,
      activeWaits,
      activeRoutineIds,
      activeRoutines,
      refreshRoutineIds,
      answerPrompt,
      answerPromptRequest,
      respondToApproval,
      respondToApprovalRequest,
      respondToBrowserTakeover,
      respondToBrowserTakeoverRequest,
      cancelQueuedMessage,
      cancelWait,
      steerQueuedMessage,
      sendQueuedMessageNow,
      updateQueuedMessage,
      reorderQueue,
      stopActiveTurn,
      stoppableSubagentTurn,
    };
  },
});

export const TurnsProvider = Turns.provider;
export const useTurns = Turns.use;
