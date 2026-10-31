/**
 * The editor of a local agent's instruction file, in a dialog. It reads the file when it opens and
 * saves only on Save. A save sends the text that the edit started from: when the agent changed the
 * file since then, main refuses the save, and the dialog keeps the user's text and says so. A second
 * Save then replaces the agent's version.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Button, Dialog, IconButton, Textarea, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { InstructionsLimit, instructionsTooLong } from "../agents/InstructionsLimit";
import type { AgentInstructionsFileCalls } from "./AgentInstructionsField";

const LIMIT = INPUT_LIMITS.agentInstructionsFile;

export function AgentInstructionsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  calls: AgentInstructionsFileCalls;
}): JSX.Element {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content as="section" class="ui-dialog-content profile-dialog agent-instructions-dialog">
            <InstructionsForm
              agentId={props.agentId}
              calls={props.calls}
              onSaved={() => props.onOpenChange(false)}
              onClose={() => props.onOpenChange(false)}
            />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InstructionsForm(props: {
  agentId: string;
  calls: AgentInstructionsFileCalls;
  onSaved: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t, errorMessage } = useText();
  const [text, setText] = createSignal("");
  const [loaded, setLoaded] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** The file text that the edit started from. */
  let base = "";
  let closed = false;

  onSettled(() => {
    const agentId = props.agentId;
    props.calls.read(agentId).then(
      (file) => {
        if (closed) return;
        base = file.text;
        setText(file.text);
        setLoaded(true);
      },
      (failure: unknown) => {
        if (!closed) setError(errorMessage(failure, t("error.agent.instructionsReadFailed")));
      },
    );
    return () => {
      closed = true;
    };
  });

  async function save(): Promise<void> {
    const value = text();
    if (!loaded() || busy() || instructionsTooLong(value, LIMIT)) return;
    setBusy(true);
    setError(null);
    try {
      await props.calls.save(props.agentId, value, base);
      if (!closed) props.onSaved();
    } catch (failure) {
      if (closed) return;
      const saveError = errorMessage(failure, t("error.agent.instructionsSaveFailed"));
      // The agent can change the file while the user edits it. The user's text stays, and the next
      // Save replaces the agent's version.
      const current = await props.calls.read(props.agentId).then(
        (file) => file.text,
        () => null,
      );
      if (closed) return;
      if (current !== null && current !== base) {
        base = current;
        setError(t("agentSettings.instructionsChangedWhileEditing"));
      } else setError(saveError);
    } finally {
      if (!closed) setBusy(false);
    }
  }

  return (
    <form
      class="agent-instructions-form"
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header class="profile-dialog-header">
        <Dialog.Title as="h2" class="profile-dialog-title">
          {t("agentSettings.instructions")}
        </Dialog.Title>
        <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
          <X />
        </IconButton>
      </header>
      <Textarea
        class="agent-instructions-editor"
        value={text()}
        disabled={!loaded()}
        aria-label={t("agentSettings.instructionsLabel")}
        placeholder={t("agentSettings.instructionsPlaceholder")}
        invalid={instructionsTooLong(text(), LIMIT)}
        onValueChange={setText}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
          event.preventDefault();
          void save();
        }}
      />
      <InstructionsLimit text={text()} limit={LIMIT} />
      <Show when={error()}>
        {(message) => (
          <span class="ui-field-error" role="alert">
            {message()}
          </span>
        )}
      </Show>
      <footer class="profile-dialog-footer">
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!loaded() || busy() || instructionsTooLong(text(), LIMIT)}>
          {busy() ? t("common.saving") : t("common.save")}
        </Button>
      </footer>
    </form>
  );
}
