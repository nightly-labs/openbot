import type { QueueDeliveryStatus } from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  Button,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  CirclePause,
  Clock3,
  DropdownMenu,
  Globe2,
  LoaderCircle,
  Marker,
  MarkerContent,
  MarkerIcon,
  MessageCircle,
  Play,
  Puzzle,
  TriangleAlert,
  X,
} from "@openbot/ui";
import { Dynamic } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import type {
  AgentProfile,
  ChatActionMarkerModel,
  ChatActionMarkerStatus,
  RoutineRunMarkerTransition,
} from "../../data";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import { formatChatTimestamp } from "./chat-timestamp";

interface ChatActionMarkerProps {
  marker: ChatActionMarkerModel;
  agents: AgentProfile[];
  announce?: boolean;
  onOpenSkill?: (skill: { skillId: string }) => void;
  routineAvailable?: boolean;
  onSelectAgent: (agentId: string) => void;
  onOpenRoutine?: (routine: { routineId: string; name: string }) => void;
  onOpenHostedSite?: (url: string) => void;
}

const STATUS_LABELS = {
  queued: "chat.marker.status.queued",
  "in-progress": "chat.marker.status.inProgress",
  "needs-attention": "chat.marker.status.needsAttention",
  completed: "chat.marker.status.completed",
  partial: "chat.marker.status.partial",
  failed: "chat.marker.status.failed",
  interrupted: "chat.marker.status.interrupted",
  cancelled: "chat.marker.status.cancelled",
  unavailable: "chat.marker.status.unavailable",
} as const satisfies Record<ChatActionMarkerStatus, AppTextKey>;

export function ChatActionMarker(props: ChatActionMarkerProps) {
  const { t, format } = useText();
  const label = () => markerLabel(props.marker, t);
  const [historyExpanded, setHistoryExpanded] = createSignal(false);
  /* The list leaves with an animation of its own, so it stays mounted until that
     animation ends. Without motion there is nothing to wait for. */
  const [historyMounted, setHistoryMounted] = createSignal(false);
  const toggleHistory = (): void => {
    const opening = !historyExpanded();
    setHistoryExpanded(opening);
    if (opening || prefersReducedMotion()) setHistoryMounted(opening);
  };
  const routineHistory = () => (props.marker.kind === "routine-run" ? props.marker.previousTransitions : undefined);
  const historyId = () =>
    props.marker.kind === "routine-run" ? `routine-run-history-${props.marker.runId}` : undefined;
  return (
    <Marker
      class={`chat-action-marker chat-action-marker-${props.marker.kind}`}
      role={props.announce ? "status" : "group"}
      aria-live={props.announce ? "polite" : "off"}
      aria-label={markerAccessibleLabel(props.marker, props.agents, t)}
    >
      <div class="chat-action-marker-summary">
        <MarkerContent class="chat-action-marker-content">
          <span class="chat-action-marker-label">{label()}</span>
          <Show when={props.marker.kind === "agent-message" && props.marker}>
            {(marker) => <AgentTarget marker={marker()} agents={props.agents} onSelectAgent={props.onSelectAgent} />}
          </Show>
          <Show when={props.marker.kind === "routine-lifecycle" && props.marker}>
            {(marker) => (
              <RoutineTarget
                routineId={marker().routineId}
                routineName={marker().routineName}
                available={marker().action !== "deleted" && props.routineAvailable !== false}
                onOpenRoutine={props.onOpenRoutine}
              />
            )}
          </Show>
          <Show when={props.marker.kind === "routine-run" && props.marker}>
            {(marker) => (
              <RoutineTarget
                routineId={marker().routineId}
                routineName={marker().routineName}
                icon={statusIcon(routineMarkerStatus(marker().status))}
                status={routineMarkerStatus(marker().status)}
                available={props.routineAvailable !== false}
                onOpenRoutine={props.onOpenRoutine}
              />
            )}
          </Show>
          <Show when={props.marker.kind === "channel-routing" && props.marker}>
            {(marker) => (
              <AgentButton
                agent={props.agents.find((agent) => agent.id === marker().agentId)}
                fallbackId={marker().agentId}
                onSelectAgent={props.onSelectAgent}
              />
            )}
          </Show>
          <Show when={props.marker.kind === "hosted-site" && props.marker}>
            {(marker) => <HostedSiteTarget marker={marker()} onOpenHostedSite={props.onOpenHostedSite} />}
          </Show>
          <Show when={props.marker.kind === "skill-lifecycle" && props.marker}>
            {(marker) => (
              <ActionTarget
                available={Boolean(props.onOpenSkill)}
                actionLabel={t("chat.marker.openSkill", { name: marker().skillName })}
                name={marker().skillName}
                icon={Puzzle}
                onOpen={props.onOpenSkill ? () => props.onOpenSkill?.({ skillId: marker().skillId }) : undefined}
              />
            )}
          </Show>
          <time class="chat-action-marker-time" datetime={props.marker.timestamp}>
            {formatMarkerTime(props.marker.timestamp, t, format)}
          </time>
          <Show when={(routineHistory()?.length ?? 0) > 0}>
            <Button
              variant="ghost"
              size="icon-xs"
              class="chat-action-history-toggle"
              type="button"
              aria-expanded={historyExpanded() ? "true" : "false"}
              aria-controls={historyId()}
              aria-label={
                props.marker.kind === "routine-run"
                  ? historyExpanded()
                    ? t("chat.marker.hideHistory", { name: props.marker.routineName })
                    : t("chat.marker.showHistory", { name: props.marker.routineName })
                  : historyExpanded()
                    ? t("chat.marker.hideRoutineHistory")
                    : t("chat.marker.showRoutineHistory")
              }
              onClick={toggleHistory}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </Show>
        </MarkerContent>
        <Show when={historyMounted() && routineHistory()}>
          {(transitions) => (
            <RoutineRunHistory
              id={historyId()}
              transitions={transitions()}
              open={historyExpanded()}
              onClosed={() => setHistoryMounted(historyExpanded())}
            />
          )}
        </Show>
      </div>
    </Marker>
  );
}

