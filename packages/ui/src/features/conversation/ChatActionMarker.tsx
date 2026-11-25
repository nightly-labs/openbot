import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import type { QueueDeliveryStatus, WithdrawFeedbackStatus } from "@openbot/contracts/ipc";
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
  LogIn,
  Marker,
  MarkerContent,
  MarkerIcon,
  MessageCircle,
  Play,
  Puzzle,
  TriangleAlert,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Dynamic } from "@solidjs/web";
import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import type {
  AgentMessageMarkerModel,
  AgentProfile,
  ChatActionMarkerModel,
  ChatActionMarkerStatus,
  RoutineRunMarkerTransition,
} from "../../data";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { AgentInstructionsFileCalls } from "./AgentInstructionsView";
import { formatChatTimestamp } from "./chat-timestamp";
import { FeedbackSentCard } from "./FeedbackSentCard";
import { InstructionsChangeActions } from "./InstructionsChangeActions";
import { MAIN_THREAD_ID } from "./threads/thread-types";

interface ChatActionMarkerProps {
  marker: ChatActionMarkerModel;
  agents: AgentProfile[];
  announce?: boolean | undefined;
  onOpenSkill?: ((skill: { skillId: string }) => void) | undefined;
  routineAvailable?: boolean | undefined;
  onSelectAgent: (agentId: string, tabId?: string) => void;
  onOpenRoutine?: ((routine: { routineId: string; name: string }) => void) | undefined;
  openRoutineThread?: ((routineId: string) => (() => void) | undefined) | undefined;
  routineRunFailure?: ((runId: string) => string | undefined) | undefined;
  onOpenHostedSite?: ((url: string) => void) | undefined;
  onOpenLink?: ((url: string) => void) | undefined;
  onWithdrawFeedback?: ((messageId: string) => Promise<WithdrawFeedbackStatus>) | undefined;
  onRequestFeedbackChange?: ((request: { number: number; change: "fix" | "remove" }) => void) | undefined;
  onToggleRoutineRun?: ((marker: RoutineRunToggleMarkerModel) => void) | undefined;
  onToggleAgentMessage?: ((messageId: string) => void) | undefined;
  agentMessageText?: ((messageId: string) => JSX.Element) | undefined;
  instructions?: AgentInstructionsFileCalls | undefined;
  onOpenInstructions?: ((agentId: string) => void) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void) | undefined;
}

export type ChangeMarkerActions = Pick<ChatActionMarkerProps, "onOpenSkill" | "instructions" | "onOpenInstructions">;

type AgentMessageTextProps = Pick<ChatActionMarkerProps, "onToggleAgentMessage" | "agentMessageText">;

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

type SingleChatActionMarkerModel = Exclude<
  ChatActionMarkerModel,
  { kind: "agent-message-group" } | { kind: "routine-run-group" } | { kind: "feedback-sent" }
>;
type FeedbackSentMarkerModel = Extract<ChatActionMarkerModel, { kind: "feedback-sent" }>;
type AgentMessageGroupMarkerModel = Extract<ChatActionMarkerModel, { kind: "agent-message-group" }>;
type RoutineRunGroupMarkerModel = Extract<ChatActionMarkerModel, { kind: "routine-run-group" }>;
export type RoutineRunToggleMarkerModel = Extract<ChatActionMarkerModel, { kind: "routine-run" | "routine-run-group" }>;

function agentMessageGroup(marker: ChatActionMarkerModel): AgentMessageGroupMarkerModel | undefined {
  return marker.kind === "agent-message-group" ? marker : undefined;
}

function routineRunGroup(marker: ChatActionMarkerModel): RoutineRunGroupMarkerModel | undefined {
  return marker.kind === "routine-run-group" ? marker : undefined;
}

function feedbackSent(marker: ChatActionMarkerModel): FeedbackSentMarkerModel | undefined {
  return marker.kind === "feedback-sent" ? marker : undefined;
}

function singleMarker(marker: ChatActionMarkerModel): SingleChatActionMarkerModel | undefined {
  return marker.kind === "agent-message-group" || marker.kind === "routine-run-group" || marker.kind === "feedback-sent"
    ? undefined
    : marker;
}

