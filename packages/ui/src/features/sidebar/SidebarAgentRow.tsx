/** One agent in a section: the drag wrapper, the row itself, and its context menu. */

import { Badge, buttonVariants, ContextMenu, Lock } from "@openbot/ui";
import { Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { agentAccessLockLabel } from "../agents/agent-access";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";
import { SidebarAgentIndicator } from "./SidebarAgentIndicator";
import { sidebarAgentStateLabel, sidebarMessageTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarAgentRow(rowProps: { agent: AgentProfile }) {
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
  const routineLabel = () => {
    const state = props.agentStates[rowProps.agent.id];
    return state?.kind === "routine" ? sidebarAgentStateLabel(state, t) : "";
  };
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
      data-chat-id={rowProps.agent.id}
      draggable={!layoutMutable() || props.compact ? "false" : "true"}
      onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) => startChatDragging(event, rowProps.agent.id)}
      onDragEnd={endChatDragging}
    >
      <ContextMenu.Root modal={false}>
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
          aria-label={`${rowProps.agent.name}${title() ? `, ${title()}` : ""}${accessLabel()}. ${rowProps.agent.preview}${routineLabel() ? `. ${routineLabel()}` : ""}`}
          title={routineLabel() || undefined}
          aria-pressed={props.activeAgentId === rowProps.agent.id ? "true" : "false"}
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
              <span class="agent-row-time">
                {rowProps.agent.updatedAt ? sidebarMessageTime(rowProps.agent.updatedAt, format) : rowProps.agent.time}
              </span>
            </span>
            <span class="agent-row-preview">{rowProps.agent.preview}</span>
          </span>
          <Show when={props.agentStates[rowProps.agent.id]}>
            {(state) => <span class="sr-only">{sidebarAgentStateLabel(state(), t)}</span>}
          </Show>
        </ContextMenu.Trigger>
        <SidebarAgentContextMenu agent={rowProps.agent} pinned={false} />
      </ContextMenu.Root>
    </div>
  );
}
