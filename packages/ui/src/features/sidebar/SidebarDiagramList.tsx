/**
 * The diagrams view of the sidebar. A diagram is not a chat: it has no section, pin or unread
 * count, so this is a plain list rather than one more kind of row in the chat list.
 */

import { Button, Plus, Spinner, TriangleAlert } from "@openbot/ui";
import { createMemo, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { sidebarMessageTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarDiagramList() {
  const { normalizedQuery, props, query } = useSidebarScope();
  const { t, format } = useText();
  const diagrams = createMemo(() =>
    (props.diagrams ?? []).filter(
      (diagram) =>
        !normalizedQuery() ||
        `${diagram.name} ${diagram.routineNames.join(" ")}`.toLowerCase().includes(normalizedQuery()),
    ),
  );
  return (
    <nav class="agent-list" aria-label={t("sidebar.diagrams.label")}>
      <div class="agent-list-content">
        <For
          each={diagrams()}
          fallback={
            <p class="empty-search">{query().trim() ? t("sidebar.empty.noMatches") : t("sidebar.diagrams.empty")}</p>
          }
        >
          {(diagram) => {
            const preview = () =>
              diagram.routineNames.length > 0 ? format.list(diagram.routineNames) : t("sidebar.diagrams.noRoutines");
            const active = () => props.activeDiagramId === diagram.id;
            return (
              <Button
                type="button"
                variant="ghost"
                class={["agent-row diagram-row", { "agent-row-active": active() }]}
                aria-label={`${diagram.name}. ${preview()}`}
                aria-pressed={active() ? "true" : "false"}
                data-cuelume-navigate=""
                onClick={() => props.onSelectDiagram?.(diagram.id)}
              >
                <span class="agent-row-avatar">
                  <ChannelAvatar
                    members={diagram.agentIds.map((agentId) => ({ agentId }))}
                    agents={props.agents}
                    layout="cluster"
                  />
                </span>
                <span class="agent-row-copy">
                  <span class="agent-row-heading">
                    <span class="agent-row-title">
                      <strong>{diagram.name}</strong>
                    </span>
                    <span class="agent-row-time">
                      {sidebarMessageTime(diagram.lastRunAt ?? diagram.updatedAt, format)}
                    </span>
                  </span>
                  <span class="agent-row-preview diagram-row-preview">
                    <Switch>
                      <Match when={diagram.lastRunStatus === "running"}>
                        <Spinner size="sm" label={t("diagram.run.running")} />
                      </Match>
                      <Match when={diagram.lastRunStatus === "failed"}>
                        <TriangleAlert class="diagram-row-failed" aria-label={t("diagram.run.failed")} />
                      </Match>
                    </Switch>
                    {preview()}
                  </span>
                </span>
              </Button>
            );
          }}
        </For>
        <Show when={props.onCreateDiagram && !props.compact}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="sidebar-diagram-create"
            onClick={() => props.onCreateDiagram?.()}
          >
            <Plus aria-hidden="true" />
            {t("sidebar.diagrams.create")}
          </Button>
        </Show>
      </div>
    </nav>
  );
}
