import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { TalkKeyCaps } from "../conversation/TalkKeyCaps";
import {
  defaultTalkKey,
  isTalkKeyCode,
  isValidTalkKey,
  sameTalkKey,
  type TalkKey,
  type TalkKeyBinding,
  talkKeyOfEvent,
} from "../conversation/talk-key";

export interface TalkKeyRecorderProps {
  binding: TalkKeyBinding;
  onChange: (key: TalkKey | null) => void;
}

function keyCount(key: TalkKey): number {
  return [key.ctrl, key.alt, key.shift, key.meta, key.code !== null].filter(Boolean).length;
}

export function TalkKeyRecorder(props: TalkKeyRecorderProps): JSX.Element {
  const { t } = useText();
  const [recording, setRecording] = createSignal(false);
  const [held, setHeld] = createSignal<TalkKey | null>(null);
  const [refused, setRefused] = createSignal(false);
  let root!: HTMLDivElement;
  const isDefault = () => sameTalkKey(props.binding.key, defaultTalkKey(props.binding.platform));

  const swallow = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const down = (event: KeyboardEvent) => {
    swallow(event);
    if (event.code === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      stop();
      return;
    }
    const pressed = talkKeyOfEvent(event);
    if (pressed.code !== null && !isTalkKeyCode(pressed.code)) return;
    const before = held();
    if (!before || keyCount(pressed) >= keyCount(before)) setHeld(pressed);
  };
  const up = (event: KeyboardEvent) => {
    swallow(event);
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    const chord = held();
    setHeld(null);
    if (!chord) return;
    if (!isValidTalkKey(chord)) {
      setRefused(true);
      return;
    }
    stop();
    if (!sameTalkKey(chord, props.binding.key)) props.onChange(chord);
  };
  const pressOutside = (event: PointerEvent) => {
    if (!(event.target instanceof Node && root.contains(event.target))) stop();
  };

  function start(): void {
    if (recording()) return;
    setHeld(null);
    setRefused(false);
    setRecording(true);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", stop);
    window.addEventListener("pointerdown", pressOutside, true);
  }

  function stop(): void {
    if (!recording()) return;
    setRecording(false);
    setHeld(null);
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", up, true);
    window.removeEventListener("blur", stop);
    window.removeEventListener("pointerdown", pressOutside, true);
  }

  onCleanup(stop);

  return (
    <div class="talk-key-recorder" ref={root}>
      <Show when={!isDefault() && !recording()}>
        <Button variant="ghost" size="sm" type="button" onClick={() => props.onChange(null)}>
          {t("settings.voice.talkKey.reset")}
        </Button>
      </Show>
      <Button
        variant="outline"
        size="sm"
        type="button"
        class="talk-key-recorder-button"
        aria-label={t("settings.voice.talkKey.change")}
        aria-pressed={recording() ? "true" : "false"}
        onClick={start}
        onBlur={stop}
      >
        <Show when={recording()} fallback={<TalkKeyCaps binding={props.binding} class="talk-key-recorder-caps" />}>
          <Show
            when={held()}
            fallback={
              <span class="talk-key-recorder-prompt" aria-live="polite">
                {t(refused() ? "settings.voice.talkKey.refused" : "settings.voice.talkKey.recording")}
              </span>
            }
          >
            {(chord) => <TalkKeyCaps binding={{ ...props.binding, key: chord() }} class="talk-key-recorder-caps" />}
          </Show>
        </Show>
      </Button>
    </div>
  );
}
