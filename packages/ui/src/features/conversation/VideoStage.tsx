import { ContextMenu } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { MediaGenerationSpecs } from "./media-generation-frame";

interface VideoStageAction {
  label: string;
  onSelect: () => void;
}

export interface VideoStageMenu {
  details: readonly (string | undefined)[];
  actions: readonly VideoStageAction[];
}

export function VideoStage(props: {
  class?: string | undefined;
  ratio: string;
  menu?: VideoStageMenu | undefined;
  children: JSX.Element;
}) {
  let stage: HTMLDivElement | undefined;
  const menuMount = () => stage?.querySelector<HTMLElement>(":popover-open") ?? document.body;
  const stageClass = () => ["media-generation-stage", props.class].filter(Boolean).join(" ");
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger
        as="div"
        ref={stage}
        class={stageClass()}
        style={{ "--media-generation-ratio": props.ratio }}
        disabled={!props.menu}
      >
        {props.children}
        <Show when={props.menu}>
          {(menu) => <MediaGenerationSpecs class="media-stage-details" values={menu().details} />}
        </Show>
      </ContextMenu.Trigger>
      <Show when={props.menu}>
        {(menu) => (
          <ContextMenu.Portal mount={menuMount()}>
            <ContextMenu.Content>
              <For each={menu().actions}>
                {(action) => <ContextMenu.Item onSelect={action.onSelect}>{action.label}</ContextMenu.Item>}
              </For>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        )}
      </Show>
    </ContextMenu.Root>
  );
}
