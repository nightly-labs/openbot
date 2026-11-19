import type { SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { cx } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
import { SettingsPageFrame } from "../src/features/window/SettingsPageFrame";
import "./settings-page-story.css";

export function SettingsPageStory(props: {
  title: string;
  class?: string | undefined;
  controls?: JSX.Element;
  onEscape?: () => void;
  children: (page: () => SettingsPagePlacement | undefined) => JSX.Element;
}) {
  const [page, setPage] = createSignal<SettingsPagePlacement>();
  return (
    <div class={cx("settings-page-story", props.class)}>
      <SettingsPageFrame
        heading={<h1 class="settings-page-title">{props.title}</h1>}
        onMounts={setPage}
        onEscape={() => props.onEscape?.()}
        onClose={() => props.onEscape?.()}
      >
        {props.controls}
      </SettingsPageFrame>
      {props.children(page)}
    </div>
  );
}
