import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, Show } from "solid-js";
import { useText } from "../../text";
import {
  CHAT_BACKDROP_LABEL,
  CHAT_BACKDROP_SCENES,
  type ChatBackdropChoice,
  customBackdropChoice,
  customBackdropId,
  isChatBackdropChoice,
  isChatBackdropScene,
} from "../conversation/chat-backdrop";

type Option = ChatBackdropChoice | "none";

/** A backdrop that the user added, as Settings lists it. */
export interface ChatBackdropSelectCustom {
  id: string;
  name: string;
}

export interface ChatBackdropSelectProps {
  value: ChatBackdropChoice | null;
  onChange: (value: ChatBackdropChoice | null) => void;
  /** The backdrops that the user added on this device, oldest first. */
  custom: readonly ChatBackdropSelectCustom[];
  /** The picture types that the upload accepts, as the file input `accept` value. */
  accept: string;
  onUpload: (file: File) => void;
  onRemove: (id: string) => void;
  busy?: boolean;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/** The "Backdrop" row control in Settings, on the desktop and in the web client. */
export function ChatBackdropSelect(props: ChatBackdropSelectProps): JSX.Element {
  const { t } = useText();
  let fileInput: HTMLInputElement | undefined;
  // A new array on each change of the list only: Kobalte loops when it gets a new array on each read.
  const options = createMemo<Option[]>(() => [
    "none",
    ...CHAT_BACKDROP_SCENES,
    ...props.custom.map((backdrop) => customBackdropChoice(backdrop.id)),
  ]);
  const names = createMemo(() => new Map(props.custom.map((backdrop) => [backdrop.id, backdrop.name])));
  const label = (option: Option | undefined) => {
    if (option === undefined || option === "none") return t("settings.chatBackdrop.none");
    if (isChatBackdropScene(option)) return t(CHAT_BACKDROP_LABEL[option]);
    return names().get(customBackdropId(option) ?? "") ?? t("settings.chatBackdrop.none");
  };
  // A saved choice whose backdrop is gone shows as None, which is what the window shows.
  const value = (): Option => {
    const current = props.value;
    return current !== null && options().includes(current) ? current : "none";
  };
  const selectedCustomId = () => {
    const current = value();
    return current === "none" ? null : customBackdropId(current);
  };
  return (
    <div class="settings-backdrop-control">
      <Input
        ref={(element: HTMLInputElement) => (fileInput = element)}
        // Hidden, so the button below is the one "Upload image…" that a screen reader finds.
        hidden
        type="file"
        tabindex={-1}
        aria-label={t("settings.chatBackdrop.upload")}
        accept={props.accept}
        onChange={(event: Event & { currentTarget: HTMLInputElement }) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) props.onUpload(file);
        }}
      />
      <Show when={selectedCustomId()}>
        {(id) => (
          <Button variant="ghost" size="sm" type="button" disabled={props.busy} onClick={() => props.onRemove(id())}>
            {t("common.remove")}
          </Button>
        )}
      </Show>
      <Button variant="outline" size="sm" type="button" disabled={props.busy} onClick={() => fileInput?.click()}>
        {t("settings.chatBackdrop.upload")}
      </Button>
      <Select<Option>
        class="settings-modal-select"
        options={options()}
        value={value()}
        onChange={(option) =>
          option && props.onChange(option !== "none" && isChatBackdropChoice(option) ? option : null)
        }
        placement="bottom-end"
        itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{label(itemProps.item.rawValue)}</SelectItem>}
      >
        <SelectTrigger size="sm" aria-label={t("settings.chatBackdrop.title")}>
          <SelectValue<Option>>{(state) => label(state.selectedOption())}</SelectValue>
        </SelectTrigger>
        <SelectContent mount={props.mount} />
      </Select>
    </div>
  );
}
