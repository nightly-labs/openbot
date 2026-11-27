import { ArrowUp, AudioLines, Button, LoaderCircle, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Match, Show, Switch } from "solid-js";
import { StopIcon } from "./ConversationIcons";

export type ComposerSendVoice = "start" | "end";

export interface ComposerSendControlProps {
  stop: boolean;
  onStop: () => void;
  voice?: ComposerSendVoice | undefined;
  onVoice?: (() => void) | undefined;
  label: string;
  keyShortcuts?: string | undefined;
  title?: string | undefined;
  disabled: boolean;
  busy: boolean;
  onSend?: (() => void) | undefined;
}

export function ComposerSendControl(props: ComposerSendControlProps) {
  const { t } = useText();
  const sendType = () => (props.onSend ? "button" : "submit");
  const voiceLabel = () => (props.voice === "end" ? t("conversation.voice.end") : t("conversation.voice.start"));
  const voiceTap = () => (props.voice === "end" ? "close" : "open");
  return (
    <Switch
      fallback={
        <Button
          variant="ghost"
          type={sendType()}
          class="voice-button"
          aria-label={props.label}
          aria-keyshortcuts={props.keyShortcuts}
          title={props.title}
          data-cuelume-emphasis="normal"
          disabled={props.disabled}
          onClick={() => props.onSend?.()}
        >
          <Show when={props.busy} fallback={<ArrowUp aria-hidden="true" />}>
            <LoaderCircle class="composer-spinner" aria-hidden="true" />
          </Show>
        </Button>
      }
    >
      <Match when={props.stop}>
        <Button
          variant="ghost"
          type="button"
          class="voice-button voice-button-active"
          aria-label={t("composer.send.stop")}
          data-cuelume-tap="close"
          onClick={() => props.onStop()}
        >
          <StopIcon />
        </Button>
      </Match>
      <Match when={props.voice && props.onVoice}>
        <Button
          variant="ghost"
          type="button"
          class="voice-button"
          aria-label={voiceLabel()}
          title={voiceLabel()}
          data-cuelume-tap={voiceTap()}
          onClick={() => props.onVoice?.()}
        >
          <Show when={props.voice === "end"} fallback={<AudioLines aria-hidden="true" />}>
            <X aria-hidden="true" />
          </Show>
        </Button>
      </Match>
    </Switch>
  );
}
