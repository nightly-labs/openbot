/**
 * What the list shows with nothing in it. Two different empty states: a search that matched nothing
 * says so, while a brand new profile offers `props.emptyAction` - the first agent, rendered as a
 * pressed row so the sidebar is never a blank column.
 */

import { Button } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarEmptyState() {
  const { props, query } = useSidebarScope();
  const { t } = useText();
  return (
    <Show
      when={!query().trim() && props.emptyAction}
      fallback={
        <p class="empty-search">
          {query().trim()
            ? t("sidebar.empty.noMatches")
            : props.agents.length
              ? t("sidebar.empty.noMatches")
              : t("sidebar.empty.noAgents")}
        </p>
      }
    >
      {(action) => (
        <div class={props.layout.sections.length === 0 ? "sidebar-first-agent-state" : undefined}>
          <Button
            variant="ghost"
            type="button"
            class="agent-row agent-row-active sidebar-first-agent-action"
            aria-label={action().label}
            aria-pressed="true"
            data-avatar-seed={action().avatarSeed}
            data-avatar-hue={action().avatarHue ?? "automatic"}
            onClick={action().onSelect}
          >
            <span class="agent-row-avatar">
              <AgentAvatar seed={action().avatarSeed} hue={action().avatarHue} motion="hover" />
            </span>
            <span class="agent-row-copy">
              <span class="agent-row-heading">
                <span class="agent-row-title">
                  <strong>{action().label}</strong>
                </span>
              </span>
            </span>
          </Button>
        </div>
      )}
    </Show>
  );
}
