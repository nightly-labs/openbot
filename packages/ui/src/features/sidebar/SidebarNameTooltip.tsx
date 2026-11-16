/**
 * The name of a chat in a tooltip at its row. The compact sidebar shows only the avatars, so the
 * tooltip shows what the full row shows: the name of the agent, channel or person, its title and
 * its last message. The full sidebar shows these in the row, so it has no tooltip there.
 */

import { Badge } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { SidebarRowTooltip } from "./SidebarRowTooltip";
import { useSidebarScope } from "./sidebar-scope";

/** The delay of the server rail. After the first tooltip, the next rows open theirs at once. */
const SIDEBAR_NAME_TOOLTIP_OPEN_DELAY = 150;

export function SidebarNameTooltip(tooltipProps: {
  name: string;
  /** The title of the agent or channel, such as its role. */
  title?: string | undefined;
  /** The last message, or what the row shows in its place. */
  preview?: string | undefined;
  /** The state, such as a running routine. */
  detail?: string | undefined;
  /** The row's context menu is open. */
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