function RoutineRunHistory(props: {
  id: string | undefined;
  transitions: RoutineRunMarkerTransition[];
  open: boolean;
  onClosed: () => void;
}) {
  const { t, format } = useText();
  return (
    <div
      class="chat-action-history-panel"
      data-state={props.open ? "open" : "closed"}
      inert={!props.open}
      /* The collapse is the last part of the exit, so the panel leaves on its
         own animation's end. The rows' animations bubble through here and end
         earlier, so only this element's own end counts. */
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !props.open) props.onClosed();
      }}
    >
      <div class="chat-action-history-clip">
        <ol id={props.id} class="chat-action-history" aria-label={t("chat.marker.earlierStates")}>
          <For each={props.transitions}>
            {(transition, index) => {
              const previous = () => props.transitions[index() - 1];
              const status = () => routineMarkerStatus(transition.status);
              return (
                <li class={`chat-action-history-entry chat-action-history-status-${status()}`}>
                  <MarkerIcon class="chat-action-history-icon">
                    <Dynamic component={routineHistoryIcon(transition.status)} aria-hidden="true" />
                  </MarkerIcon>
                  <span>{routineHistoryLabel(transition.status, previous()?.status, t)}</span>
                  <time datetime={transition.timestamp}>{formatMarkerTime(transition.timestamp, t, format)}</time>
                </li>
              );
            }}
          </For>
        </ol>
      </div>
    </div>
  );
}

function HostedSiteTarget(props: {
  marker: Extract<ChatActionMarkerModel, { kind: "hosted-site" }>;
  onOpenHostedSite?: (url: string) => void;
}) {
  const { t } = useText();
  const name = () => props.marker.hostname ?? props.marker.title;
  const status = () => hostedSiteMarkerStatus(props.marker.status);
  const interactive = () =>
    props.marker.status === "succeeded" &&
    props.marker.action !== "delete" &&
    Boolean(props.marker.url) &&
    Boolean(props.onOpenHostedSite);
  const content = (
    <>
      <MarkerIcon>
        <Dynamic component={hostedSiteIcon(props.marker.status)} aria-hidden="true" />
      </MarkerIcon>
      <span class="chat-action-target-name">{name()}</span>
    </>
  );
  return (
    <Show
      when={interactive()}
      fallback={<span class={`chat-action-target chat-action-target-status-${status()}`}>{content}</span>}
    >
      <Button
        variant="ghost"
        type="button"
        class={`chat-action-target chat-action-target-status-${status()}`}
        aria-label={t("chat.marker.openSite", { name: name() })}
        onClick={() => {
          if (props.marker.url) props.onOpenHostedSite?.(props.marker.url);
        }}
      >
        {content}
      </Button>
    </Show>
  );
}