export function ChatActionMarker(props: ChatActionMarkerProps) {
  const drawnEntryCount = untrack(() => {
    if (props.announce) return 0;
    return agentMessageGroup(props.marker)?.messages.length ?? routineRunGroup(props.marker)?.runs.length ?? 1;
  });
  return (
    <Show
      when={agentMessageGroup(props.marker)}
      fallback={
        <Show
          when={routineRunGroup(props.marker)}
          fallback={
            <Show
              when={feedbackSent(props.marker)}
              fallback={
                <Show when={singleMarker(props.marker)}>
                  {(marker) => (
                    <SingleChatActionMarker
                      marker={marker()}
                      agents={props.agents}
                      announce={props.announce}
                      onOpenSkill={props.onOpenSkill}
                      routineAvailable={props.routineAvailable}
                      onSelectAgent={props.onSelectAgent}
                      onOpenRoutine={props.onOpenRoutine}
                      openRoutineThread={props.openRoutineThread}
                      routineRunFailure={props.routineRunFailure}
                      onOpenHostedSite={props.onOpenHostedSite}
                      onOpenLink={props.onOpenLink}
                      onToggleRoutineRun={props.onToggleRoutineRun}
                      onToggleAgentMessage={props.onToggleAgentMessage}
                      agentMessageText={props.agentMessageText}
                      instructions={props.instructions}
                      onOpenInstructions={props.onOpenInstructions}
                      onSignInProvider={props.onSignInProvider}
                    />
                  )}
                </Show>
              }
            >
              {(sent) => (
                <FeedbackSentCard
                  title={sent().title}
                  number={sent().number}
                  url={sent().url}
                  withdrawn={sent().withdrawn}
                  onOpenLink={props.onOpenLink}
                  onWithdraw={
                    props.onWithdrawFeedback
                      ? () => props.onWithdrawFeedback?.(sent().messageId) ?? Promise.resolve("notFound")
                      : undefined
                  }
                  onFix={
                    props.onRequestFeedbackChange
                      ? () => props.onRequestFeedbackChange?.({ number: sent().number, change: "fix" })
                      : undefined
                  }
                  onAskRemove={
                    props.onRequestFeedbackChange
                      ? () => props.onRequestFeedbackChange?.({ number: sent().number, change: "remove" })
                      : undefined
                  }
                />
              )}
            </Show>
          }
        >
          {(group) => (
            <RoutineRunGroupMarker
              group={group()}
              agents={props.agents}
              drawnRunCount={drawnEntryCount}
              routineAvailable={props.routineAvailable}
              onSelectAgent={props.onSelectAgent}
              onOpenRoutine={props.onOpenRoutine}
              openRoutineThread={props.openRoutineThread}
              onToggle={props.onToggleRoutineRun ? () => props.onToggleRoutineRun?.(group()) : undefined}
            />
          )}
        </Show>
      }
    >
      {(group) => (
        <AgentMessageGroupMarker
          group={group()}
          agents={props.agents}
          drawnMessageCount={drawnEntryCount}
          onSelectAgent={props.onSelectAgent}
          onToggleAgentMessage={props.onToggleAgentMessage}
          agentMessageText={props.agentMessageText}
        />
      )}
    </Show>
  );
}

interface MarkerGroupToggle {
  expanded: () => boolean;
  listId: string | undefined;
  toggle: () => void;
}

