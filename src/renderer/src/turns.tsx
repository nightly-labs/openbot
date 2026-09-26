import type { AgentApproval, AgentEvent, QueueSnapshot, RoutineFields } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { useAnsweredPrompts } from "./answered-prompts";
import { seededAttentionPrompts } from "./features/agents/agent-runtime-snapshot";
import { useAgents } from "./features/agents/agents-context";
import { agentConversationKey, promptRequestKey } from "./features/conversation/conversation-keys";
import { useDynamicIsland } from "./features/dynamic-island/dynamic-island-context";
import { useServers } from "./features/servers/servers-context";
import { createScopeGuard } from "./scope-lifetime";
import { createSimpleContext } from "./simple-context";
import { turnsPort } from "./turns-port";

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;
/** `current` is false while a new list loads. */
type RoutineSnapshot = { routines: RoutineFields[]; current: boolean };
type BrowserTakeoverEvent = Extract<AgentEvent, { type: "browser-takeover-requested" }>;

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
    const { activeServerId } = useServers();
    const { dynamicIslandCoordinator } = useDynamicIsland();
    const { activeAgent, activeAgentId, agentList, agentStatus, appendUiError } = useAgents();
    const scopeIsCurrent = createScopeGuard();

    // The layer-2 seed: what this server was doing the last time it was open. The scope is keyed
    // on the server, so its id and the seed are read once.
    const scopeServerId = untrack(activeServerId);
    const seed = dynamicIslandCoordinator.serverState(scopeServerId);
    const [activeTurns, setActiveTurns] = createSignal<Record<string, string | null>>(seed?.activeTurns ?? {});
    const [turnProgress, setTurnProgress] = createSignal<
      Record<string, { turnId: string; detail: string } | undefined>
    >(seed?.turnProgress ?? {});
    const [failedTurns, setFailedTurns] = createSignal<Record<string, string | undefined>>(seed?.failedTurns ?? {});
    const [queues, setQueues] = createSignal<Record<string, QueueSnapshot>>(seed?.queues ?? {});
    const [routinesByConversation, setRoutinesByConversation] = createSignal<
      Record<string, RoutineSnapshot | undefined>
    >({});
    const {
      presentedPromptResolutions,
      setPresentedPromptResolutions,
      submittedPromptRequests,
      setSubmittedPromptRequests,
    } = useAnsweredPrompts().promptMarkersFor(scopeServerId);
    const [pendingPrompts, setPendingPrompts] = createSignal<
      Record<string, PromptEvent | BrowserTakeoverEvent | undefined>
    >(
      untrack(() =>
        seededAttentionPrompts(seed?.pendingPrompts, presentedPromptResolutions(), submittedPromptRequests()),
      ),
    );
    const [pendingApprovals, setPendingApprovals] = createSignal<Record<string, AgentApproval | undefined>>(
      seed?.pendingApprovals ?? {},
    );
    const completedTurnByAgent = new Map<string, string>();
    const queueSnapshotRequests = new Map<string, number>();
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

    function loadQueue(agentId: string, serverId: string): void {
      const queueRequest = (queueSnapshotRequests.get(agentId) ?? 0) + 1;
      queueSnapshotRequests.set(agentId, queueRequest);
      void turnsPort()
        .agent.listQueue(agentId)
        .then((queue) => {
          if (!scopeIsCurrent() || queueSnapshotRequests.get(agentId) !== queueRequest) return;
          setQueues((current) => ({ ...current, [agentId]: queue }));
        })
        .catch((error) => {
          if (scopeIsCurrent()) appendUiError(agentId, error, currentText().t("app.errorStatus.queueLoad"), serverId);
        });
    }

    createEffect(
      () => ({ agentId: activeAgentId(), agentPhase: agentStatus().phase, serverId: activeServerId() }),
      ({ agentId, serverId }) => {
        if (agentId) loadQueue(agentId, serverId);
      },
    );

    // The active-agent load above misses everyone else. A routine mark needs each agent's real
    // queue sender, which a runtime snapshot does not carry.
    createEffect(
      () => ({
        agentIds: agentList()
          .map((agent) => agent.id)
          .join("\0"),
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
        for (const agentId of next.agentIds.split("\0")) loadQueue(agentId, next.serverId);
      },
    );

    async function answerPrompt(answers: Record<string, string[]>): Promise<boolean> {
      const agent = activeAgent();
      const prompt = agent ? pendingPrompts()[agent.id] : undefined;
      if (!agent || prompt?.type !== "prompt") return false;
      return submitPromptAnswers(agent.id, prompt, answers);
    }

    async function submitPromptAnswers(
      agentId: string,
      prompt: PromptEvent,
      answers: Record<string, string[]>,
    ): Promise<boolean> {
      const serverId = activeServerId();
      const analytics = desktopAnalytics.scope();
      setSubmittedPromptRequests((current) => ({
        ...current,
        [agentId]: promptRequestKey(prompt.turnId, prompt.requestId) ?? undefined,
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
        setSubmittedPromptRequests((current) => ({ ...current, [agentId]: undefined }));
        analytics.track("agent_input_action", {
          kind: "prompt",
          decision: "answered",
          result: "failed",
          failure_code: "response_failed",
        });
        appendUiError(agentId, error, currentText().t("app.errorStatus.answer"), serverId);
        return false;
      }
    }

    async function respondToApprovalRequest(
      agentId: string,
      requestId: string | number,
      decision: "accept" | "decline",
    ): Promise<boolean> {
      const serverId = activeServerId();
      const approval = pendingApprovals()[agentId];
      if (!approval || String(approval.requestId) !== String(requestId)) return false;
      const analytics = desktopAnalytics.scope();
      try {
        await turnsPort().agent.respondToApproval({
          requestId: approval.requestId,
          decision,
        });
        setPendingApprovals((current) => ({ ...current, [agentId]: undefined }));
        analytics.track("agent_input_action", { kind: "approval", decision, result: "succeeded" });
        return true;
      } catch (error) {
        analytics.track("agent_input_action", {
          kind: "approval",
          decision,
          result: "failed",
          failure_code: "response_failed",
        });
        appendUiError(agentId, error, currentText().t("app.errorStatus.approval"), serverId);
        return false;
      }
    }

    async function respondToApproval(decision: "accept" | "decline"): Promise<boolean> {
      const agent = activeAgent();
      const approval = agent ? pendingApprovals()[agent.id] : undefined;
      if (!agent || !approval) return false;
      return respondToApprovalRequest(agent.id, approval.requestId, decision);
    }

    async function respondToBrowserTakeover(decision: "complete" | "cancel"): Promise<boolean> {
      const agent = activeAgent();
      const event = agent ? pendingPrompts()[agent.id] : undefined;
      if (!agent || event?.type !== "browser-takeover-requested") return false;
      const serverId = activeServerId();
      try {
        await turnsPort().agent.respondToBrowserTakeover({ requestId: event.request.requestId, decision });
        setPendingPrompts((current) => ({ ...current, [agent.id]: undefined }));
        return true;
      } catch (error) {
        appendUiError(agent.id, error, currentText().t("app.errorStatus.browserTakeover"), serverId);
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
          appendUiError(agent.id, error, currentText().t("app.errorStatus.steer"), serverId);
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

    function stopActiveTurn() {
      const agent = activeAgent();
      const turnId = agent ? activeTurns()[agent.id] : null;
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
      failedTurns,
      setFailedTurns,
      queues,
      setQueues,
      routinesByConversation,
      pendingPrompts,
      setPendingPrompts,
      presentedPromptResolutions,
      setPresentedPromptResolutions,
      submittedPromptRequests,
      setSubmittedPromptRequests,
      pendingApprovals,
      setPendingApprovals,
      completedTurnByAgent,
      queueSnapshotRequests,
      activeQueue,
      activeRoutineIds,
      activeRoutines,
      refreshRoutineIds,
      answerPrompt,
      respondToApproval,
      respondToApprovalRequest,
      respondToBrowserTakeover,
      cancelQueuedMessage,
      steerQueuedMessage,
      updateQueuedMessage,
      reorderQueue,
      stopActiveTurn,
    };
  },
});

export const TurnsProvider = Turns.provider;
export const useTurns = Turns.use;
