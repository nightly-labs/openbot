import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { CopyButton } from "./button";
import { useText } from "./text";
import { cx } from "./utils";

export interface ErrorReferenceProps {
  reference: string | null | undefined;
  class?: string;
}

export function ErrorReference(props: ErrorReferenceProps): JSX.Element {
  const { t } = useText();
  return (
    <Show when={props.reference}>
      {(reference) => (
        <span class={cx("ui-error-reference", props.class)}>
          <span class="ui-error-reference-code">{t("error.reference.label", { code: reference() })}</span>
          <CopyButton
            value={reference()}
            iconOnly
            size="icon-xs"
            label={t("error.reference.copy")}
            copiedLabel={t("error.reference.copied")}
          />
        </span>
      )}
    </Show>
  );
}
