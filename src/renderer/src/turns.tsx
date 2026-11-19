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
/** `current` is false while a new list loads. */
type RoutineSnapshot = { routines: RoutineFields[]; current: boolean };

/**
 * What each agent is *doing*: the turn it is running, the queue behind it, and
 * the prompt or approval it is blocked on.
 *
 * This is the one domain inside the per-server subtree whose state survives a
 * server switch. `DynamicIslandCoordinator` lives above the keyed boundary,
 * keeps six of these maps per server and hands them back through
 * `serverState(serverId)`, so this provider seeds from that snapshot on mount
 * instead of starting empty. Keeping turns separate from `conversation` is what
 * keeps that seam visible - mixed together, the one layer that is restored
 * would be indistinguishable from the ones that are not.
 *
 * Two placements deviate from the plan's inventory, both for the same reason -
 * the edge only points one way:
 *
 * - **This provider sits *outside* `conversation`, not inside it.** The plan had
 *   conversation first, but `applyConversation` and `applyConversationPage` both
 *   write `activeTurns` (a snapshot carries the turn that produced it) while
 *   nothing here needs a conversation *signal*. Nesting turns outside leaves a
 *   single downward edge; the other order needs two.
 * - **`presentPromptResolution` is not here.** It is the one turn command that
 *   reads `liveMessages`, to tell a resolution the user has seen from one main
 *   has already persisted. It moves to `conversation` with that state.
 *
 * `completedTurnByAgent` and `routinesByConversation` used to survive a switch
 * because nobody cleared them; they now die with the scope, which is the
 * teardown the old list of setters kept forgetting. `completedTurnByAgent` had
 * grown for the life of the process.
 *
 * `presentedPromptResolutions` and `submittedPromptRequests` are the exception
 * that proves that rule: they too survived by neglect, but for them the survival
 * was load-bearing, because an answered prompt is only proved answered by a
 * snapshot that may arrive after the user has moved to another server. They are
 * re-exported from here under their own names so nothing downstream can tell,
 * but they are owned by `answered-prompts.tsx` above the boundary and scoped to
 * this server by its id - and they are read before `pendingPrompts` exists,
 * because the seed below is the first thing that has to consult them.
 */