function MarkerGroup(
  props: AgentMessageTextProps & {
    class: string;
    label: string;
    listLabel: string;
    entries: readonly { id: string; marker: SingleChatActionMarkerModel }[];
    drawnCount: number;
    agents: AgentProfile[];
    routineAvailable?: boolean | undefined;
    onSelectAgent: (agentId: string, tabId?: string) => void;
    onOpenRoutine?: ((routine: { routineId: string; name: string }) => void) | undefined;
    expanded?: boolean | undefined;
    onToggle?: (() => void) | undefined;
    summary: (control: MarkerGroupToggle) => JSX.Element;
  },
) {
  const { t, format, sourceText } = useText();
  const [listExpanded, setListExpanded] = createSignal(false);
  const expanded = () => (props.onToggle ? props.expanded === true : listExpanded());
  const [mounted, setMounted] = createSignal(false);
  const toggle = (): void => {
    if (props.onToggle) {
      props.onToggle();
      return;
    }
    const opening = !listExpanded();
    setListExpanded(opening);
    if (opening || prefersReducedMotion()) setMounted(opening);
  };
  const createdListId = createUniqueId();
  const listId = () => (props.onToggle ? undefined : createdListId);
  const joinedEntries = () => props.entries.slice(Math.max(props.drawnCount, props.entries.length - 1));
  return (
    <Marker class={props.class} role="group" aria-label={props.label}>
      <div class="chat-action-marker-summary">
        <MarkerContent class="chat-action-marker-content">
          {props.summary({
            expanded,
            get listId() {
              return listId();
            },
            toggle,
          })}
        </MarkerContent>
        <Show when={mounted()}>
          <div
            class="chat-action-history-panel"
            data-state={expanded() ? "open" : "closed"}
            inert={!expanded()}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && !expanded()) setMounted(false);
            }}
          >
            <div class="chat-action-history-clip">
              <ol id={createdListId} class="chat-action-history chat-action-group-list" aria-label={props.listLabel}>
                <For each={props.entries} keyed={(entry) => entry.id}>
                  {(entry) => (
                    <li class="chat-action-history-entry">
                      <SingleChatActionMarker
                        marker={entry().marker}
                        agents={props.agents}
                        routineAvailable={props.routineAvailable}
                        onSelectAgent={props.onSelectAgent}
                        onOpenRoutine={props.onOpenRoutine}
                        onToggleAgentMessage={props.onToggleAgentMessage}
                        agentMessageText={props.agentMessageText}
                      />
                    </li>
                  )}
                </For>
              </ol>
            </div>
          </div>
        </Show>
      </div>
      <span class="sr-only" role="status" aria-live="polite">
        <For each={joinedEntries()} keyed={(entry) => entry.id}>
          {(entry) => <span>{markerAccessibleLabel(entry().marker, props.agents, format.list, t, sourceText)}</span>}
        </For>
      </span>
    </Marker>
  );
}

function AgentMessageGroupMarker(
  props: AgentMessageTextProps & {
    group: AgentMessageGroupMarkerModel;
    agents: AgentProfile[];
    drawnMessageCount: number;
    onSelectAgent: (agentId: string, tabId?: string) => void;
  },
) {
  const { t, format } = useText();
  const agentIds = () => [
    ...new Set(
      props.group.messages.flatMap(({ marker }) =>
        marker.direction === "incoming"
          ? [marker.sourceAgentId]
          : marker.targetDeliveries.map((delivery) => delivery.agentId),
      ),
    ),
  ];
  const agents = () => agentIds().map((agentId) => props.agents.find((agent) => agent.id === agentId));
  const label = () => t("chat.marker.messageGroup", { count: props.group.messages.length });
  const agentsLabel = () => {
    const ids = agentIds();
    if (ids.length !== 1) return t("chat.marker.agentCount", { count: ids.length });
    return agents()[0]?.name ?? t("chat.marker.unavailableAgent");
  };
  return (
    <MarkerGroup
      class="chat-action-marker chat-action-marker-agent-message chat-action-marker-agent-message-group"
      label={t("chat.marker.accessible.messageGroup", { label: label(), agents: agentsLabel() })}
      listLabel={t("chat.marker.groupMessages")}
      entries={props.group.messages}
      drawnCount={props.drawnMessageCount}
      agents={props.agents}
      onSelectAgent={props.onSelectAgent}
      onToggleAgentMessage={props.onToggleAgentMessage}
      agentMessageText={props.agentMessageText}
      summary={(control) => (
        <>
          <span class="chat-action-marker-label">{label()}</span>
          <Button
            variant="ghost"
            type="button"
            class="chat-action-target"
            style={agentTargetsStyle(agents())}
            aria-expanded={control.expanded() ? "true" : "false"}
            aria-controls={control.listId}
            aria-label={t(control.expanded() ? "chat.marker.hideMessages" : "chat.marker.showMessages", {
              count: props.group.messages.length,
              agents: agentsLabel(),
            })}
            data-cuelume-tap={control.expanded() ? "close" : "open"}
            onClick={control.toggle}
          >
            <span class="chat-action-avatar-stack" aria-hidden="true">
              <For each={agentIds().slice(0, 3)}>
                {(agentId) => (
                  <AgentAvatar
                    agent={props.agents.find((agent) => agent.id === agentId)}
                    class="chat-action-agent-avatar"
                  />
                )}
              </For>
            </span>
            <span>{agentsLabel()}</span>
          </Button>
          <time class="chat-action-marker-time" datetime={props.group.timestamp}>
            {formatMarkerTime(props.group.timestamp, t, format)}
          </time>
        </>
      )}
    />
  );
}

