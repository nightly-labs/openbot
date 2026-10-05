/**
 * One agent in a section: the drag wrapper, the row itself, and its context menu.
 *
 * A waiting agent's row sits in the "Needs you" group instead. There it does not drag, because the
 * group is not a place in the layout, and its tooltip says what the agent waits for.
 */

import { Badge, buttonVariants, ContextMenu, Lock, Tooltip } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createStore, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { agentAccessLockLabel } from "../agents/agent-access";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";
import { SidebarAgentIndicator, SidebarWaitIcon } from "./SidebarAgentIndicator";
import {
  SIDEBAR_WAIT_ACTION,
  SIDEBAR_WAIT_HINT,
  SIDEBAR_WAIT_TITLE,
  sidebarAgentStateLabel,
  sidebarMessageTime,
} from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

/** Long enough that moving the pointer down the list does not flash every waiting row's tooltip. */
const SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY = 350;

/**
 * `waiting` is set by the "Needs you" group. The row reads it rather than the agent's state, because
 * the group holds its members still during a drag while the state moves on.
 */
export function SidebarAgentRow(rowProps: { agent: AgentProfile; waiting?: boolean }) {
  const {
    dragOffset,
    draggedChatId,
    endChatDragging,
    layoutMutable,
    props,
    sidebarClickIsSuppressed,
    startChatDragging,
  } = useSidebarScope();
  const { t, format } = useText();
  const title = () => rowProps.agent.title.trim();
  const lockLabel = () => agentAccessLockLabel(rowProps.agent, t);
  const accessLabel = () => (lockLabel() ? `. ${lockLabel()}` : "");
  const state = () => props.agentStates[rowProps.agent.id];
  const wait = () => {
    const current = state();
    return rowProps.waiting && current?.kind === "waiting" ? current : undefined;
  };
  const [overlay, setOverlay] = createStore({ tooltipOpen: false, menuOpen: false });
  const stateLabel = () => {
    const current = state();
    return current?.kind === "routine" || current?.kind === "waiting" ? sidebarAgentStateLabel(current, t) : "";
  };
  const routineLabel = () => (state()?.kind === "routine" ? stateLabel() : "");
  // Only a waiting row has a tooltip, so the rows in the sections do not each carry one.
  const row = (): JSX.Element => (
    <ContextMenu.Root
      modal={false}
      onOpenChange={(open) =>
        setOverlay((draft) => {
          draft.menuOpen = open;
        })
      }
    >
      <ContextMenu.Trigger
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
        aria-label={`${rowProps.agent.name}${title() ? `, ${title()}` : ""}${accessLabel()}. ${rowProps.agent.preview}${stateLabel() ? `. ${stateLabel()}` : ""}`}
        title={routineLabel() || undefined}
        aria-pressed={props.activeAgentId === rowProps.agent.id ? "true" : "false"}
        data-cuelume-navigate=""
        onClick={(event: MouseEvent) => {
          if (!sidebarClickIsSuppressed(event)) props.onSelectAgent(rowProps.agent.id);
        }}
      >
        <span class="agent-row-avatar">
          <AgentAvatar agent={rowProps.agent} motion="idle" mood={props.agentMoods[rowProps.agent.id] ?? "idle"} />
          <SidebarAgentIndicator state={() => props.agentStates[rowProps.agent.id]} />
        </span>
        <span class="agent-row-copy">
          <span class="agent-row-heading">
            <span class="agent-row-title">
              <span class="agent-row-name">
                <strong>{rowProps.agent.name}</strong>
                <Show when={lockLabel()}>
                  <span class="agent-row-access" title={lockLabel()}>
                    <Lock aria-hidden="true" />
                  </span>
                </Show>
              </span>
              <Show when={title()}>
                {(label) => (
                  <Badge class="agent-role-badge" size="sm" title={label()}>
                    <span>{label()}</span>
                  </Badge>
                )}
              </Show>
            </span>
            <Show
              when={wait()}
              fallback={
                <span class="agent-row-time">
                  {rowProps.agent.updatedAt
                    ? sidebarMessageTime(rowProps.agent.updatedAt, format)
                    : rowProps.agent.time}
                </span>
              }
            >
              {(current) => (
                <span class="agent-row-wait-chip">
                  <SidebarWaitIcon reason={current().reason} />
                  {t(SIDEBAR_WAIT_ACTION[current().reason])}
                </span>
              )}
            </Show>
          </span>
          <span class="agent-row-preview">{rowProps.agent.preview}</span>
        </span>
        <Show when={props.agentStates[rowProps.agent.id]}>
          {(state) => <span class="sr-only">{sidebarAgentStateLabel(state(), t)}</span>}
        </Show>
      </ContextMenu.Trigger>
      <SidebarAgentContextMenu agent={rowProps.agent} pinned={false} />
    </ContextMenu.Root>
  );
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: Native drag belongs to the wrapper around the accessible button. */
    <div
      class={[
        "sidebar-agent-item",
        {
          "sidebar-agent-item-dragging": draggedChatId() === rowProps.agent.id,
          "sidebar-drag-shifting": dragOffset(rowProps.agent.id).y !== 0,
        },
      ]}
      style={`--sidebar-drag-y: ${dragOffset(rowProps.agent.id).y}px;`}
      data-chat-id={rowProps.waiting ? undefined : rowProps.agent.id}
      draggable={!layoutMutable() || props.compact || rowProps.waiting ? "false" : "true"}
      onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) => startChatDragging(event, rowProps.agent.id)}
      onDragEnd={endChatDragging}
    >
      <Show when={wait()} fallback={row()}>
        {(current) => (
          <Tooltip.Root
            open={overlay.tooltipOpen && !overlay.menuOpen}
            onOpenChange={(open) =>
              setOverlay((draft) => {
                draft.tooltipOpen = open;
              })
            }
            placement="right"
            gutter={10}
            openDelay={SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY}
            closeDelay={0}
            skipDelayDuration={300}
          >
            <Tooltip.Trigger as="div" class="sidebar-agent-tooltip-trigger">
              {row()}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="sidebar-wait-tooltip">
                <span class="sidebar-wait-tooltip-title">
                  <SidebarWaitIcon reason={current().reason} />
                  {t(SIDEBAR_WAIT_TITLE[current().reason])}
                </span>
                <Show when={current().detail}>
                  {(detail) => <span class="sidebar-wait-tooltip-detail">{detail()}</span>}
                </Show>
                <span class="sidebar-wait-tooltip-hint">{t(SIDEBAR_WAIT_HINT[current().reason])}</span>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
      </Show>
    </div>
  );
}
