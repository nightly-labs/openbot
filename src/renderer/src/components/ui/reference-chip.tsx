import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { Button } from "./button";

export const referenceChipClasses = {
  root: "reference-chip",
  icon: "reference-chip-icon",
  name: "reference-chip-name",
};

/** What a reader hears before the name, so a chip is not just a word in the sentence. */
const CHIP_KIND_LABELS: Record<ReferenceChipKind, string> = {
  agent: "Agent ",
  mcp: "MCP server ",
  plugin: "Plugin ",
  skill: "Skill ",
};

export type ReferenceChipKind = "agent" | "mcp" | "plugin" | "skill";

/** Shared appearance for rendered references and contenteditable tokens. */
export function ReferenceChip(props: {
  name: string;
  icon: JSX.Element;
  kind: ReferenceChipKind;
  class?: string;
  style?: JSX.CSSProperties;
  onClick?: (event: MouseEvent) => void;
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
          <span class="sr-only">{CHIP_KIND_LABELS[props.kind]}</span>
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
        onClick={(event) => props.onClick?.(event)}
      >
        {content()}
      </Button>
    </Show>
  );
}