function AgentTarget(props: {
  marker: Extract<ChatActionMarkerModel, { kind: "agent-message" }>;
  agents: AgentProfile[];
  onSelectAgent: (agentId: string) => void;
}) {
  const { t } = useText();
  const source = () => props.agents.find((agent) => agent.id === props.marker.sourceAgentId);
  const recipients = () => props.marker.targetDeliveries;
  const singleRecipient = () => {
    const delivery = recipients()[0];
    return delivery ? props.agents.find((agent) => agent.id === delivery.agentId) : undefined;
  };
  return (
    <Show
      when={props.marker.direction === "outgoing"}
      fallback={
        <AgentButton agent={source()} fallbackId={props.marker.sourceAgentId} onSelectAgent={props.onSelectAgent} />
      }
    >
      <Show
        when={recipients().length > 1}
        fallback={
          <AgentButton
            agent={singleRecipient()}
            fallbackId={recipients()[0]?.agentId}
            onSelectAgent={props.onSelectAgent}
          />
        }
      >
        <DropdownMenu.Root placement="bottom" gutter={8} modal={false}>
          <DropdownMenu.Trigger
            class="chat-action-target chat-action-agent-menu-trigger"
            style={agentTargetsStyle(
              recipients().map((delivery) => props.agents.find((agent) => agent.id === delivery.agentId)),
            )}
          >
            <span class="chat-action-avatar-stack" aria-hidden="true">
              <For each={recipients().slice(0, 3)}>
                {(delivery) => (
                  <AgentAvatar
                    agent={props.agents.find((agent) => agent.id === delivery.agentId)}
                    class="chat-action-agent-avatar"
                  />
                )}
              </For>
            </span>
            <span>{t("chat.marker.agentCount", { count: recipients().length })}</span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content class="chat-action-agent-menu">
            <For each={recipients()}>
              {(delivery) => {
                const agent = () => props.agents.find((candidate) => candidate.id === delivery.agentId);
                return (
                  <DropdownMenu.Item
                    class="chat-action-agent-menu-item"
                    disabled={!agent()}
                    onSelect={() => props.onSelectAgent(delivery.agentId)}
                  >
                    <AgentAvatar agent={agent()} class="chat-action-agent-avatar" />
                    <span class="chat-action-agent-menu-name">
                      {agent()?.name ?? t("chat.marker.unavailableAgent")}
                    </span>
                    <span class="chat-action-agent-menu-status">{deliveryStatusLabel(delivery.status, t)}</span>
                  </DropdownMenu.Item>
                );
              }}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Show>
    </Show>
  );
}

function AgentButton(props: {
  agent: AgentProfile | undefined;
  fallbackId: string | undefined;
  onSelectAgent: (agentId: string) => void;
}) {
  const { t } = useText();
  return (
    <Show
      when={props.agent}
      fallback={
        <span class="chat-action-target chat-action-target-unavailable" title={props.fallbackId}>
          <AgentAvatar class="chat-action-agent-avatar" />
          <span>{t("chat.marker.unavailableAgent")}</span>
        </span>
      }
    >
      {(agent) => (
        <Button
          variant="ghost"
          type="button"
          class="chat-action-target"
          style={agentTargetStyle(agent())}
          aria-label={t("chat.marker.openChat", { name: agent().name })}
          onClick={() => props.onSelectAgent(agent().id)}
        >
          <AgentAvatar agent={agent()} class="chat-action-agent-avatar" />
          <span>{agent().name}</span>
        </Button>
      )}
    </Show>
  );
}

function RoutineTarget(props: {
  routineId: string;
  routineName: string;
  icon?: ReturnType<typeof statusIcon>;
  status?: ChatActionMarkerStatus;
  available: boolean;
  onOpenRoutine?: (routine: { routineId: string; name: string }) => void;
}) {
  const { t } = useText();
  return (
    <ActionTarget
      name={props.routineName}
      icon={props.icon ?? CalendarClock}
      status={props.status}
      available={props.available}
      actionLabel={t("chat.marker.openRoutine", { name: props.routineName })}
      onOpen={
        props.onOpenRoutine
          ? () => props.onOpenRoutine?.({ routineId: props.routineId, name: props.routineName })
          : undefined
      }
    />
  );
}

