import { Show } from "solid-js";

/** A title that ends in a number, as the " #2" of a branch. */
const NUMBERED_TITLE = /^(.*\S)( #\d+)$/;

/**
 * A thread title. When a narrow tab or menu cuts it, the end of a numbered title stays in view, so
 * that branches of one thread do not read the same.
 */
export function ThreadTitle(props: { title: string; class: string }) {
  const numbered = () => NUMBERED_TITLE.exec(props.title);
  return (
    <Show when={numbered()} fallback={<span class={props.class}>{props.title}</span>}>
      {(parts) => (
        <span class={[props.class, "agent-threads-title-numbered"]}>
          <span class="agent-threads-title-root">{parts()[1]}</span>
          <span class="agent-threads-title-number">{parts()[2]}</span>
        </span>
      )}
    </Show>
  );
}
