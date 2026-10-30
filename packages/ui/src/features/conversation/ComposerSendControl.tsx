import { ArrowUp, Button, LoaderCircle } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { StopIcon } from "./ConversationIcons";

export interface ComposerSendControlProps {
  /** Show Stop in place of Send: the agent works and the message box has nothing to send. */
  stop: boolean;
  onStop: () => void;
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

/** The Send button of a message box, or Stop while the agent works. */
export function ComposerSendControl(props: ComposerSendControlProps) {
  const { t } = useText();
  const sendType = () => (props.onSend ? "button" : "submit");
  return (
    <Show
      when={props.stop}
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
    </Show>
  );
}