function ActionTarget(props: {
  name: string;
  icon: ReturnType<typeof statusIcon>;
  status?: ChatActionMarkerStatus;
  available: boolean;
  actionLabel: string;
  onOpen?: () => void;
}) {
  const { t } = useText();
  const interactive = () => props.available && Boolean(props.onOpen);
  const content = (
    <>
      <MarkerIcon>
        <Dynamic component={props.icon} aria-hidden="true" />
      </MarkerIcon>
      <span class="chat-action-target-name">{props.name}</span>
    </>
  );
  return (
    <Show
      when={interactive()}
      fallback={
        <span
          class={`chat-action-target chat-action-target-unavailable${props.status ? ` chat-action-target-status-${props.status}` : ""}`}
        >
          {content}
          <span class="sr-only">{t("chat.marker.unavailable")}</span>
        </span>
      }
    >
      <Button
        variant="ghost"
        type="button"
        class={`chat-action-target${props.status ? ` chat-action-target-status-${props.status}` : ""}`}
        aria-label={props.actionLabel}
        onClick={() => props.onOpen?.()}
      >
        {content}
      </Button>
    </Show>
  );
}

const SKILL_ACTION_LABELS = {
  created: "chat.marker.skill.created",
  revised: "chat.marker.skill.revised",
  installed: "chat.marker.skill.installed",
} as const satisfies Record<Extract<ChatActionMarkerModel, { kind: "skill-lifecycle" }>["action"], AppTextKey>;

function markerLabel(marker: ChatActionMarkerModel, t: AppTranslate): string {
  if (marker.kind === "unavailable") return marker.label;
  if (marker.kind === "skill-lifecycle") return t(SKILL_ACTION_LABELS[marker.action]);
  if (marker.kind === "agent-message") {
    if (marker.expectsReply)
      return marker.direction === "outgoing" ? t("chat.marker.messaged") : t("chat.marker.messageFrom");
    return marker.direction === "outgoing" ? t("chat.marker.informed") : t("chat.marker.updateFrom");
  }
  if (marker.kind === "channel-routing")
    return marker.action === "assigned" ? t("chat.marker.assignedTo") : t("chat.marker.continuingWith");
  if (marker.kind === "routine-lifecycle") {
    return marker.action === "created"
      ? t("chat.marker.routine.created")
      : marker.action === "updated"
        ? t("chat.marker.routine.updated")
        : t("chat.marker.routine.deleted");
  }
  if (marker.kind === "hosted-site") {
    if (marker.action === "publish") {
      if (marker.status === "running") return t("chat.marker.site.deploying");
      if (marker.status === "succeeded") return t("chat.marker.site.published");
      if (marker.status === "failed") return t("chat.marker.site.deployFailed");
      if (marker.status === "interrupted") return t("chat.marker.site.deployInterrupted");
      return t("chat.marker.site.deployCancelled");
    }
    if (marker.action === "replace") {
      if (marker.status === "running") return t("chat.marker.site.updating");
      if (marker.status === "succeeded") return t("chat.marker.site.updated");
      if (marker.status === "failed") return t("chat.marker.site.updateFailed");
      if (marker.status === "interrupted") return t("chat.marker.site.updateInterrupted");
      return t("chat.marker.site.updateCancelled");
    }
    if (marker.status === "running") return t("chat.marker.site.deleting");
    if (marker.status === "succeeded") return t("chat.marker.site.deleted");
    if (marker.status === "failed") return t("chat.marker.site.deleteFailed");
    if (marker.status === "interrupted") return t("chat.marker.site.deleteInterrupted");
    return t("chat.marker.site.deleteCancelled");
  }
  if (marker.status === "queued") return t("chat.marker.run.invoked");
  if (marker.status === "running") return t("chat.marker.run.running");
  if (marker.status === "needs-attention") return t("chat.marker.run.needsAttention");
  if (marker.status === "succeeded") return t("chat.marker.run.completed");
  if (marker.status === "failed") return t("chat.marker.run.failed");
  if (marker.status === "interrupted") return t("chat.marker.run.interrupted");
  return t("chat.marker.run.cancelled");
}

function agentTargetStyle(agent: AgentProfile | undefined): string | undefined {
  return agent ? `--chat-action-agent-color: ${avatarHeadColor(agent.avatarSeed, agent.avatarHue)}` : undefined;
}