function RoutineRunGroupMarker(props: {
  group: RoutineRunGroupMarkerModel;
  agents: AgentProfile[];
  drawnRunCount: number;
  routineAvailable?: boolean | undefined;
  onSelectAgent: (agentId: string, tabId?: string) => void;
  onOpenRoutine?: ((routine: { routineId: string; name: string }) => void) | undefined;
  openRoutineThread?: ((routineId: string) => (() => void) | undefined) | undefined;
  onToggle?: (() => void) | undefined;
}) {
  const { t, format } = useText();
  const count = () => props.group.runs.length;
  const firstTimestamp = () => props.group.runs[0]?.marker.timestamp ?? props.group.timestamp;
  const timeRange = () =>
    t("chat.marker.runGroup.timeRange", {
      start: formatMarkerTime(firstTimestamp(), t, format),
      end: formatRangeEnd(firstTimestamp(), props.group.timestamp, t, format),
    });
  return (
    <MarkerGroup
      class="chat-action-marker chat-action-marker-routine-run chat-action-marker-routine-run-group"
      label={t("chat.marker.runGroup.accessible", {
        count: count(),
        name: props.group.routineName,
        time: timeRange(),
      })}
      listLabel={t("chat.marker.runGroup.runs")}
      entries={props.group.runs}
      drawnCount={props.drawnRunCount}
      agents={props.agents}
      routineAvailable={props.routineAvailable}
      onSelectAgent={props.onSelectAgent}
      onOpenRoutine={props.onOpenRoutine}
      expanded={props.group.expanded}
      onToggle={props.group.expanded === undefined ? undefined : props.onToggle}
      summary={(control) => (
        <>
          <RoutineTarget
            routineId={props.group.routineId}
            routineName={props.group.routineName}
            icon={CircleCheck}
            status="completed"
            available={props.routineAvailable !== false}
            {...(props.onOpenRoutine ? { onOpenRoutine: props.onOpenRoutine } : {})}
          />
          <span class="chat-action-run-group-details">
            <span class="chat-action-marker-label chat-action-run-group-count">
              {t("chat.marker.runGroup.count", { count: count() })}
            </span>
            <time class="chat-action-marker-time chat-action-run-group-time" datetime={props.group.timestamp}>
              {timeRange()}
            </time>
            <RoutineThreadLink
              routineName={props.group.routineName}
              open={props.openRoutineThread?.(props.group.routineId)}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              class="chat-action-history-toggle"
              type="button"
              aria-expanded={control.expanded() ? "true" : "false"}
              aria-controls={control.listId}
              aria-label={t(control.expanded() ? "chat.marker.runGroup.hide" : "chat.marker.runGroup.show", {
                count: count(),
                name: props.group.routineName,
              })}
              data-cuelume-tap={control.expanded() ? "close" : "open"}
              onClick={control.toggle}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </span>
        </>
      )}
    />
  );
}

