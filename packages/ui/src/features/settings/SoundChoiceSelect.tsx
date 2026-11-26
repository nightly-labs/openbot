import type { AppTextKey } from "@openbot/i18n";
import { AudioLines, Play, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, onCleanup } from "solid-js";
import { useText } from "../../text";
import type { TaskSoundChoice } from "./app-settings";

const CHOICE_NAME = {
  off: "settings.soundTheme.off",
  classic: "settings.soundTheme.classic",
  default: "settings.soundTheme.warm",
  mech: "settings.soundTheme.mech",
  bubble: "settings.soundTheme.bubble",
  press: "settings.soundTheme.press",
} as const satisfies Record<TaskSoundChoice, AppTextKey>;

const PLAYING_MS = 600;
const NO_MOVE_KEYS = new Set(["Enter", " ", "Escape", "Tab"]);

export interface SoundChoiceSelectProps<Choice extends TaskSoundChoice> {
  label: string;
  choices: readonly Choice[];
  value: Choice;
  onChange: (value: Choice) => void;
  onPreview: (value: Choice) => void;
  mount?: HTMLElement | undefined;
}

export function SoundChoiceSelect<Choice extends TaskSoundChoice>(props: SoundChoiceSelectProps<Choice>): JSX.Element {
  const { t } = useText();
  const name = (choice: TaskSoundChoice) => t(CHOICE_NAME[choice]);
  const [playing, setPlaying] = createSignal<Choice>();
  let playingTimer: number | undefined;
  const preview = (choice: Choice) => {
    props.onPreview(choice);
    window.clearTimeout(playingTimer);
    setPlaying(() => choice);
    playingTimer = window.setTimeout(() => setPlaying(undefined), PLAYING_MS);
  };
  let keyMove = false;
  const readKey = (event: KeyboardEvent) => {
    keyMove = !NO_MOVE_KEYS.has(event.key);
  };
  const readPointer = () => {
    keyMove = false;
  };
  window.addEventListener("keydown", readKey, true);
  window.addEventListener("pointermove", readPointer, true);
  onCleanup(() => {
    window.clearTimeout(playingTimer);
    window.removeEventListener("keydown", readKey, true);
    window.removeEventListener("pointermove", readPointer, true);
  });

  return (
    <Select<Choice>
      class="settings-modal-select"
      options={[...props.choices]}
      optionTextValue={name}
      value={props.value}
      onChange={(choice) => choice && props.onChange(choice)}
      placement="bottom-end"
      itemComponent={(itemProps) => (
        <SelectItem
          item={itemProps.item}
          onFocus={() => {
            const choice = itemProps.item.rawValue;
            if (choice !== "off" && keyMove) preview(choice);
          }}
        >
          <span class="sound-choice-item">
            {itemProps.item.rawValue === "off" ? (
              <span class="ui-button-size-icon-xs sound-choice-item-play" />
            ) : (
              <span
                class="ui-button ui-button-variant-ghost ui-button-size-icon-xs ui-icon-button sound-choice-item-play"
                aria-hidden="true"
                title={t("settings.soundTheme.play", { name: name(itemProps.item.rawValue) })}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  preview(itemProps.item.rawValue);
                }}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {playing() === itemProps.item.rawValue ? <AudioLines /> : <Play />}
              </span>
            )}
            <span class="sound-choice-item-name">{name(itemProps.item.rawValue)}</span>
          </span>
        </SelectItem>
      )}
    >
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue<Choice>>{(state) => name(state.selectedOption())}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
