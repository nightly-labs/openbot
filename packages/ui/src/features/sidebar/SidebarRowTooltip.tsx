/**
 * The tooltip of a sidebar row. It opens at the right of the row and stays closed while the row's
 * context menu is open. When `enabled` is false, the row has no tooltip and no wrapper, so a long
 * list does not carry a tooltip for each row that cannot show one.
 */
import { Tooltip } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";

type SidebarRowTooltipProps = {
  /** Default true. */
  enabled?: boolean | undefined;
  openDelay: number;
  /** The row's context menu is open. */
  menuOpen?: boolean | undefined;
  class: string;
  content: JSX.Element;
  children: JSX.Element;
};

export function SidebarRowTooltip(props: SidebarRowTooltipProps) {
  return (
    <Show when={props.enabled !== false} fallback={props.children}>
      <SidebarRowTooltipRoot {...props} />
    </Show>
  );
}

/** A tooltip that was open when it was disabled does not open again by itself. */
function SidebarRowTooltipRoot(props: SidebarRowTooltipProps) {
  const [open, setOpen] = createSignal(false);
  return (
    <Tooltip.Root
      open={open() && props.menuOpen !== true}
      onOpenChange={setOpen}
      placement="right"
      gutter={10}
      openDelay={props.openDelay}
      closeDelay={0}
      skipDelayDuration={300}
    >
      <Tooltip.Trigger as="div" class="sidebar-agent-tooltip-trigger">
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class={props.class}>{props.content}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
