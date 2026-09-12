import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { Button } from "./button";

export const referenceChipClasses = {
  root: "reference-chip",
  icon: "reference-chip-icon",
  name: "reference-chip-name",
};

/** Shared appearance for rendered references and contenteditable tokens. */
export function ReferenceChip(props: {
  name: string;
  icon: JSX.Element;
  kind: "agent" | "skill";
  class?: string;
  style?: JSX.CSSProperties;
  onClick?: () => void;
}) {
  const content = () => (
    <>
      <span class={referenceChipClasses.icon} aria-hidden="true">
        {props.icon}
      </span>
      <span class={referenceChipClasses.name}>{props.name}</span>
    </>
  );
  return (
    <Show
      when={props.onClick}
      fallback={
        <span
          class={[referenceChipClasses.root, props.class]}
          data-kind={props.kind}
          style={props.style}
          title={props.name}
        >
          <span class="sr-only">{props.kind === "skill" ? "Skill " : "Agent "}</span>
          {content()}
        </span>
      }
    >
      <Button
        variant="ghost"
        class={[referenceChipClasses.root, props.class]}
        data-kind={props.kind}
        style={props.style}
        title={props.name}
        aria-label={`Open ${props.kind} ${props.name}`}
        onClick={() => props.onClick?.()}
      >
        {content()}
      </Button>
    </Show>
  );
}
