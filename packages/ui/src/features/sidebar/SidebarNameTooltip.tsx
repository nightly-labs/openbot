import { Badge } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { SidebarRowTooltip } from "./SidebarRowTooltip";
import { useSidebarScope } from "./sidebar-scope";

const SIDEBAR_NAME_TOOLTIP_OPEN_DELAY = 150;

export function SidebarNameTooltip(tooltipProps: {
  name: string;
  title?: string | undefined;
  preview?: string | undefined;
  detail?: string | undefined;
  menuOpen?: boolean;
  children: JSX.Element;
}) {
  const { props } = useSidebarScope();
  return (
    <SidebarRowTooltip
      enabled={props.compact === true}
      openDelay={SIDEBAR_NAME_TOOLTIP_OPEN_DELAY}
      menuOpen={tooltipProps.menuOpen}
      class="sidebar-name-tooltip"
      content={
        <>
          <span class="sidebar-name-tooltip-heading">
            <span class="sidebar-name-tooltip-name" dir="auto">
              {tooltipProps.name}
            </span>
            <Show when={tooltipProps.title?.trim()}>
              {(title) => (
                <Badge class="agent-role-badge">
                  <span dir="auto">{title()}</span>
                </Badge>
              )}
            </Show>
          </span>
          <Show when={tooltipProps.preview?.trim()}>
            {(preview) => (
              <span class="sidebar-name-tooltip-preview" dir="auto">
                {preview()}
              </span>
            )}
          </Show>
          <Show when={tooltipProps.detail}>
            {(detail) => <span class="sidebar-name-tooltip-detail">{detail()}</span>}
          </Show>
        </>
      }
    >
      {tooltipProps.children}
    </SidebarRowTooltip>
  );
}
