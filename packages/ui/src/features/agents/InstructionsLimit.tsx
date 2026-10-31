import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";

// The field shows its count from this share of the limit on, so a short text has no counter.
const COUNTER_FROM = 0.9;

export function instructionsTooLong(text: string, limit: number = INPUT_LIMITS.agentDescription): boolean {
  return text.length > limit;
}

/**
 * The count under an instructions field near its limit, and an error over it. The field keeps the
 * whole text rather than cutting it at the limit, so the user sees what does not fit and shortens it.
 */
export function InstructionsLimit(props: {
  text: string;
  /** Omitted, the limit of an agent's description. */
  limit?: number;
  /** The error over the limit. Omitted, it names the instructions. */
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
