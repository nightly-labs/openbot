/**
 * View, Changes and Undo on the chat line that says the agent changed its instructions. View opens the
 * Instructions page in the agent settings. Changes shows the text from before and after the turn as a
 * diff. Undo puts back the text from before the turn, but only while the file still has the
 * agent's text: the save sends that text, so main refuses it after a later change.
 */

import type { AgentInstructionsChange } from "@openbot/contracts/ipc";
import { Button, Dialog, FileDiff, FileText, IconButton, MarkerIcon, Undo2, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import type { AgentInstructionsFileCalls } from "./AgentInstructionsView";
import { DiffView } from "./DiffView";

export function InstructionsChangeActions(props: {
  agentId: string;
  change: AgentInstructionsChange | null;
  calls: AgentInstructionsFileCalls;
  /** Absent where the chat has no settings page for the agent. View then does not show. */
  onView?: ((agentId: string) => void) | undefined;
}): JSX.Element {
  const { t, errorMessage } = useText();
  /** The file text now, or null before the first read. */
  const [current, setCurrent] = createSignal<string | null>(null);
  /** The name of the instruction file, or null before the first read. The diff shows it. */
  const [fileName, setFileName] = createSignal<string | null>(null);
  const [showChanges, setShowChanges] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let closed = false;
  /** A read that ends after a save, or after a later read, does not replace the newer text. */
  let request = 0;

  async function refresh(): Promise<void> {
    const mine = ++request;
    try {
      const file = await props.calls.read(props.agentId);
      if (!closed && mine === request) {
        setCurrent(file.text);
        setFileName(file.fileName);
      }
    } catch {
      // Undo stays hidden. View still opens the page, which shows its own read error.
    }
  }

  onSettled(() => {
    void refresh();
    const stop = props.calls.watch((agentId, file) => {
      if (agentId !== props.agentId) return;
      ++request;
      setCurrent(file.text);
      setFileName(file.fileName);
    });
    return () => {
      closed = true;
      stop();
    };
  });

  async function undo(change: AgentInstructionsChange): Promise<void> {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await props.calls.save(props.agentId, change.before, change.after);
    } catch (failure) {
      if (closed) return;
      setError(errorMessage(failure, t("error.agent.instructionsSaveFailed")));
      await refresh();
    } finally {
      if (!closed) setBusy(false);
    }
  }

  const undoable = () => {
    const change = props.change;
    return change && current() === change.after ? change : undefined;
  };
  const undone = () => props.change !== null && current() === props.change.before;

  return (
    <>
      <Show when={props.onView}>
        {(view) => (
          <Button variant="ghost" type="button" class="chat-action-target" onClick={() => view()(props.agentId)}>
            <MarkerIcon>
              <FileText aria-hidden="true" />
            </MarkerIcon>
            <span class="chat-action-target-name">{t("chat.marker.instructionsView")}</span>
          </Button>
        )}
      </Show>
      <Show when={props.change}>
        {(change) => (
          <>
            <Button
              variant="ghost"
              type="button"
              class="chat-action-target"
              aria-haspopup="dialog"
              onClick={() => setShowChanges(true)}
            >
              <MarkerIcon>
                <FileDiff aria-hidden="true" />
              </MarkerIcon>
              <span class="chat-action-target-name">{t("preview.diff.instructionsButton")}</span>
            </Button>
            <Show when={showChanges()}>
              <Dialog.Root open onOpenChange={(open) => !open && setShowChanges(false)}>
                <Dialog.Portal>
                  {/* The overlay centers the dialog that it holds. */}
                  <Dialog.Overlay>
                    <Dialog.Content class="instructions-diff-dialog" as="section">
                      <header class="instructions-diff-dialog-head">
                        <Dialog.Title as="h2" class="ui-heading" data-size="md" data-tone="primary">
                          {t("preview.diff.instructionsTitle")}
                        </Dialog.Title>
                        <IconButton
                          label={t("common.close")}
                          variant="ghost"
                          data-cuelume-tap="close"
                          onClick={() => setShowChanges(false)}
                        >
                          <X />
                        </IconButton>
                      </header>
                      <DiffView
                        name={fileName() ?? t("preview.diff.instructionsTitle")}
                        oldText={change().before}
                        newText={change().after}
                      />
                    </Dialog.Content>
                  </Dialog.Overlay>
                </Dialog.Portal>
              </Dialog.Root>
            </Show>
          </>
        )}
      </Show>
      <Show when={undoable()}>
        {(change) => (
          <Button
            variant="ghost"
            type="button"
            class="chat-action-target"
            disabled={busy()}
            onClick={() => void undo(change())}
          >
            <MarkerIcon>
              <Undo2 aria-hidden="true" />
            </MarkerIcon>
            <span class="chat-action-target-name">{t("chat.marker.instructionsUndo")}</span>
          </Button>
        )}
      </Show>
      <Show when={undone()}>
        <span class="chat-action-target chat-action-target-unavailable">{t("chat.marker.instructionsUndone")}</span>
      </Show>
      <Show when={error()}>
        {(message) => (
          <span class="ui-field-error" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </>
  );
}
