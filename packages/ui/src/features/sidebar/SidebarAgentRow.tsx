/**
 * One agent in a section: the drag wrapper, the row itself, and its context menu.
 *
 * A waiting agent's row sits in the "Needs you" group instead. There it does not drag, because the
 * group is not a place in the layout, and its tooltip says what the agent waits for.
 *
 * A hidden agent's row sits in the "Hidden" group. It does not drag either. On a host that stops a
 * hidden agent, it shows when the user hid it in place of the last message and the time.
 */

import { AppWindow, Badge, buttonVariants, CirclePause, Clock3, ContextMenu, Lock } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { agentAccessLockLabel } from "../agents/agent-access";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";
import { SidebarAgentIndicator, SidebarWaitChip, SidebarWaitTooltip } from "./SidebarAgentIndicator";
import { SidebarAgentThreads } from "./SidebarAgentThreads";
import { SidebarNameTooltip } from "./SidebarNameTooltip";
import { sidebarAgentStateLabel, sidebarMessageTime, sidebarUsageResetTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

/**
 * `waiting` is set by the "Needs you" and "Unread" groups. The row reads it rather than the agent's
 * state, because the group holds its members still during a drag while the state moves on. `userHidden` is set by
 * the "Hidden" group. A hidden agent that waits for the user is a `waiting` row of "Needs you".
 */
export function SidebarAgentRow(rowProps: { agent: AgentProfile; waiting?: boolean; userHidden?: boolean }) {
  const {
    dragOffset,
    draggedChatId,
    endChatDragging,
    chatsDraggable,
    props,
    sidebarClickIsSuppressed,
    startChatDragging,
    userHiddenSince,
  } = useSidebarScope();
  const { t, format } = useText();
  const title = () => rowProps.agent.title.trim();
  const lockLabel = () => agentAccessLockLabel(rowProps.agent, t);
  const accessLabel = () => (lockLabel() ? `. ${lockLabel()}` : "");
  const inWindow = () => props.windowAgentIds?.has(rowProps.agent.id) ?? false;
  const windowLabel = () => (inWindow() ? `. ${t("sidebar.agentMenu.inWindow")}` : "");
  /** A host without `agent-hidden-work` stops a hidden agent, so its row shows the date and no state. */
  const paused = () => rowProps.userHidden === true && props.userHiddenAgentsWork !== true;
  /** A row of "Needs you" can be a hidden agent. Its menu then has the restore item. */
  const hiddenByUser = () => userHiddenSince(rowProps.agent.id) !== undefined;
  const state = () => (paused() ? undefined : props.agentStates[rowProps.agent.id]);
  const hiddenDetail = () => {
    const since = paused() ? userHiddenSince(rowProps.agent.id) : undefined;
    return since
      ? t("sidebar.hidden.since", { date: format.date(new Date(since), { month: "short", day: "numeric" }) })
      : "";
  };
  // A function, not a JSX ternary: the compiler wraps a ternary in a memo, and the avatar reads its
  // mood inside an effect, where a memo cannot be created.
  const mood = () => (paused() ? "asleep" : (props.agentMoods[rowProps.agent.id] ?? "idle"));
  const hiddenLabel = () => (hiddenByUser() ? `${t("sidebar.hidden.title")}. ` : "");
  const draggable = () => chatsDraggable() && !props.compact && !rowProps.waiting && !rowProps.userHidden;
  const wait = () => {
    const current = state();
    return rowProps.waiting && current?.kind === "waiting" ? current : undefined;
  };
  // A waiting row previews the question: the stored preview is the message before it.
  const detail = () => hiddenDetail() || wait()?.detail || rowProps.agent.preview;
  // The state label already reads the question, so the label does not say it twice.
  const labelDetail = () => (wait()?.detail ? "" : `. ${hiddenLabel()}${detail()}`);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [rowElement, setRowElement] = createSignal<HTMLElement>();
  // The thread card covers the row's tooltip, so the tooltip does not open while the card shows.
  const [threadCardOpen, setThreadCardOpen] = createSignal(false);
  const coverOpen = () => menuOpen() || threadCardOpen();
  // A drag starts on the item, also from a thread under the row. Only the agent row moves the agent.
  let dragFromThreads = false;
  /** The side threads show in the full sidebar, and not for an agent that the host stops while hidden. */
  const threads = () => (props.compact || paused() ? undefined : props.agentThreads);
  const limit = () => {
    const current = state();
    return current?.kind === "limited" ? current : undefined;
  };
  const interrupted = () => {
    const current = state();
    return current?.kind === "interrupted" ? current : undefined;
  };
  const stateLabel = () => {
    const current = state();
    return current?.kind === "routine" || current?.kind === "waiting" || current?.kind === "limited"
      ? sidebarAgentStateLabel(current, t, format)
      : "";
  };
  const routineLabel = () => (state()?.kind === "routine" || limit() ? stateLabel() : "");
  // In the full sidebar, only a waiting row has a tooltip, so the rows in the sections do not each
  // carry one. The compact sidebar shows only the avatar, so each row names its agent.
  const row = (): JSX.Element => (
    <ContextMenu.Root modal={false} onOpenChange={setMenuOpen}>
      <ContextMenu.Trigger
        ref={setRowElement}
        as="button"
        type="button"
        class={[
          buttonVariants({ variant: "ghost" }),
          "agent-row",
          {
            "agent-row-active": props.activeAgentId === rowProps.agent.id,
            "sidebar-agent-row-dragging": draggedChatId() === rowProps.agent.id,
          },
        ]}
        aria-label={`${rowProps.agent.name}${title() ? `, ${title()}` : ""}${accessLabel()}${windowLabel()}${labelDetail()}${stateLabel() ? `. ${stateLabel()}` : ""}`}
        title={props.compact ? undefined : routineLabel() || undefined}
        aria-pressed={props.activeAgentId === rowProps.agent.id ? "true" : "false"}
        data-cuelume-navigate=""
        onClick={(event: MouseEvent) => {
          if (!sidebarClickIsSuppressed(event)) props.onSelectAgent(rowProps.agent.id);
        }}
      >
        <span class="agent-row-avatar">
          <AgentAvatar agent={rowProps.agent} motion="idle" mood={mood()} workingFaces />
          <SidebarAgentIndicator state={state} />
        </span>
        <span class="agent-row-copy">
          <span class="agent-row-heading">
            <span class="agent-row-title">
              <span class="agent-row-name">
                <strong dir="auto">{rowProps.agent.name}</strong>
                <Show when={lockLabel()}>
                  <span class="agent-row-access" title={lockLabel()}>
                    <Lock aria-hidden="true" />
                  </span>
                </Show>
                <Show when={inWindow()}>
                  <span class="agent-row-access" title={t("sidebar.agentMenu.inWindow")}>
                    <AppWindow aria-hidden="true" />
                  </span>
                </Show>
              </span>
              <Show when={title()}>
                {(label) => (
                  <Badge class="agent-role-badge" title={label()}>
                    <span dir="auto">{label()}</span>
                  </Badge>
                )}
              </Show>
            </span>
            <Show
              when={wait()}
              fallback={
                <Show
                  when={limit()}
                  fallback={
                    <Show
                      when={interrupted()}
                      fallback={
                        <Show when={!paused()}>
                          <span class="agent-row-time">
                            {rowProps.agent.updatedAt
                              ? sidebarMessageTime(rowProps.agent.updatedAt, format)
                              : rowProps.agent.time}
                          </span>
                        </Show>
                      }
                    >
                      <span class="agent-row-wait-chip">
                        <CirclePause aria-hidden="true" />
                        {t("sidebar.state.interrupted")}
                      </span>
                    </Show>
                  }
                >
                  {(current) => (
                    <span class="agent-row-wait-chip">
                      <Clock3 aria-hidden="true" />
                      {sidebarUsageResetTime(current().resetsAt, format) ?? t("sidebar.state.usageLimitChip")}
                    </span>
                  )}
                </Show>
              }
            >
              {(current) => <SidebarWaitChip reason={current().reason} />}
            </Show>
          </span>
          <span class="agent-row-preview" dir="auto">
            {detail()}
          </span>
        </span>
        <Show when={state()}>
          {(state) => <span class="sr-only">{sidebarAgentStateLabel(state(), t, format)}</span>}
        </Show>
      </ContextMenu.Trigger>
      <SidebarAgentContextMenu agent={rowProps.agent} pinned={false} userHidden={hiddenByUser()} />
    </ContextMenu.Root>
  );
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: Native drag belongs to the wrapper around the accessible button. */
    <div
      class={[
        "sidebar-agent-item",
        {
          "sidebar-agent-item-user-hidden": rowProps.userHidden === true,
          "sidebar-agent-item-dragging": draggedChatId() === rowProps.agent.id,
          "sidebar-drag-shifting": dragOffset(rowProps.agent.id).y !== 0,
        },
      ]}
      style={`--sidebar-drag-y: ${dragOffset(rowProps.agent.id).y}px;`}
      data-chat-id={rowProps.waiting || rowProps.userHidden ? undefined : rowProps.agent.id}
      draggable={draggable() ? "true" : "false"}
      onPointerDown={(event: PointerEvent) => {
        dragFromThreads = event.target instanceof Element && event.target.closest(".sidebar-threads") !== null;
      }}
      onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) => {
        if (dragFromThreads) {
          event.preventDefault();
          return;
        }
        startChatDragging(event, rowProps.agent.id);
      }}
      onDragEnd={endChatDragging}
    >
      <Show
        when={wait()}
        fallback={
          <SidebarNameTooltip
            name={rowProps.agent.name}
            title={title()}
            preview={detail()}
            detail={routineLabel()}
            menuOpen={coverOpen()}
          >
            {row()}
          </SidebarNameTooltip>
        }
      >
        {(current) => (
          <SidebarWaitTooltip
            wait={current()}
            menuOpen={coverOpen()}
            name={props.compact ? rowProps.agent.name : undefined}
          >
            {row()}
          </SidebarWaitTooltip>
        )}
      </Show>
      <Show when={threads()}>
        {(model) => (
          <SidebarAgentThreads
            model={model()}
            agentId={rowProps.agent.id}
            agentName={rowProps.agent.name}
            row={rowElement()}
            menuOpen={menuOpen()}
            onCardChange={setThreadCardOpen}
          />
        )}
      </Show>
    </div>
  );
}
