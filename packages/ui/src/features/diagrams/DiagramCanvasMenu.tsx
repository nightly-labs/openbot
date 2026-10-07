/**
 * The canvas's right-click menu. It adds an agent at the spot the user clicked: one that is not on
 * the canvas yet, from a submenu that shows each with its face, or a new one, which the canvas then
 * asks for in a small card at the same spot.
 */

import { ChevronRight, ContextMenu, Plus, UserRound } from "@openbot/ui";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

export function DiagramCanvasMenu(props: {
  addableAgents: readonly AgentProfile[];
  onPlaceAgent: (agentId: string) => void;
  onNewAgent?: (() => void) | undefined;
}) {
  const { t } = useText();
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu diagram-canvas-menu" aria-label={t("diagram.menu.label")}>
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger>
            <UserRound class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("diagram.menu.addAgent")}</span>
            <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent class="ui-action-menu agent-context-menu diagram-canvas-agents">
              <For
                each={props.addableAgents}
                fallback={<ContextMenu.Item disabled>{t("diagram.menu.noAgents")}</ContextMenu.Item>}
              >
                {(agent) => (
                  <ContextMenu.Item onSelect={() => props.onPlaceAgent(agent.id)}>
                    <AgentAvatar agent={agent} class="diagram-canvas-menu-avatar" motion="idle" />
                    <span class="diagram-canvas-menu-agent">
                      <span>{agent.name}</span>
                      <Show when={agent.title}>{(title) => <small>{title()}</small>}</Show>
                    </span>
                  </ContextMenu.Item>
                )}
              </For>
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
        <Show when={props.onNewAgent}>
          {(onNewAgent) => (
            <ContextMenu.Item onSelect={() => onNewAgent()()}>
              <Plus class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("diagram.menu.newAgent")}</span>
            </ContextMenu.Item>
          )}
        </Show>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