function SingleChatActionMarker(
  props: Omit<ChatActionMarkerProps, "marker"> & { marker: SingleChatActionMarkerModel },
) {
  const { t, format, sourceText } = useText();
  const label = () => markerLabel(props.marker, t, sourceText);
  const [historyExpanded, setHistoryExpanded] = createSignal(false);
  const [historyMounted, setHistoryMounted] = createSignal(false);
  const toggleHistory = (): void => {
    const opening = !historyExpanded();
    setHistoryExpanded(opening);
    if (opening || prefersReducedMotion()) setHistoryMounted(opening);
  };
  const routineHistory = () => (props.marker.kind === "routine-run" ? props.marker.previousTransitions : undefined);
  const historyId = () =>
    props.marker.kind === "routine-run" ? `routine-run-history-${props.marker.runId}` : undefined;
  const messagesRun = () =>
    props.marker.kind === "routine-run" && props.marker.expanded !== undefined && props.onToggleRoutineRun
      ? props.marker
      : undefined;
  const historyShown = () => {
    const run = messagesRun();
    return (run ? run.expanded === true : historyMounted()) && (routineHistory()?.length ?? 0) > 0;
  };
  const textMessage = () =>
    props.marker.kind === "agent-message" &&
    props.marker.expanded !== undefined &&
    props.onToggleAgentMessage &&
    props.agentMessageText
      ? props.marker
      : undefined;
  const openTextMessage = () => {
    const marker = textMessage();
    return marker?.expanded === true ? marker : undefined;
  };
  const failureReason = () => {
    const marker = props.marker;
    if (marker.kind !== "routine-run" || marker.status !== "failed") return undefined;
    const reason = props.routineRunFailure?.(marker.runId);
    return reason ? sourceText(reason) : undefined;
  };
  return (
    <Marker
      class={`chat-action-marker chat-action-marker-${props.marker.kind}`}
      role={props.announce ? "status" : "group"}
      aria-live={props.announce ? "polite" : "off"}
      aria-label={markerAccessibleLabel(props.marker, props.agents, format.list, t, sourceText)}
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
              <RoutingTargets
                agentIds={marker().agentIds}
                agents={props.agents}
                list={format.list}
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
          <Show when={skillInstallCount(props.marker)}>
            {(count) => (
              <span class="chat-action-marker-label chat-action-run-group-count">
                {t("chat.marker.agentCount", { count: count() })}
              </span>
            )}
          </Show>
          <Show when={props.marker.kind === "sign-in-failure" && props.onSignInProvider && props.marker}>
            {(marker) => (
              <ActionTarget
                available
                actionLabel={t("provider.action.signIn")}
                name={t("provider.action.signIn")}
                icon={LogIn}
                onOpen={() => props.onSignInProvider?.(marker().provider)}
              />
            )}
          </Show>
          <Show when={instructionsChange(props.marker, props.instructions, props.onOpenInstructions)}>
            {(target) => (
              <InstructionsChangeActions
                agentId={target().agentId}
                change={target().change}
                calls={target().calls}
                onView={props.onOpenInstructions}
              />
            )}
          </Show>
          <time
            class={
              skillInstallCount(props.marker)
                ? "chat-action-marker-time chat-action-run-group-time"
                : "chat-action-marker-time"
            }
            datetime={props.marker.timestamp}
          >
            {formatMarkerTime(props.marker.timestamp, t, format)}
          </time>
          <Show when={props.marker.kind === "routine-run" && props.marker}>
            {(marker) => (
              <RoutineThreadLink
                routineName={marker().routineName}
                open={props.openRoutineThread?.(marker().routineId)}
              />
            )}
          </Show>
          <Show when={messagesRun()}>
            {(run) => (
              <Button
                variant="ghost"
                size="icon-xs"
                class="chat-action-history-toggle"
                type="button"
                aria-expanded={run().expanded ? "true" : "false"}
                aria-label={t(run().expanded ? "chat.marker.hideRunMessages" : "chat.marker.showRunMessages", {
                  name: run().routineName,
                })}
                data-cuelume-tap={run().expanded ? "close" : "open"}
                onClick={() => props.onToggleRoutineRun?.(run())}
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            )}
          </Show>
          <Show when={textMessage()}>
            {(marker) => (
              <AgentMessageTextToggle
                marker={marker()}
                agents={props.agents}
                onToggle={() => props.onToggleAgentMessage?.(marker().messageId)}
              />
            )}
          </Show>
          <Show when={!messagesRun() && (routineHistory()?.length ?? 0) > 0}>
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
              data-cuelume-tap={historyExpanded() ? "close" : "open"}
              onClick={toggleHistory}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </Show>
        </MarkerContent>
        <Show when={failureReason()}>
          {(reason) => (
            <p class="chat-action-marker-reason" title={reason()}>
              {reason()}
            </p>
          )}
        </Show>
        <Show when={historyShown() && routineHistory()}>
          {(transitions) => (
            <RoutineRunHistory
              id={historyId()}
              transitions={transitions()}
              animated={messagesRun() === undefined}
              open={messagesRun() !== undefined || historyExpanded()}
              onClosed={() => setHistoryMounted(historyExpanded())}
            />
          )}
        </Show>
        <Show when={openTextMessage()?.messageId}>
          {(messageId) => <div class="chat-action-message-text">{props.agentMessageText?.(messageId())}</div>}
        </Show>
      </div>
    </Marker>
  );
}

