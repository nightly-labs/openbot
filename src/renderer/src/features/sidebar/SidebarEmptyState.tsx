/**
 * What the list shows with nothing in it. Two different empty states: a search that matched nothing
 * says so, while a brand new profile offers `props.emptyAction` - the first agent, rendered as a
 * pressed row so the sidebar is never a blank column.
 */

import { Show } from "solid-js";
import { Button } from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useI18n } from "../i18n/i18n-context";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarEmptyState() {
  const { props, query } = useSidebarScope();
  const i18n = useI18n();
  return (
    <Show
      when={!query().trim() && props.emptyAction}
      fallback={
        <p class="empty-search">
          {query().trim()
            ? i18n.t("sidebar.noMatches")
            : props.agents.length
              ? i18n.t("sidebar.noMatches")
              : i18n.t("sidebar.noAgentsYet")}
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