const Turns = createSimpleContext({
  name: "Turns",
  init: () => {
    const { activeServerId, activeServer } = useServers();
    const { dynamicIslandCoordinator } = useDynamicIsland();
    const { activeAgent, activeAgentId, agentList, agentListSettled, agentStatus, appendUiError } = useAgents();
    const scopeIsCurrent = createScopeGuard();

    // The layer-2 seed: what this server was doing the last time it was open. The scope is keyed
    // on the server, so its id and the seed are read once.
    const scopeServerId = untrack(activeServerId);
    const seed = dynamicIslandCoordinator.serverState(scopeServerId);
    const [activeTurns, setActiveTurns] = createSignal<Record<string, string | null>>(seed?.activeTurns ?? {});
    // A store, so a progress line runs again only the readers of its own agent. The seed is copied, so a
    // write does not change the record of the coordinator.
    const [turnProgressStore, setTurnProgress] = createStore<
      Record<string, { turnId: string; detail: string; running?: boolean; activity?: string } | undefined>
    >({ ...seed?.turnProgress });
    const turnProgress = () => turnProgressStore;
    // Every progress line of the newest turns, by turn, for the steps under the activity line.
    const [turnStepLines, setTurnStepLines] = createSignal<TurnStepLines>({});
    const [failedTurns, setFailedTurns] = createSignal<Record<string, string | undefined>>(seed?.failedTurns ?? {});
    const [interruptedTurns, setInterruptedTurns] = createSignal<Record<string, string | undefined>>({});
    // The agents whose queue waits for a provider plan to reset, in epoch seconds. Only a runtime snapshot of the local host carries it.
    const [contextStates, setContextStates] = createSignal<Record<string, AgentContextState>>({});
    // The context of each side thread, by thread id. Only a runtime snapshot of the local host carries it.
    const [threadContextStates, setThreadContextStates] = createSignal<Record<string, AgentContextState>>({});
    const [usageLimits, setUsageLimits] = createSignal<Record<string, number | null>>({});
    // The turn of each agent whose subagents still run, also after the turn ended. Only a runtime snapshot of the local host carries it.
    const [subagentTurns, setSubagentTurns] = createSignal<Record<string, string>>({});
    // When the background work of each chat started, by `backgroundWorkKey`, while it runs after its turn ended.
    const [backgroundWork, setBackgroundWork] = createSignal<Record<string, number>>({});
    // Each provider account and model that a usage limit holds, also with no agent on it.
    const [usageLimitedModels, setUsageLimitedModels] = createSignal<AgentModelChoice[]>([]);
    // Each provider account and model that a provider error holds, so that a switch passes over it.
    const [failedModels, setFailedModels] = createSignal<AgentModelChoice[]>([]);
    // The holds whose ask card the user closed with "Wait", by agent, with the reset of that hold.
    const [waitedUsageLimits, setWaitedUsageLimits] = createSignal<Record<string, number | null>>({});
    const [queues, setQueues] = createSignal<Record<string, QueueSnapshot>>(seed?.queues ?? {});
    // Only the active agent's open waits load; a `waits-changed` event updates any agent.
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
    // Every waiting approval: the agent's chat and each of its tasks has its own thread.
    const [approvals, setApprovals] = createSignal<AgentApproval[]>(
      Object.values(seed?.pendingApprovals ?? {}).filter((approval) => approval !== undefined),
    );
    /** The newest waiting approval of each agent, in any thread. */
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
    // A runtime snapshot cuts the long texts of an approval. Main reads the whole copy once for each cut
    // request. Until it comes, and when the server cannot send it, the card offers only Deny.
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
              // Before a joined server connects, main does not know its capabilities and returns null. The
              // next change of the approvals tries again.
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
            // The next change of the approvals tries again.
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
        // This background read can time out while chat replies still arrive. Keep the last queue;
        // the next load or queue-changed event updates it. Queue action failures still report errors.
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
        // As in `loadQueue`: this background read can time out on a joined server while the agent
        // works. Keep the last waits; the next load (a new phase, agent, server or connection) or a
        // local `waits-changed` event updates them. A failed cancel still reports an error.
        .catch(() => undefined);
    }

    // Changes only when a connection to the server comes up, so a reconnect reads the waits again.
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

    /**
     * Reads the queues of many agents and writes them at once. One write for each answer ran every
     * sidebar row again for each agent: on a host with 50 agents, the first conversation waited
     * seconds for those runs (`bun run perf:remote`). The rows need only the open work, so a host with
     * `agent-active-queues-v1` gives all of it in one read. The open chat keeps its full queue from
     * `loadQueue`: an answer that arrives after it does not replace it.
     */
    function loadQueues(agentIds: string[]): void {
      // The open chat needs its finished deliveries too: it gets a full read.
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

    /**
     * One list read, and a read of each queue that it did not carry. An older host has no list (null), and
     * a list read can fail, so then each queue is read. As in `loadQueue`, a failed read keeps the last queue; the next load or
     * queue-changed event updates it.
     */
    async function readQueues(agentIds: string[]): Promise<QueueSnapshot[]> {
      let listed: AgentActiveQueues | null;
      try {
        listed = await turnsPort().agent.listActiveQueues(agentIds);
      } catch {
        // As on the web client: each queue read can still succeed.
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

    // The active-agent load above misses everyone else. A routine mark needs each agent's real
    // queue sender, which a runtime snapshot does not carry. The agents of a saved frame wait for the
    // first read of the roster: the host is not connected yet.
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
        // A new phase or server, or the first roster, also runs the active-agent load, so that agent is
        // read only once.
        const activeLoads =
          !previous?.agentIds || next.agentPhase !== previous.agentPhase || next.serverId !== previous.serverId;
        const active = activeLoads ? untrack(activeAgentId) : null;
        loadQueues(next.agentIds.split("\0").filter((agentId) => agentId !== active));
      },
    );

    /** Answers the prompt of the agent's chat, or of its side thread `threadId`. */
    async function answerPrompt(
      answers: Record<string, string[]>,
      options?: PromptAnswerOptions,
      threadId?: string,
    ): Promise<boolean> {
      const agent = activeAgent();
      const prompt = agent ? pendingPrompts()[attentionKey(agent.id, threadId ?? agent.threadId)] : undefined;
      if (!agent || prompt?.type !== "prompt") return false;
      // A side thread marks its answer by its own key: the agent id marks the agent's own chat.
      const mark = threadId === undefined ? agent.id : attentionKey(agent.id, threadId);
      return submitPromptAnswers(agent.id, mark, prompt, answers, options);
    }

    /**
     * Answers the prompt `requestId` of the thread `threadId` of any agent, from outside its chat, as the
     * agent dock does. False when the thread no longer waits for that prompt.
     */
    async function answerPromptRequest(
      agentId: string,
      threadId: string | null,
      requestId: string | number,
      answers: Record<string, string[]>,
    ): Promise<boolean> {
      const prompt = pendingPrompts()[attentionKey(agentId, threadId)];
      if (prompt?.type !== "prompt" || String(prompt.requestId) !== String(requestId)) return false;
      // The agent id marks the agent's own chat, as `answerPrompt` does.
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

    /** Answers the takeover of the agent's chat, or of its side thread `threadId`. */
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

    /**
     * Answers the takeover `requestId` of the thread `threadId` of any agent. The agent dock answers from
     * outside the chat. False when the thread no longer waits for that takeover.
     */
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
        // A joined server sends no event when a wait closes, so the list is read again.
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
          // After the turn ended, the message runs as the next turn. The refusal is old news (#3206).
          if (activeTurns()[agent.id] !== turnId) return;
          // A message that left the queue is in the turn already: an agent that steers each message
          // sent while it works can take it first.
          const delivery = queues()[agent.id]?.deliveries.find((item) => item.id === deliveryId);
          if (delivery && delivery.status !== "queued") return;
          // A routine run refuses the steer, and the queue row says why the message waits.
          if (isRoutineSteerRefusal(error)) return;
          appendUiError(agent.id, error, currentText().t("app.errorStatus.steer"), serverId);
        });
    }

    /**
     * For an agent whose provider cannot steer: puts a queued message first and stops the running
     * turn, so the message runs as the next turn. A message just sent is not in the queue snapshot
     * yet; it is last in the queue, so first is still the correct place.
     * Channel and messaging work that waits keeps its place before the message: it reserved the agent first.
     */
    function sendQueuedMessageNow(deliveryId: string) {
      const agent = activeAgent();
      const turnId = agent ? activeTurns()[agent.id] : null;
      if (!agent || !turnId) return;
      const queued = queuedDeliveriesInOrder(queues()[agent.id]);
      // An edited message keeps its place, and the queue starts nothing while it is first. A stop would
      // then end the turn and start nothing, so the message waits as it did.
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
        // A turn that ended in the meantime has nothing to stop: the message runs next already.
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

    /**
     * The ended turn whose Codex subagents still work, which Stop stops. Main can stop only Codex
     * subagents after their turn; a background subagent of another provider has no Stop (#11871).
     * Only the local host's runtime snapshot carries `subagentTurns`, so a joined server shows no
     * such Stop until the Team API sends it.
     */
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
    // A routine link opens only a routine the newest list has; a deleted one must not open.
    const activeRoutineIds = createMemo(() => {
      const snapshot = activeRoutineSnapshot();
      return snapshot?.current ? snapshot.routines.map((routine) => routine.id) : undefined;
    });
    // A chat card keeps the last list while a new one loads, so it does not blink.
    const activeRoutines = createMemo(() => activeRoutineSnapshot()?.routines);

    /**
     * The seed is `dynamicIslandCoordinator.serverState(serverId)`, which is
     * `undefined` for a server the coordinator has not seen. Each field falls
     * back to empty, exactly as `selectServer` did inline.
     */
    return {
      activeTurns,
      setActiveTurns,
      turnProgress,
      setTurnProgress,
      turnStepLines,
      setTurnStepLines,
      failedTurns,
      setFailedTurns,
      interruptedTurns,
      setInterruptedTurns,
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
