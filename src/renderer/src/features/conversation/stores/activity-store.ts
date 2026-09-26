import type { AgentProfile } from "@openbot/ui/data";
import { type AgentActivityLabel, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import {
  agentActivityExitDelay,
  agentActivityExitDuration,
  agentActivityShowDelay,
} from "@openbot/ui/features/conversation/activity-timing";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { ConversationProps } from "../conversation-types";

export interface RenderedAgentActivity {
  activityId: string;
  agent: AgentProfile | undefined;
  detail: string | null;
  phase: "active" | "exiting";
  label: AgentActivityLabel;
}

export interface ActivityStoreDeps {
  props: ConversationProps;
  activeDeliveries: () => Array<{ id: string }>;
  agentActivityLabels: Map<string, { activityId: string; label: AgentActivityLabel }>;
}

export function createActivityStore(deps: ActivityStoreDeps) {
  const [renderedAgentActivity, setRenderedAgentActivity] = createSignal<RenderedAgentActivity | null>(null);
  const [agentActivitySpaceReserved, setAgentActivitySpaceReserved] = createSignal(false);
  const streamingAgentMessage = createMemo(() => {
    for (let index = deps.props.messages.length - 1; index >= 0; index -= 1) {
      const message = deps.props.messages[index];
      if (message?.author === "agent" && message.streaming) return message;
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
        const detail = items[itemIndex]?.trim();
        if (detail) return detail;
      }
    }
    return null;
  });
  const activeActivityDetail = createMemo(() => {
    const hold = heldByOwnChannelWork();
    if (hold) return currentText().t("chat.activity.workingIn", { channel: hold.channelName });
    return latestActiveCommentary() ?? (deps.props.activityDetail?.trim() || null);
  });
  const agentActivity = createMemo<"Working" | null>(() => (activeActivityId() ? "Working" : null));
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
        current?.activityId === activityId && current.detail !== detail ? { ...current, detail } : current,
      );
    },
  );
  onCleanup(() => {
    clearAgentActivityShowTimer();
    clearAgentActivityExitDelayTimer();
    clearAgentActivityExitTimer();
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
  };
}
