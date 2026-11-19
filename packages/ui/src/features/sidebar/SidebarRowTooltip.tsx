import { Tooltip } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";

type SidebarRowTooltipProps = {
  enabled?: boolean | undefined;
  openDelay: number;
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
