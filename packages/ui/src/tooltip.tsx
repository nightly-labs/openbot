import type { TooltipRootOptions } from "@kobalte/core/tooltip";
import type { JSX } from "@solidjs/web";
import { createContext, createSignal, useContext } from "solid-js";
import { Tooltip } from "./complex";
import { cx } from "./utils";

type Side = "top" | "right" | "bottom" | "left";

const TriggerContext = createContext<((element: HTMLElement) => void) | null>(null);

export interface LabelTooltipProps {
  content: JSX.Element;
  placement?: TooltipRootOptions["placement"];
  class?: string;
  disabled?: boolean;
  children: JSX.Element;
}

export function LabelTooltip(props: LabelTooltipProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [side, setSide] = createSignal<Side>("top");
  let trigger: HTMLElement | undefined;
  return (
    <TriggerContext
      value={(element) => {
        trigger = element;
      }}
    >
      <Tooltip.Root
        open={open()}
        onOpenChange={(next) =>
          setOpen(next && (!trigger || trigger.matches(":hover") || trigger.matches(":focus-visible")))
        }
        onCurrentPlacementChange={(placement) => {
          const [current = "top"] = placement.split("-");
          if (current === "top" || current === "right" || current === "bottom" || current === "left") {
            setSide(current);
          }
        }}
        placement={props.placement ?? "top"}
        gutter={8}
        openDelay={250}
        closeDelay={75}
        disabled={props.disabled ?? false}
      >
        {props.children}
        <Tooltip.Portal>
          <Tooltip.Content class={cx("ui-tooltip", props.class)} data-placement={side()}>
            {props.content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </TriggerContext>
  );
}

export const LabelTooltipTrigger: typeof Tooltip.Trigger = (props) => {
  const register = useContext(TriggerContext);
  return (
    <Tooltip.Trigger
      {...props}
      ref={[
        props.ref,
        (element: HTMLElement) => {
          register?.(element);
        },
      ]}
    />
  );
};
