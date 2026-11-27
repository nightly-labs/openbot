import { Button, ChevronRight, Settings } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export interface SettingLinkCardProps {
  title: string;
  path: readonly string[];
  onOpen?: (() => void) | undefined;
  note?: string | undefined;
  icon?: JSX.Element | undefined;
}

export function SettingLinkCard(props: SettingLinkCardProps) {
  const { t } = useText();
  return (
    <UiBlockCard
      class="marketplace-suggestion setting-link-card"
      status="pending"
      inlineActions
      icon={<span class="ui-block-icon setting-link-icon">{props.icon ?? <Settings aria-hidden="true" />}</span>}
      title={props.title}
      subtitle={
        <span class="setting-link-path">
          <For each={props.path}>
            {(part, index) => (
              <>
                <Show when={index() > 0}>
                  <ChevronRight class="setting-link-path-chevron" aria-hidden="true" />
                </Show>
                <span>{part}</span>
              </>
            )}
          </For>
        </span>
      }
      actions={
        <Show when={props.onOpen}>
          {(open) => (
            <Button type="button" size="sm" onClick={() => open()()}>
              {t("chat.actionCard.open")}
            </Button>
          )}
        </Show>
      }
    >
      <Show when={props.note}>{(note) => <p class="setting-link-note">{note()}</p>}</Show>
    </UiBlockCard>
  );
}
