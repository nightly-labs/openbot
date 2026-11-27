import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { ArrowUp } from "@openbot/ui";
import { ComposerAttachmentRow } from "@openbot/ui/features/conversation/ComposerAttachmentRow";
import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import { useText } from "@openbot/ui/text";
import { appendVoiceTranscript } from "@openbot/ui/voice-recording";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { DictationMic, DictationStrip } from "./DictationStrip";
import { createDictation } from "./dictation";
import { clipboardImages, createPastedImages } from "./pasted-images";

export interface ComposerImages {
  accepts: boolean;
  upload: (file: File) => Promise<AttachmentSummary>;
  discard: (attachmentId: string) => void;
}

export function ChatComposer(props: {
  placeholder: string;
  error: string | null;
  conversationKey: string;
  onDismissError: () => void;
  sending: boolean;
  transcribe: ((wav: Uint8Array) => Promise<string>) | null;
  images: ComposerImages;
  onSend: (text: string, attachments: AttachmentSummary[]) => Promise<void>;
  onFocusReady?: (focus: () => void) => void;
}) {
  const { t } = useText();
  const [draft, setDraft] = createSignal("");
  const [imageError, setImageError] = createSignal<string | null>(null);
  const images = createPastedImages({
    upload: (file) => props.images.upload(file),
    discard: (attachmentId) => props.images.discard(attachmentId),
    onError: (error) =>
      setImageError(error instanceof Error && error.message ? error.message : t("composer.upload.failed")),
  });
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
  const canSend = () =>
    (draft().trim().length > 0 || images.ready().length > 0) && !props.sending && !dictating() && !images.busy();

  createEffect(
    () => `${props.conversationKey}:${props.images.accepts ? "images" : "text"}`,
    (_target, previous) => {
      if (previous !== undefined) images.clear();
    },
  );

  onSettled(() => {
    props.onFocusReady?.(() => field?.focus());
    const drop = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dictation?.phase() === "recording") dictation.cancel();
    };
    document.addEventListener("keydown", drop);
    return () => {
      document.removeEventListener("keydown", drop);
      images.clear();
    };
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
    const attachments = images.take();
    setDraft("");
    setImageError(null);
    queueMicrotask(resize);
    await props.onSend(text, attachments).catch(() => {
      for (const attachment of attachments) props.images.discard(attachment.id);
    });
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
        <ComposerStackCard when={imageError()}>
          {(message) => (
            <ComposerErrorBanner
              message={message()}
              onDismiss={() => {
                setImageError(null);
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
        <ComposerAttachmentRow
          attachments={images.ready()}
          pending={images.pending()}
          onRemove={(attachment) => {
            images.remove(attachment);
            field?.focus();
          }}
        />
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
            onPaste={(event) => {
              if (!props.images.accepts || dictation?.phase() === "transcribing") return;
              const files = clipboardImages(event.clipboardData);
              if (files.length === 0) return;
              event.preventDefault();
              setImageError(null);
              images.add(files);
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
                disabled={voice().phase() === "starting" || voice().phase() === "transcribing" || images.busy()}
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