function AgentMessageTextToggle(props: {
  marker: AgentMessageMarkerModel;
  agents: AgentProfile[];
  onToggle: () => void;
}) {
  const { t } = useText();
  const expanded = () => props.marker.expanded === true;
  const name = () => counterpartName(props.marker, props.agents, t);
  const label = () => {
    if (props.marker.direction === "incoming") {
      return t(expanded() ? "chat.marker.hideMessageFrom" : "chat.marker.showMessageFrom", { name: name() });
    }
    return t(expanded() ? "chat.marker.hideMessageTo" : "chat.marker.showMessageTo", { name: name() });
  };
  const expandedState = () => (expanded() ? "true" : "false");
  const tap = () => (expanded() ? "close" : "open");
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      class="chat-action-history-toggle"
      type="button"
      aria-expanded={expandedState()}
      aria-label={label()}
      data-cuelume-tap={tap()}
      onClick={() => props.onToggle()}
    >
      <ChevronDown aria-hidden="true" />
    </Button>
  );
}

function agentName(agents: AgentProfile[], agentId: string | undefined, t: AppTranslate): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? t("chat.marker.unavailableAgent");
}

function counterpartName(marker: AgentMessageMarkerModel, agents: AgentProfile[], t: AppTranslate): string {
  if (marker.direction === "incoming") return agentName(agents, marker.sourceAgentId, t);
  const recipients = marker.targetDeliveries;
  if (recipients.length !== 1) return t("chat.marker.agentCount", { count: recipients.length });
  return agentName(agents, recipients[0]?.agentId, t);
}

