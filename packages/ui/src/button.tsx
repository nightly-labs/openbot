import { type ButtonRootProps, Root } from "@kobalte/core/button";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type { ComponentProps, JSX, ValidComponent } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { createEffect, createSignal, For, omit, onCleanup, Show } from "solid-js";
import { Check, Copy } from "./icons";
import { Spinner } from "./surface";
import { cx } from "./utils";

export const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-variant-default",
      outline: "ui-button-variant-outline",
      secondary: "ui-button-variant-secondary",
      ghost: "ui-button-variant-ghost",
      destructive: "ui-button-variant-destructive",
      "destructive-ghost": "ui-button-variant-destructive-ghost",
      link: "ui-button-variant-link",
    },
    size: {
      default: "ui-button-size-default",
      xs: "ui-button-size-xs",
      sm: "ui-button-size-sm",
      lg: "ui-button-size-lg",
      icon: "ui-button-size-icon",
      "icon-xs": "ui-button-size-icon-xs",
      "icon-sm": "ui-button-size-icon-sm",
      "icon-lg": "ui-button-size-icon-lg",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/** Cue markers that a caller can set in place of the default tap. */
const OTHER_CUE_MARKERS = [
  "data-cuelume-select",
  "data-cuelume-toggle",
  "data-cuelume-open",
  "data-cuelume-close",
  "data-cuelume-navigate",
] as const;

type OpenBotButtonProps = VariantProps<typeof buttonVariants> & {
  class?: JSX.HTMLAttributes<HTMLElement>["class"];
  children?: JSX.Element;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
} & { [Marker in (typeof OTHER_CUE_MARKERS)[number]]?: string | undefined };

export type ButtonProps<T extends ValidComponent = "button"> = PolymorphicProps<T, ButtonRootProps<T>> &
  OpenBotButtonProps &
  Partial<Pick<ComponentProps<T>, "class">>;

/** Variants for minor actions. With sound feedback on, they play a softer tap than a main action. */
const quietVariants = new Set<string>(["outline", "secondary", "ghost", "destructive-ghost", "link"]);

export function Button<T extends ValidComponent = "button">(props: ButtonProps<T>): JSX.Element {
  const others = omit(
    props,
    "variant",
    "size",
    "class",
    "children",
    "loading",
    "loadingLabel",
    "fullWidth",
    "disabled",
  );
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: Solid 2's omit cannot preserve Kobalte's generic polymorphic props.
  const rootProps = others as PolymorphicProps<T, ButtonRootProps<T>>;

  return (
    <Root<T>
      class={cx(
        buttonVariants({ variant: props.variant ?? "default", size: props.size ?? "default" }),
        props.fullWidth && "ui-button-full",
        props.class,
      )}
      data-slot="button"
      data-variant={props.variant ?? "default"}
      data-size={props.size ?? "default"}
      // bind() reads tap before the other markers, so drop the tap when a caller sets another one.
      data-cuelume-tap={OTHER_CUE_MARKERS.some((marker) => props[marker] !== undefined) ? undefined : ""}
      data-cuelume-emphasis={quietVariants.has(props.variant ?? "default") ? "subtle" : undefined}
      disabled={Boolean(props.disabled || props.loading)}
      aria-busy={props.loading ? "true" : undefined}
      {...rootProps}
    >
      <Show when={props.loading}>
        <Spinner size="sm" />
      </Show>
      {props.loading && props.loadingLabel ? props.loadingLabel : props.children}
    </Root>
  );
}

export type IconButtonSize = Extract<ButtonSize, "icon" | "icon-xs" | "icon-sm" | "icon-lg">;

export interface IconButtonProps extends Omit<ButtonProps, "children" | "fullWidth" | "size"> {
  label: string;
  children: JSX.Element;
  tooltip?: string;
  size?: IconButtonSize;
}

export function IconButton(props: IconButtonProps): JSX.Element {
  const others = omit(props, "label", "tooltip", "children", "class", "size");
  return (
    <Button
      class={cx("ui-icon-button", props.class)}
      size={props.size ?? "icon-sm"}
      aria-label={props.label}
      title={props.tooltip ?? props.label}
      {...others}
    >
      {props.children}
    </Button>
  );
}

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick" | "type" | "value"> {
  value: string | null | undefined;
  label?: string;
  copiedLabel?: string;
  iconOnly?: boolean;
  onCopyError?: (error: unknown) => void;
}

export function CopyButton(props: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: number | undefined;
  const others = omit(props, "value", "label", "copiedLabel", "iconOnly", "onCopyError", "disabled", "class", "size");

  function clearResetTimer(): void {
    if (resetTimer === undefined) return;
    window.clearTimeout(resetTimer);
    resetTimer = undefined;
  }

  createEffect(
    () => props.value,
    () => {
      clearResetTimer();
      setCopied(false);
    },
  );

  onCleanup(clearResetTimer);

  async function copyValue(): Promise<void> {
    if (!props.value) return;
    try {
      await navigator.clipboard.writeText(props.value);
      clearResetTimer();
      setCopied(true);
      resetTimer = window.setTimeout(() => {
        resetTimer = undefined;
        setCopied(false);
      }, 1_500);
    } catch (error) {
      clearResetTimer();
      setCopied(false);
      props.onCopyError?.(error);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={props.size ?? (props.iconOnly ? "icon-sm" : "sm")}
      class={cx(props.iconOnly && "ui-icon-button", props.class)}
      disabled={Boolean(props.disabled || !props.value)}
      data-copied={copied() ? "" : undefined}
      data-cuelume-tap="success"
      {...others}
      onClick={() => void copyValue()}
    >
      <Show when={copied()} fallback={<Copy aria-hidden="true" />}>
        <Check aria-hidden="true" />
      </Show>
      <Show
        when={!props.iconOnly}
        fallback={
          <span class="sr-only" aria-live="polite">
            {copied() ? (props.copiedLabel ?? "Copied") : (props.label ?? "Copy")}
          </span>
        }
      >
        <StableLabel labels={[props.label ?? "Copy", props.copiedLabel ?? "Copied"]} active={copied() ? 1 : 0} live />
      </Show>
    </Button>
  );
}

/**
 * A label that swaps between texts without a change in width: every text takes the same grid cell,
 * and only the active one is visible. A button that says "Copied" after a click does not push the
 * text beside it to a new line.
 */
export function StableLabel(props: { labels: readonly string[]; active: number; live?: boolean }): JSX.Element {
  return (
    <span class="ui-stable-label">
      <span class="ui-stable-label-text" aria-live={props.live ? "polite" : undefined}>
        {props.labels[props.active]}
      </span>
      <For each={props.labels}>
        {(label) => (
          <span class="ui-stable-label-sizer" aria-hidden="true">
            {label}
          </span>
        )}
      </For>
    </span>
  );
}
