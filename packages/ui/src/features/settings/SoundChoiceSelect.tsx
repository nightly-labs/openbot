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

/** How long the playing icon shows. The cues are shorter than this. */
const PLAYING_MS = 600;
/** Keys that do not move the focus in the menu. Arrow keys, Home, End and typeahead letters do. */
const NO_MOVE_KEYS = new Set(["Enter", " ", "Escape", "Tab"]);

export interface SoundChoiceSelectProps<Choice extends TaskSoundChoice> {
  /** The accessible name of the menu button. */
  label: string;
  choices: readonly Choice[];
  value: Choice;
  /** The app saves the choice and plays it. */
  onChange: (value: Choice) => void;
  /** Plays a sound without choosing it, from the play icon or the arrow keys. "off" is never played. */
  onPreview: (value: Choice) => void;
  /** The dialog element the popover portals into, as the other Settings selects receive it. */
  mount?: HTMLElement | undefined;
}

/**
 * A sound menu. Each sound has a play icon before its name, so the user can listen to it before
 * choosing it. The arrow keys also play each sound, for keyboard and screen reader users.
 */
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
  // Kobalte also focuses an item on hover and when the menu opens. Only a key that moves the focus
  // plays the sound. The mouse moves first when the user goes back to the pointer.
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
              // Off has no sound to play. The empty slot keeps the names in line.
              <span class="ui-button-size-icon-xs sound-choice-item-play" />
            ) : (
              // A button in a listbox option breaks the listbox (axe `nested-interactive`), so the icon
              // is hidden from assistive technology. It stops the press, so the menu stays open and
              // the choice does not change.
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
