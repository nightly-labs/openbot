import type { TooltipRootOptions } from "@kobalte/core/tooltip";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal } from "solid-js";
import { Tooltip } from "./complex";
import { type MotionPlace, panelShownInGroup, useMenuMotion } from "./menu-motion";

const LABEL_OPEN_DELAY = 150;
const LABEL_CLOSE_DELAY = 0;

export interface MotionTooltipProps {
  content: JSX.Element;
  class?: string;
  placement?: TooltipRootOptions["placement"];
  openDelay?: number;
  closeDelay?: number;
  suppressed?: boolean;
  children: JSX.Element;
}

function MotionTooltipContent(props: {
  place: () => MotionPlace | undefined;
  class: string | undefined;
  children: JSX.Element;
}) {
  const motion = useMenuMotion(props.place);
  return (
    <Tooltip.Content
      ref={motion}
      class={props.class ? `ui-motion-tooltip ${props.class}` : "ui-motion-tooltip ui-motion-tooltip-label"}
    >
      {props.class ? props.children : <span>{props.children}</span>}
    </Tooltip.Content>
  );
}

export function MotionTooltip(props: MotionTooltipProps) {
  const [open, setOpen] = createSignal(false);
  createEffect(
    () => props.suppressed,
    (suppressed) => {
      if (suppressed) setOpen(false);
    },
  );
  let trigger: HTMLElement | undefined;
  const place = (): MotionPlace | undefined => {
    const group = trigger?.parentElement;
    return trigger && group ? { trigger, group } : undefined;
  };
  return (
    <Tooltip.Root
      open={open() && !props.suppressed}
      onOpenChange={setOpen}
      placement={props.placement ?? "right"}
      gutter={10}
      openDelay={props.openDelay ?? LABEL_OPEN_DELAY}
      closeDelay={props.closeDelay ?? LABEL_CLOSE_DELAY}
      skipDelayDuration={300}
    >
      <Tooltip.Trigger
        as="div"
        ref={(element: HTMLElement) => {
          trigger = element;
        }}
        class="ui-motion-tooltip-trigger"
        onPointerEnter={(event: PointerEvent) => {
          const group = place()?.group;
          if (event.pointerType !== "touch" && group && panelShownInGroup(group)) setOpen(true);
        }}
        onFocusIn={(event: FocusEvent) => {
          if (event.target instanceof Element && event.target.matches(":focus-visible")) setOpen(true);
        }}
        onFocusOut={() => setOpen(false)}
      >
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <MotionTooltipContent place={place} class={props.class}>
          {props.content}
        </MotionTooltipContent>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
