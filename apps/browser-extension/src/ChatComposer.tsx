import { ArrowUp } from "@openbot/ui";
import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import { useText } from "@openbot/ui/text";
import { appendVoiceTranscript } from "@openbot/ui/voice-recording";
import { createSignal, onSettled, Show } from "solid-js";
import { DictationMic, DictationStrip } from "./DictationStrip";
import { createDictation } from "./dictation";

export function ChatComposer(props: {
  placeholder: string;
  error: string | null;
  conversationKey: string;
  onDismissError: () => void;
  sending: boolean;
  transcribe: ((wav: Uint8Array) => Promise<string>) | null;
  onSend: (text: string) => Promise<void>;
  onFocusReady?: (focus: () => void) => void;
}) {
  const { t } = useText();
  const [draft, setDraft] = createSignal("");
  let field: HTMLTextAreaElement | undefined;
  const dictation = props.transcribe
    ? createDictation({
        transcribe: props.transcribe,
        onText: (text) => {
          setDraft((current) => appendVoiceTranscript(current, text));
          queueMicrotask(() => {
            resize();
            field?.focus();
          });
        },
      })
    : null;
  const dictating = () => (dictation?.phase() ?? "idle") !== "idle";
  const recording = () => dictation?.phase() === "recording";
  const canSend = () => draft().trim().length > 0 && !props.sending && !dictating();

  onSettled(() => {
    props.onFocusReady?.(() => field?.focus());
    const drop = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dictation?.phase() === "recording") dictation.cancel();
    };
    document.addEventListener("keydown", drop);
    return () => document.removeEventListener("keydown", drop);
  });

  function resize() {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 100)}px`;
  }
  async function submit(event?: SubmitEvent) {
    event?.preventDefault();
    if (!canSend()) return;
    const text = draft().trim();
    setDraft("");
    queueMicrotask(resize);
    await props.onSend(text).catch(() => undefined);
  }

  function sendButton() {
    const label = () => t("extension.chat.send");
    return (
      <button
        type="submit"
        class="ch-send"
        data-ready={canSend() ? "" : undefined}
        disabled={!canSend()}
        aria-label={label()}
        title={label()}
      >
        <ArrowUp size={16} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div class="ext-bottom-bar ch-bottom">
      <div class="composer-stack">
        <ComposerStackCard when={props.error}>
          {(message) => (
            <ComposerErrorBanner
              message={message()}
              conversationKey={props.conversationKey}
              onDismiss={() => {
                props.onDismissError();
                field?.focus();
              }}
            />
          )}
        </ComposerStackCard>
        <ComposerStackCard when={dictation?.error()}>
          {(message) => (
            <ComposerErrorBanner
              message={message()}
              onDismiss={() => {
                dictation?.clearError();
                field?.focus();
              }}
            />
          )}
        </ComposerStackCard>
      </div>
      <form class="ext-field" onSubmit={(event) => void submit(event)}>
        <div class="ch-field">
          <Show when={dictation && recording() ? dictation : undefined}>
            {(voice) => <DictationStrip level={() => voice().levels().at(-1) ?? 0} seconds={voice().seconds()} />}
          </Show>
          <textarea
            ref={field}
            hidden={recording()}
            rows={1}
            value={draft()}
            readonly={dictation?.phase() === "transcribing"}
            placeholder={
              dictation?.phase() === "transcribing" ? t("extension.chat.dictation.transcribing") : props.placeholder
            }
            aria-label={props.placeholder}
            onInput={(event) => {
              setDraft(event.currentTarget.value);
              resize();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <Show when={dictation}>
            {(voice) => (
              <DictationMic
                active={voice().phase() === "recording"}
                disabled={voice().phase() === "starting" || voice().phase() === "transcribing"}
                label={
                  voice().phase() === "recording"
                    ? t("extension.chat.dictation.stop")
                    : t("extension.chat.dictation.start")
                }
                onPress={() => (voice().phase() === "recording" ? voice().stop() : void voice().start())}
              />
            )}
          </Show>
          {sendButton()}
        </div>
      </form>
    </div>
  );
}
