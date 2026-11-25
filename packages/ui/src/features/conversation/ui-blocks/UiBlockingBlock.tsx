import type { UiBlockResponse, UiBlockSpec } from "@openbot/contracts/ui-blocks";
import type { JSX } from "@solidjs/web";
import { Match, Switch } from "solid-js";
import { UiChoiceBlock } from "./UiChoiceBlock";
import { UiConfirmBlock } from "./UiConfirmBlock";
import { UiFormBlock } from "./UiFormBlock";
import type { UiBlockProps } from "./ui-block-support";

export interface UiBlockingBlockProps extends Omit<UiBlockProps<UiBlockSpec>, "onRespond"> {
  onRespond: (response: UiBlockResponse, preview?: string) => void;
  renderPreview?: ((markdown: string) => JSX.Element) | undefined;
  canEditPreview?: boolean | undefined;
  onPreviewDraftChange?: ((draft: string | undefined) => void) | undefined;
}

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
        {(spec) => (
          <UiConfirmBlock
            {...shared}
            spec={spec()}
            renderPreview={props.renderPreview}
            canEditPreview={props.canEditPreview}
            onDraftChange={props.onPreviewDraftChange}
          />
        )}
      </Match>
      <Match when={(props.spec.type === "choice" || props.spec.type === "quick_replies") && props.spec}>
        {(spec) => <UiChoiceBlock {...shared} spec={spec()} />}
      </Match>
      <Match when={props.spec.type === "form" && props.spec}>
        {(spec) => <UiFormBlock {...shared} spec={spec()} />}
      </Match>
    </Switch>
  );
}