function agentTargetsStyle(agents: Array<AgentProfile | undefined>): string | undefined {
  const colors = agents.flatMap((agent) => (agent ? [avatarHeadColor(agent.avatarSeed, agent.avatarHue)] : []));
  const mixedColor = colors.reduce<string | undefined>((mix, color, index) => {
    if (!mix) return color;
    const previousColorsWeight = Math.round((index / (index + 1)) * 10_000) / 100;
    return `color-mix(in oklab, ${mix} ${previousColorsWeight}%, ${color})`;
  }, undefined);
  return mixedColor ? `--chat-action-agent-color: ${mixedColor}` : undefined;
}

function markerAccessibleLabel(marker: ChatActionMarkerModel, agents: AgentProfile[], t: AppTranslate): string {
  const label = markerLabel(marker, t);
  if (marker.kind === "unavailable") return label;
  if (marker.kind === "skill-lifecycle") return t("chat.marker.accessible.named", { label, name: marker.skillName });
  const unavailable = t("chat.marker.unavailableAgent");
  if (marker.kind === "agent-message") {
    const agent =
      marker.direction === "incoming"
        ? (agents.find((candidate) => candidate.id === marker.sourceAgentId)?.name ?? unavailable)
        : marker.targetDeliveries.length === 1
          ? (agents.find((candidate) => candidate.id === marker.targetDeliveries[0]?.agentId)?.name ?? unavailable)
          : t("chat.marker.agentCount", { count: marker.targetDeliveries.length });
    return t("chat.marker.accessible.message", { label, agent, status: t(STATUS_LABELS[marker.status]) });
  }
  if (marker.kind === "channel-routing") {
    const agent = agents.find((candidate) => candidate.id === marker.agentId)?.name ?? unavailable;
    return t("chat.marker.accessible.routing", { label, agent });
  }
  if (marker.kind === "hosted-site")
    return t("chat.marker.accessible.named", { label, name: marker.hostname ?? marker.title });
  return t("chat.marker.accessible.named", { label, name: marker.routineName });
}

function hostedSiteMarkerStatus(
  status: Extract<ChatActionMarkerModel, { kind: "hosted-site" }>["status"],
): ChatActionMarkerStatus {
  if (status === "running") return "in-progress";
  if (status === "succeeded") return "completed";
  return status;
}

function hostedSiteIcon(status: Extract<ChatActionMarkerModel, { kind: "hosted-site" }>["status"]) {
  if (status === "running") return LoaderCircle;
  if (status === "succeeded") return Globe2;
  if (status === "failed") return X;
  return CirclePause;
}

function routineMarkerStatus(
  status: Extract<ChatActionMarkerModel, { kind: "routine-run" }>["status"],
): ChatActionMarkerStatus {
  if (status === "running") return "in-progress";
  if (status === "succeeded") return "completed";
  return status;
}

function routineHistoryLabel(
  status: RoutineRunMarkerTransition["status"],
  previousStatus: RoutineRunMarkerTransition["status"] | undefined,
  t: AppTranslate,
) {
  if (status === "queued") return t("chat.marker.history.invoked");
  if (status === "running")
    return previousStatus === "needs-attention" ? t("chat.marker.history.resumed") : t("chat.marker.history.started");
  if (status === "needs-attention") return t("chat.marker.history.neededAttention");
  if (status === "succeeded") return t("chat.marker.history.completed");
  if (status === "failed") return t("chat.marker.history.failed");
  if (status === "interrupted") return t("chat.marker.history.interrupted");
  return t("chat.marker.history.cancelled");
}

function routineHistoryIcon(status: RoutineRunMarkerTransition["status"]) {
  if (status === "queued") return Clock3;
  if (status === "running") return Play;
  if (status === "needs-attention") return TriangleAlert;
  if (status === "succeeded") return CircleCheck;
  if (status === "failed") return X;
  return CirclePause;
}

function deliveryStatusLabel(status: QueueDeliveryStatus, t: AppTranslate): string {
  if (status === "starting" || status === "running") return t(STATUS_LABELS["in-progress"]);
  return t(STATUS_LABELS[status]);
}

function statusIcon(status: ChatActionMarkerStatus) {
  if (status === "completed") return CircleCheck;
  if (status === "failed") return X;
  if (status === "cancelled" || status === "interrupted") return CirclePause;
  if (status === "partial" || status === "needs-attention" || status === "unavailable") return TriangleAlert;
  if (status === "in-progress") return LoaderCircle;
  if (status === "queued") return Clock3;
  return MessageCircle;
}

function formatMarkerTime(value: string, t: AppTranslate, format: AppFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("chat.marker.unknownTime");
  return formatChatTimestamp(date, format);
}
