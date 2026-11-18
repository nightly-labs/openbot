import { Button, ChevronRight, Settings } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export interface SettingLinkCardProps {
  /** The name of the setting. */
  title: string;
  /** Where the setting is, from the outside in, such as "Your settings", "Voice". */
  path: readonly string[];
  /** Opens the settings at the row. Without it, the card shows only where the setting is. */
  onOpen?: (() => void) | undefined;
  /** Why the card has no Open, such as a setting of the desktop app in the web client. */
  note?: string | undefined;
}

/** A setting that an agent showed in the chat. Open goes to its row; the user changes it there. */
export function SettingLinkCard(props: SettingLinkCardProps) {
  const { t } = useText();
  return (
    <UiBlockCard
      class="marketplace-suggestion setting-link-card"
      status="pending"
      inlineActions
      icon={
        <span class="ui-block-icon setting-link-icon">
          <Settings aria-hidden="true" />
        </span>
      }
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
