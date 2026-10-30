import type { TooltipRootOptions } from "@kobalte/core/tooltip";
import type { JSX } from "@solidjs/web";
import { createContext, createSignal, useContext } from "solid-js";
import { Tooltip } from "./complex";
import { cx } from "./utils";

type Side = "top" | "right" | "bottom" | "left";

const TriggerContext = createContext<((element: HTMLElement) => void) | null>(null);

export interface LabelTooltipProps {
  /** The text that names the control. */
  content: JSX.Element;
  /** The preferred side. The tooltip goes to the other side when it has no space. */
  placement?: TooltipRootOptions["placement"];
  class?: string;
  /** Keeps the tooltip closed. */
  disabled?: boolean;
  /** Contains one `LabelTooltipTrigger`. */
  children: JSX.Element;
}

/**
 * The tooltip that names a control. It opens on hover and on keyboard focus, and Escape, a click
 * or a pointer outside closes it. It shows on the tooltip layer, above dialogs and menus.
 */
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
        // Kobalte opens the tooltip on each focus. A dialog that moves the focus to its close button
        // must not open the tooltip, so a focus opens it only when the focus ring shows.
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

/** The control that opens the `LabelTooltip` around it. It takes the props of `Tooltip.Trigger`. */
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
