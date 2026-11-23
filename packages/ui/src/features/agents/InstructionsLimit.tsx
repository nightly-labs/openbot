import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";

const COUNTER_FROM = 0.9;

export function instructionsTooLong(text: string, limit: number = INPUT_LIMITS.agentDescription): boolean {
  return text.length > limit;
}

export function InstructionsLimit(props: {
  text: string;
  limit?: number;
  tooLong?: "agent.instructions.tooLong" | "agent.description.tooLong";
}): JSX.Element {
  const { t, format } = useText();
  const max = () => props.limit ?? INPUT_LIMITS.agentDescription;
  const limit = () => format.number(max());
  return (
    <Show when={props.text.length >= max() * COUNTER_FROM}>
      <span class="ui-field-limit">
        <span class="ui-field-description">
          {t("agent.instructions.length", { length: format.number(props.text.length), limit: limit() })}
        </span>
        <Show when={instructionsTooLong(props.text, max())}>
          <span class="ui-field-error" role="alert">
            {t(props.tooLong ?? "agent.instructions.tooLong", { limit: limit() })}
          </span>
        </Show>
      </span>
    </Show>
  );
}
