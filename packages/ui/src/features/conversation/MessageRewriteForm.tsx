import { Button, Textarea } from "@openbot/ui";
import { createSignal } from "solid-js";
import { useText } from "../../text";

/** A local text draft. Cancel does not change the thread. */
export function MessageRewriteForm(props: {
  text: string;
  onCancel: () => void;
  onSubmit: (text: string, requestId: string) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [text, setText] = createSignal(props.text);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Keep the same key when a lost response makes the user retry this draft.
  const requestId = crypto.randomUUID();
  const submit = async () => {
    if (submitting() || !text().trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onSubmit(text(), requestId);
    } catch (cause) {
      setError(errorMessage(cause, t("chat.rewrite.failed")));
      setSubmitting(false);
    }
  };
  return (
    <form
      class="message-rewrite"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Textarea
        aria-label={t("chat.rewrite.draft")}
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting()) props.onCancel();
        }}
        disabled={submitting()}
        autofocus
      />
      {error() && <p role="alert">{error()}</p>}
      <div class="message-rewrite-actions">
        <Button type="button" variant="ghost" disabled={submitting()} onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting() || !text().trim()}>
          {t("chat.rewrite.send")}
        </Button>
      </div>
    </form>
  );
}