function RoutineRunHistory(props: {
  id: string | undefined;
  transitions: RoutineRunMarkerTransition[];
  animated: boolean;
  open: boolean;
  onClosed: () => void;
}) {
  const { t, format } = useText();
  return (
    <div
      class="chat-action-history-panel"
      data-state={props.animated ? (props.open ? "open" : "closed") : undefined}
      inert={!props.open}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !props.open) props.onClosed();
      }}
    >
      <div class="chat-action-history-clip">
        <ol id={props.id} class="chat-action-history" aria-label={t("chat.marker.earlierStates")}>
          <For each={props.transitions} keyed={false}>
            {(transition, index) => {
              const previous = () => props.transitions[index - 1];
              const status = () => routineMarkerStatus(transition().status);
              return (
                <li class={`chat-action-history-entry chat-action-history-status-${status()}`}>
                  <MarkerIcon class="chat-action-history-icon">
                    <Dynamic component={routineHistoryIcon(transition().status)} aria-hidden="true" />
                  </MarkerIcon>
                  <span>{routineHistoryLabel(transition().status, previous()?.status, t)}</span>
                  <time datetime={transition().timestamp}>{formatMarkerTime(transition().timestamp, t, format)}</time>
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
  onOpenHostedSite?: ((url: string) => void) | undefined;
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
  onSelectAgent: (agentId: string, tabId?: string) => void;
}) {
  const { t } = useText();
  const openSource = (agentId: string) => props.onSelectAgent(agentId, props.marker.senderTaskId ?? MAIN_THREAD_ID);
  const openRecipient = (agentId: string) => props.onSelectAgent(agentId, MAIN_THREAD_ID);
  const source = () => props.agents.find((agent) => agent.id === props.marker.sourceAgentId);
  const recipients = () => props.marker.targetDeliveries;
  const singleRecipient = () => {
    const delivery = recipients()[0];
    return delivery ? props.agents.find((agent) => agent.id === delivery.agentId) : undefined;
  };
  return (
    <Show
      when={props.marker.direction === "outgoing"}
      fallback={<AgentButton agent={source()} fallbackId={props.marker.sourceAgentId} onSelectAgent={openSource} />}
    >
      <Show
        when={recipients().length > 1}
        fallback={
          <AgentButton agent={singleRecipient()} fallbackId={recipients()[0]?.agentId} onSelectAgent={openRecipient} />
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
                    onSelect={() => openRecipient(delivery.agentId)}
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

const LIST_ITEM_MARKER = /(\u{E000}\d+\u{E001})/u;

function RoutingTargets(props: {
  agentIds: string[];
  agents: AgentProfile[];
  list: AppFormat["list"];
  onSelectAgent: (agentId: string) => void;
}) {
  const shownFirst = new Set(untrack(() => props.agentIds));
  const parts = () => {
    const markers = props.agentIds.map((_, index) => `\u{E000}${index}\u{E001}`);
    return props
      .list(markers)
      .split(LIST_ITEM_MARKER)
      .flatMap((part): Array<{ agentId: string } | { text: string }> => {
        const agentId = props.agentIds[markers.indexOf(part)];
        if (agentId) return [{ agentId }];
        return part ? [{ text: part }] : [];
      });
  };
  return (
    <span class="chat-action-routing-targets">
      <For each={parts()}>
        {(part) =>
          "agentId" in part ? (
            <AgentButton
              agent={props.agents.find((agent) => agent.id === part.agentId)}
              fallbackId={part.agentId}
              onSelectAgent={props.onSelectAgent}
              class={shownFirst.has(part.agentId) ? undefined : "chat-action-target-entering"}
            />
          ) : (
            <span class="chat-action-routing-separator">{part.text}</span>
          )
        }
      </For>
    </span>
  );
}

function AgentButton(props: {
  agent: AgentProfile | undefined;
  fallbackId: string | undefined;
  onSelectAgent: (agentId: string) => void;
  class?: string | undefined;
}) {
  const { t } = useText();
  return (
    <Show
      when={props.agent}
      fallback={
        <span
          class={`chat-action-target chat-action-target-unavailable${props.class ? ` ${props.class}` : ""}`}
          title={props.fallbackId}
        >
          <AgentAvatar class="chat-action-agent-avatar" />
          <span>{t("chat.marker.unavailableAgent")}</span>
        </span>
      }
    >
      {(agent) => (
        <Button
          variant="ghost"
          type="button"
          class={`chat-action-target${props.class ? ` ${props.class}` : ""}`}
          style={agentTargetStyle(agent())}
          aria-label={t("chat.marker.openChat", { name: agent().name })}
          data-cuelume-tap="navigate"
          onClick={() => props.onSelectAgent(agent().id)}
        >
          <AgentAvatar agent={agent()} class="chat-action-agent-avatar" />
          <span>{agent().name}</span>
        </Button>
      )}
    </Show>
  );
}

function RoutineThreadLink(props: { routineName: string; open: (() => void) | undefined }) {
  const { t } = useText();
  return (
    <Show when={props.open}>
      {(open) => (
        <Button
          variant="ghost"
          size="xs"
          class="chat-action-routine-thread"
          type="button"
          aria-label={t("chat.marker.openRoutineThreadOf", { name: props.routineName })}
          onClick={() => open()()}
        >
          {t("chat.marker.openRoutineThread")}
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
  onOpenRoutine?: ((routine: { routineId: string; name: string }) => void) | undefined;
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
  status?: ChatActionMarkerStatus | undefined;
  available: boolean;
  actionLabel: string;
  onOpen?: (() => void) | undefined;
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

function skillInstallCount(marker: SingleChatActionMarkerModel): number | undefined {
  if (marker.kind !== "skill-lifecycle") return undefined;
  const count = marker.installMessageIds?.length ?? 0;
  return count > 1 ? count : undefined;
}

function instructionsChange(
  marker: SingleChatActionMarkerModel,
  calls: AgentInstructionsFileCalls | undefined,
  onView: ((agentId: string) => void) | undefined,
) {
  if (marker.kind !== "instructions-change" || !marker.agentId || (!calls && !onView)) return undefined;
  return { agentId: marker.agentId, change: marker.change, calls };
}

function markerLabel(
  marker: SingleChatActionMarkerModel,
  t: AppTranslate,
  sourceText: (text: string) => string,
): string {
  if (marker.kind === "unavailable") return marker.label;
  if (
    marker.kind === "model-switch" ||
    marker.kind === "channel-change" ||
    marker.kind === "vault-change" ||
    marker.kind === "plan-continuation" ||
    marker.kind === "no-answer" ||
    marker.kind === "instructions-change" ||
    marker.kind === "sign-in-failure"
  )
    return sourceText(marker.text);
  if (marker.kind === "context-reset") return t("chat.marker.contextReset");
  if (marker.kind === "marketplace-suggestion") return t("chat.marker.marketplaceSuggestion");
  if (marker.kind === "setting-link") return t("chat.marker.settingLink");
  if (marker.kind === "skill-suggestion") return t("chat.marker.skillSuggestion");
  if (marker.kind === "mcp-sign-in") return t("chat.marker.mcpSignIn");
  if (marker.kind === "server-install") return t("chat.marker.serverInstall");
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
  return agent
    ? `--chat-action-agent-color: ${avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor ?? null)}`
    : undefined;
}

function agentTargetsStyle(agents: Array<AgentProfile | undefined>): string | undefined {
  const colors = agents.flatMap((agent) =>
    agent ? [avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor ?? null)] : [],
  );
  const mixedColor = colors.reduce<string | undefined>((mix, color, index) => {
    if (!mix) return color;
    const previousColorsWeight = Math.round((index / (index + 1)) * 10_000) / 100;
    return `color-mix(in oklab, ${mix} ${previousColorsWeight}%, ${color})`;
  }, undefined);
  return mixedColor ? `--chat-action-agent-color: ${mixedColor}` : undefined;
}

function markerAccessibleLabel(
  marker: SingleChatActionMarkerModel,
  agents: AgentProfile[],
  list: AppFormat["list"],
  t: AppTranslate,
  sourceText: (text: string) => string,
): string {
  const label = markerLabel(marker, t, sourceText);
  if (
    marker.kind === "unavailable" ||
    marker.kind === "context-reset" ||
    marker.kind === "marketplace-suggestion" ||
    marker.kind === "setting-link" ||
    marker.kind === "mcp-sign-in" ||
    marker.kind === "server-install" ||
    marker.kind === "model-switch" ||
    marker.kind === "channel-change" ||
    marker.kind === "vault-change" ||
    marker.kind === "plan-continuation" ||
    marker.kind === "no-answer" ||
    marker.kind === "instructions-change" ||
    marker.kind === "sign-in-failure"
  )
    return label;
  if (marker.kind === "skill-lifecycle") {
    const count = skillInstallCount(marker);
    const named = t("chat.marker.accessible.named", { label, name: marker.skillName });
    if (!count) return named;
    return t("chat.marker.accessible.named", { label: named, name: t("chat.marker.agentCount", { count }) });
  }
  if (marker.kind === "skill-suggestion") return t("chat.marker.accessible.named", { label, name: marker.skillName });
  const unavailable = t("chat.marker.unavailableAgent");
  if (marker.kind === "agent-message") {
    const agent = counterpartName(marker, agents, t);
    return t("chat.marker.accessible.message", { label, agent, status: t(STATUS_LABELS[marker.status]) });
  }
  if (marker.kind === "channel-routing") {
    const names = marker.agentIds.map((id) => agents.find((candidate) => candidate.id === id)?.name ?? unavailable);
    return t("chat.marker.accessible.routing", { label, agent: list(names) });
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

function formatRangeEnd(start: string, end: string, t: AppTranslate, format: AppFormat): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || !sameDay(startDate, endDate))
    return formatMarkerTime(end, t, format);
  if (sameDay(endDate, new Date())) return formatChatTimestamp(endDate, format);
  return format.date(endDate, { timeStyle: "short" });
}

function sameDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}
