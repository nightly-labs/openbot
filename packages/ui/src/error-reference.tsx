import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { CopyButton } from "./button";
import { useText } from "./text";
import { cx } from "./utils";

export interface ErrorReferenceProps {
  /** The code `errorReference` built for the failure. Nothing renders without one. */
  reference: string | null | undefined;
  class?: string;
}

/**
 * The code of a failure, beside the sentence that explains it. A user copies it into a report, so
 * support can find the cause behind a general sentence such as "The connection failed".
 */
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
