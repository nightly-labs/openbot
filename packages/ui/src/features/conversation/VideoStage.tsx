import { ContextMenu } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { MediaGenerationSpecs } from "./media-generation-frame";

interface VideoStageAction {
  label: string;
  onSelect: () => void;
}

/** The details of a video, which show on hover, and its actions, which show on a right click. */
export interface VideoStageMenu {
  /** Short facts for one line, such as the name and the size. */
  details: readonly (string | undefined)[];
  actions: readonly VideoStageAction[];
}

/**
 * The frame of a video in a chat. The chat shows only the player. The details show at the top of the
 * frame on hover, as on a canvas node, and the actions are in the menu of a right click.
 */
export function VideoStage(props: {
  class?: string | undefined;
  /** The shape of the frame, as a CSS ratio such as "16 / 9". */
  ratio: string;
  /** Absent, a right click does nothing, as while the video is made. */
  menu?: VideoStageMenu | undefined;
  children: JSX.Element;
}) {
  let stage: HTMLDivElement | undefined;
  // In full screen the player is in the top layer, so the menu must open in the player.
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
