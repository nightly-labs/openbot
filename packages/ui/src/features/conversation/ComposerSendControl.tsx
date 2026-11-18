import { ArrowUp, AudioLines, Button, LoaderCircle, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Match, Show, Switch } from "solid-js";
import { StopIcon } from "./ConversationIcons";

/** What Send does while the message box has nothing to send: start or end a voice conversation. */
export type ComposerSendVoice = "start" | "end";

export interface ComposerSendControlProps {
  /** Show Stop in place of Send: the agent works and the message box has nothing to send. */
  stop: boolean;
  onStop: () => void;
  /**
   * Show the voice conversation control in place of Send: the message box has nothing to send.
   * Stop has priority. Without it, Send shows.
   */
  voice?: ComposerSendVoice | undefined;
  onVoice?: (() => void) | undefined;
  /** The accessible name of Send. */
  label: string;
  keyShortcuts?: string | undefined;
  title?: string | undefined;
  disabled: boolean;
  /** A spinner replaces the arrow while the message goes. */
  busy: boolean;
  /** Without it, Send submits its form. */
  onSend?: (() => void) | undefined;
}

/** The Send button of a message box, Stop while the agent works, or voice while the box is empty. */
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
