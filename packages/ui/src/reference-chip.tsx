import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { Button } from "./button";
import { useText } from "./text";

export const referenceChipClasses = {
  root: "reference-chip",
  icon: "reference-chip-icon",
  name: "reference-chip-name",
};

/** What a reader hears before the name, so a chip is not just a word in the sentence. */
const CHIP_KIND_LABELS = {
  agent: "chat.reference.kind.agent",
  mcp: "chat.reference.kind.mcp",
  plugin: "chat.reference.kind.plugin",
  skill: "chat.reference.kind.skill",
} as const satisfies Record<ReferenceChipKind, AppTextKey>;

const CHIP_OPEN_LABELS = {
  agent: "chat.reference.open.agent",
  mcp: "chat.reference.open.mcp",
  plugin: "chat.reference.open.plugin",
  skill: "chat.reference.open.skill",
} as const satisfies Record<ReferenceChipKind, string>;

export type ReferenceChipKind = "agent" | "mcp" | "plugin" | "skill";

/** Shared appearance for rendered references and contenteditable tokens. */
export function ReferenceChip(props: {
  name: string;
  icon: JSX.Element;
  kind: ReferenceChipKind;
  class?: string;
  style?: JSX.CSSProperties;
  onClick?: (event: MouseEvent) => void;
  /** Sound cue for the click. The default is `open`. */
  "data-cuelume-tap"?: string;
}) {
  const { t } = useText();
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
          <span class="sr-only">{`${t(CHIP_KIND_LABELS[props.kind])} `}</span>
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
        aria-label={t(CHIP_OPEN_LABELS[props.kind], { name: props.name })}
        data-cuelume-tap={props["data-cuelume-tap"] ?? "open"}
        onClick={(event) => props.onClick?.(event)}
      >
        {content()}
      </Button>
    </Show>
  );
}
