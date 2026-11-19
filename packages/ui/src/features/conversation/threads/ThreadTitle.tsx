import { Show } from "solid-js";

const NUMBERED_TITLE = /^(.*\S)( #\d+)$/;

export function ThreadTitle(props: { title: string; class: string }) {
  const numbered = () => NUMBERED_TITLE.exec(props.title);
  return (
    <Show
      when={numbered()}
      fallback={
        <span class={props.class} dir="auto">
          {props.title}
        </span>
      }
    >
      {(parts) => (
        <span class={[props.class, "agent-threads-title-numbered"]}>
          <span class="agent-threads-title-root" dir="auto">
            {parts()[1]}
          </span>
          <span class="agent-threads-title-number">{parts()[2]}</span>
        </span>
      )}
    </Show>
  );
}
