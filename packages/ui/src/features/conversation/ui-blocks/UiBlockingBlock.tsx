import type { UiBlockingBlockSpec } from "@openbot/contracts/ui-blocks";
import type { JSX } from "@solidjs/web";
import { Match, Switch } from "solid-js";
import { UiChoiceBlock } from "./UiChoiceBlock";
import { UiConfirmBlock } from "./UiConfirmBlock";
import { UiFormBlock } from "./UiFormBlock";
import { UiQuickReplies } from "./UiQuickReplies";
import type { UiBlockProps } from "./ui-block-support";

export interface UiBlockingBlockProps extends UiBlockProps<UiBlockingBlockSpec> {
  /** Draws a confirm block's preview as safe Markdown. */
  renderPreview?: ((markdown: string) => JSX.Element) | undefined;
}

/** The card for any blocking block type: confirm, choice, quick replies or form. */
export function UiBlockingBlock(props: UiBlockingBlockProps) {
  const shared = {
    get state() {
      return props.state;
    },
    get onRespond() {
      return props.onRespond;
    },
    get disabled() {
      return props.disabled;
    },
    get busy() {
      return props.busy;
    },
    get error() {
      return props.error;
    },
    get onSkip() {
      return props.onSkip;
    },
    get class() {
      return props.class;
    },
    get elementRef() {
      return props.elementRef;
    },
  };
  return (
    <Switch>
      <Match when={props.spec.type === "confirm" && props.spec}>
        {(spec) => <UiConfirmBlock {...shared} spec={spec()} renderPreview={props.renderPreview} />}
      </Match>
      <Match when={props.spec.type === "choice" && props.spec}>
        {(spec) => <UiChoiceBlock {...shared} spec={spec()} />}
      </Match>
      <Match when={props.spec.type === "quick_replies" && props.spec}>
        {(spec) => <UiQuickReplies {...shared} spec={spec()} />}
      </Match>
      <Match when={props.spec.type === "form" && props.spec}>
        {(spec) => <UiFormBlock {...shared} spec={spec()} />}
      </Match>
    </Switch>
  );
}
