/** A prompt step: a text input for the steps after it. */

import { CopyButton, LabelTooltipTrigger, Textarea } from "@openbot/ui";
import { untrack } from "solid-js";
import { useText } from "../../text";
import { Hint } from "./workflow-board";
import { Field, NodeShell, NodeToolbar, useLocked, useTextField } from "./workflow-node-parts";

/** A text input for the steps after it. One field fills the card; the output is text. */
export function PromptNode(props: { id: string; text?: string }) {
  const { t } = useText();
  const [text, setText] = useTextField(
    () => props.id,
    "text",
    untrack(() => props.text ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  return (
    <NodeShell
      id={props.id}
      label={t("workflow.prompt.title")}
      kind="prompt"
      output="text"
      toolbar={
        <NodeToolbar id={props.id} name={t("workflow.prompt.name")} locked={locked()} onLock={setLocked}>
          <Hint label={t("workflow.prompt.copy")}>
            <LabelTooltipTrigger
              as={CopyButton}
              iconOnly
              class="wfn-tool-action"
              value={text()}
              label={t("workflow.prompt.copy")}
              aria-label={t("workflow.prompt.copyLabel")}
            />
          </Hint>
        </NodeToolbar>
      }
    >
      <Field class="wfn-field-fill">
        <Textarea
          class="wfn-input"
          aria-label={t("workflow.prompt.title")}
          placeholder={t("workflow.prompt.placeholder")}
          readonly={locked()}
          value={text()}
          onValueChange={setText}
        />
      </Field>
    </NodeShell>
  );
}
