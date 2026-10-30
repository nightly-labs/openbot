import type { AgentModelId, AgentProviderRef, AgentReasoningEffort } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { AgentProfile } from "@openbot/ui/data";
import { type AgentActivityLabel, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import {
  agentActivityExitDelay,
  agentActivityExitDuration,
  agentActivityShowDelay,
} from "@openbot/ui/features/conversation/activity-timing";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { agentConversationKey } from "../conversation-keys";
import type { ConversationProps } from "../conversation-types";

/** A turn with nothing from its provider for this long shows that it waits, not that it works. */
const PROVIDER_SILENT_AFTER_MS = 60_000;
/** With no network, a turn with nothing from its provider for this long shows that it cannot get a reply. */
const OFFLINE_SILENT_AFTER_MS = 5_000;

export interface RenderedAgentActivity {
  activityId: string;
  agent: AgentProfile | undefined;
  detail: string | null;
  /** When the current line started, so the indicator can show how long a long step has run. */
  since: number;
  phase: "active" | "exiting";
  label: AgentActivityLabel;
}

/** The provider, account, model and effort that a turn started with. A change during the turn applies from the next one. */
export interface TurnRuntime {
  turnId: string;
  provider: AgentProviderRef;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  providerAccountId?: string | undefined;
}

export interface ActivityStoreDeps {
  props: ConversationProps;
  activeDeliveries: () => Array<{ id: string }>;
  agentActivityLabels: Map<string, { activityId: string; label: AgentActivityLabel }>;
  /** Kept on the controller, so a return to the chat during the turn keeps the first record. */
  turnRuntimes: Map<string, TurnRuntime>;
}

/** Changes when anything of the running turn arrives: text, a thought, a plan or subagent step, a progress line. */
export function runningTurnUpdate(props: ConversationProps): string | null {
  const turnId = props.activeTurnId;
  if (!turnId) return null;
  // The last line's id, not the count: a turn keeps only its newest lines, so the count stops at the limit.
  const parts: unknown[] = [turnId, props.activityDetail, props.turnStepLines?.[turnId]?.at(-1)?.id];
  // The turn's replies are at the end of the chat. An older page or a message from the user is not an
  // update from the provider, so the scan reads only the agent messages of this turn.
  for (let index = props.messages.length - 1; index >= 0; index -= 1) {
    const message = props.messages[index];
    if (message?.author !== "agent") continue;
    if (message.turnId !== turnId) break;
    parts.push(message.id, message.body.length, message.items?.length, message.items?.at(-1)?.length);
    if (message.plan) parts.push(JSON.stringify(message.plan));
    for (const subagent of message.subagents ?? [])
      parts.push(subagent.id, subagent.status, subagent.steps.at(-1)?.id, subagent.steps.at(-1)?.text.length);
  }
  return parts.join("\u0000");
}

export function createActivityStore(deps: ActivityStoreDeps) {
  const [renderedAgentActivity, setRenderedAgentActivity] = createSignal<RenderedAgentActivity | null>(null);
  const [agentActivitySpaceReserved, setAgentActivitySpaceReserved] = createSignal(false);
  const streamingAgentMessage = createMemo(() => {
    for (let index = deps.props.messages.length - 1; index >= 0; index -= 1) {
      const message = deps.props.messages[index];
      // A plan and the subagents stream for the whole turn. They are not the text that the turn writes now.
      if (message?.author === "agent" && message.streaming && message.kind !== "plan" && message.kind !== "subagents")
        return message;
    }
    return null;
  });
  /** The channel work of this very agent, which the chat has no turn of its own to show. */
  const heldByOwnChannelWork = createMemo(() => {
    const hold = deps.props.queue?.hold;
    if (!hold || hold.agentId !== deps.props.agent?.id) return null;
    return deps.props.activeTurnId ? null : hold;
  });
  const activeActivityId = createMemo(() => {
    const agentId = deps.props.agent?.id;
    if (!agentId) return null;
    const delivery = deps.activeDeliveries()[0];
    if (delivery) return `${agentId}:delivery:${delivery.id}`;
    if (deps.props.activeTurnId) return `${agentId}:turn:${deps.props.activeTurnId}`;
    // The agent is working, on a channel thread rather than this one. Its turn belongs to that
    // thread, so nothing above reports it, and without this the chat shows an idle agent that
    // answers nothing. Only the agent the work belongs to: the same channel assignment holds the
    // queue of every other agent, and those agents are waiting, not working.
    const hold = heldByOwnChannelWork();
    if (hold) return `${agentId}:hold:${hold.channelId}`;
    const streamingMessage = streamingAgentMessage();
    if (!streamingMessage) return null;
    const current = untrack(renderedAgentActivity);
    if (current?.agent?.id === agentId) return current.activityId;
    return `${agentId}:message:${streamingMessage.id}`;
  });
  const latestActiveCommentary = createMemo(() => {
    const activeTurnId = deps.props.activeTurnId;
    if (!activeTurnId) return null;
    const streamingMessage = streamingAgentMessage();
    if (streamingMessage && streamingMessage.itemType !== "commentary") return null;
    for (let index = deps.props.messages.length - 1; index >= 0; index -= 1) {
      const message = deps.props.messages[index];
      if (message?.turnId !== activeTurnId || message.itemType !== "commentary") continue;
      const items = message.items ?? [message.body];
      for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const detail = markdownPreviewText(items[itemIndex] ?? "");
        if (detail) return detail;
      }
    }
    return null;
  });
  const activeActivityDetail = createMemo(() => {
    // A card on screen stops the turn until the user acts, so the last tool step is not what happens now (#3707).
    if (deps.props.prompt) return currentText().t("chat.activity.waitingForAnswer");
    if (deps.props.approval) return currentText().t("chat.activity.waitingForApproval");
    if (deps.props.browserTakeover) return currentText().t("chat.activity.waitingForBrowser");
    const hold = heldByOwnChannelWork();
    if (hold) return currentText().t("chat.activity.workingIn", { channel: hold.channelName });
    const progress = deps.props.activityDetail?.trim();
    // The agent's own commentary is shown as plain text, without its Markdown marks (#3425); the host's
    // progress text is in the host's source English and is read here in the user's language.
    return latestActiveCommentary() ?? (progress ? currentText().sourceText(progress) : null);
  });
  const agentActivity = createMemo<"Working" | null>(() => (activeActivityId() ? "Working" : null));
  /**
   * The saved provider, account, model and effort when this chat first saw the running turn. The host does not
   * send the runtime of a turn, and a turn reads the saved settings when it starts.
   */
  const runningTurnRuntime = createMemo<TurnRuntime | null>(() => {
    const agent = deps.props.agent;
    if (!agent) return null;
    const key = agentConversationKey(deps.props.server?.id ?? "local", agent.id);
    const turnId = deps.props.activeTurnId;
    if (!turnId) {
      deps.turnRuntimes.delete(key);
      return null;
    }
    const known = deps.turnRuntimes.get(key);
    if (known?.turnId === turnId) return known;
    const runtime = untrack(() => ({
      turnId,
      provider: agent.provider,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      providerAccountId: agent.providerAccountId,
    }));
    deps.turnRuntimes.set(key, runtime);
    return runtime;
  });
  const activityLabel = createMemo<AgentActivityLabel | null>(() => {
    const agentId = deps.props.agent?.id;
    const activityId = activeActivityId();
    if (!agentId || !activityId) return null;
    const previous = deps.agentActivityLabels.get(agentId);
    if (previous?.activityId === activityId) return previous.label;
    const label = nextAgentActivityLabel(previous?.label);
    deps.agentActivityLabels.set(agentId, { activityId, label });
    return label;
  });
  let agentActivityShowTimer: number | undefined;
  let agentActivityExitDelayTimer: number | undefined;
  let agentActivityExitTimer: number | undefined;
  const clearAgentActivityShowTimer = () => {
    if (agentActivityShowTimer === undefined) return;
    window.clearTimeout(agentActivityShowTimer);
    agentActivityShowTimer = undefined;
  };
  const clearAgentActivityExitTimer = () => {
    if (agentActivityExitTimer === undefined) return;
    window.clearTimeout(agentActivityExitTimer);
    agentActivityExitTimer = undefined;
  };
  const clearAgentActivityExitDelayTimer = () => {
    if (agentActivityExitDelayTimer === undefined) return;
    window.clearTimeout(agentActivityExitDelayTimer);
    agentActivityExitDelayTimer = undefined;
  };
  createEffect(
    () => ({
      activityId: activeActivityId(),
      agent: deps.props.agent,
      label: activityLabel(),
    }),
    ({ activityId, agent, label }) => {
      clearAgentActivityShowTimer();
      clearAgentActivityExitDelayTimer();
      clearAgentActivityExitTimer();
      if (activityId && label) {
        const nextActivity = {
          activityId,
          agent,
          detail: untrack(activeActivityDetail),
          since: Date.now(),
          phase: "active" as const,
          label,
        };
        const current = untrack(renderedAgentActivity);
        if (current?.agent?.id === agent?.id) {
          setAgentActivitySpaceReserved(true);
          setRenderedAgentActivity(nextActivity);
          return;
        }
        const showDelay = agentActivityShowDelay();
        agentActivityShowTimer = window.setTimeout(() => {
          agentActivityShowTimer = undefined;
          if (untrack(activeActivityId) === activityId) {
            setAgentActivitySpaceReserved(true);
            setRenderedAgentActivity({ ...nextActivity, detail: untrack(activeActivityDetail) });
          }
        }, showDelay);
        return;
      }

      const current = untrack(renderedAgentActivity);
      if (!current) return;
      if (current.agent?.id !== agent?.id) {
        setRenderedAgentActivity(null);
        return;
      }

      const exitActivityId = current.activityId;
      const beginExit = () => {
        agentActivityExitDelayTimer = undefined;
        if (untrack(activeActivityId)) return;
        setRenderedAgentActivity((latest) =>
          latest?.activityId === exitActivityId ? { ...latest, phase: "exiting" } : latest,
        );
        const exitDuration = agentActivityExitDuration();
        agentActivityExitTimer = window.setTimeout(() => {
          agentActivityExitTimer = undefined;
          setRenderedAgentActivity((latest) =>
            latest?.activityId === exitActivityId && latest.phase === "exiting" ? null : latest,
          );
        }, exitDuration);
      };
      const exitDelay = agentActivityExitDelay();
      if (exitDelay === 0) beginExit();
      else agentActivityExitDelayTimer = window.setTimeout(beginExit, exitDelay);
    },
  );

  createEffect(
    () => ({ activityId: activeActivityId(), detail: activeActivityDetail() }),
    ({ activityId, detail }) => {
      if (!activityId) return;
      setRenderedAgentActivity((current) =>
        current?.activityId === activityId && current.detail !== detail
          ? { ...current, detail, since: Date.now() }
          : current,
      );
    },
  );
  /**
   * What the running turn of this agent's chat waits for, when it waits for the provider rather than
   * the user. The renderer does not know whether a tool step is open, so a long silent tool step
   * also counts as silence: what the user reads is only that nothing came, not why.
   */
  const waitsForProvider = createMemo(
    () =>
      Boolean(deps.props.agent && deps.props.activeTurnId) &&
      !deps.props.prompt &&
      !deps.props.approval &&
      !deps.props.browserTakeover,
  );
  const [lastTurnUpdateAt, setLastTurnUpdateAt] = createSignal(Date.now());
  createEffect(
    () => runningTurnUpdate(deps.props),
    () => {
      setLastTurnUpdateAt(Date.now());
    },
  );
  const [clock, setClock] = createSignal(Date.now());
  createEffect(waitsForProvider, (waiting) => {
    if (!waiting) return;
    // A wait for the user's answer is not silence, so the count starts again after it.
    setLastTurnUpdateAt(Date.now());
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  });
  const [online, setOnline] = createSignal(navigator.onLine);
  const updateOnline = () => setOnline(navigator.onLine);
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  /** Whole minutes with nothing from the provider, from the first minute; else null. */
  const providerSilentMinutes = createMemo(() => {
    if (!waitsForProvider()) return null;
    const minutes = Math.floor((clock() - lastTurnUpdateAt()) / PROVIDER_SILENT_AFTER_MS);
    return minutes >= 1 ? minutes : null;
  });
  /**
   * `navigator.onLine` is false only when the computer has no network at all, so an offline reading
   * with a few seconds of silence shows at once. A local model can still reply with no network, and
   * its updates keep the notice away. A network with no internet still reads online, and shows as silence.
   */
  const providerOffline = createMemo(
    () => waitsForProvider() && !online() && clock() - lastTurnUpdateAt() >= OFFLINE_SILENT_AFTER_MS,
  );
  onCleanup(() => {
    clearAgentActivityShowTimer();
    clearAgentActivityExitDelayTimer();
    clearAgentActivityExitTimer();
    window.removeEventListener("online", updateOnline);
    window.removeEventListener("offline", updateOnline);
  });

  return {
    renderedAgentActivity,
    setRenderedAgentActivity,
    agentActivitySpaceReserved,
    setAgentActivitySpaceReserved,
    streamingAgentMessage,
    activeActivityId,
    activeActivityDetail,
    agentActivity,
    activityLabel,
    runningTurnRuntime,
    providerSilentMinutes,
    providerOffline,
  };
}
