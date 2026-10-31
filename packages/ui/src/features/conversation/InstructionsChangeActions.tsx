/**
 * View and Undo on the chat line that says the agent changed its instructions. View opens the file
 * in the editor. Undo puts back the text from before the turn, but only while the file still has the
 * agent's text: the save sends that text, so main refuses it after a later change.
 */

import type { AgentInstructionsChange } from "@openbot/contracts/ipc";
import { Button, FileText, MarkerIcon, Undo2 } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { AgentInstructionsDialog } from "./AgentInstructionsDialog";
import type { AgentInstructionsFileCalls } from "./AgentInstructionsField";

export function InstructionsChangeActions(props: {
  agentId: string;
  change: AgentInstructionsChange | null;
  calls: AgentInstructionsFileCalls;
}): JSX.Element {
  const { t, errorMessage } = useText();
  /** The file text now, or null before the first read. */
  const [current, setCurrent] = createSignal<string | null>(null);
  const [viewing, setViewing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let closed = false;
  /** A read that ends after a save, or after a later read, does not replace the newer text. */
  let request = 0;

  async function refresh(): Promise<void> {
    const mine = ++request;
    try {
      const file = await props.calls.read(props.agentId);
      if (!closed && mine === request) setCurrent(file.text);
    } catch {
      // Undo stays hidden. View still opens the editor, which shows its own read error.
    }
  }

  onSettled(() => {
    void refresh();
    const stop = props.calls.watch((agentId, file) => {
      if (agentId !== props.agentId) return;
      ++request;
      setCurrent(file.text);
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
      <Button variant="ghost" type="button" class="chat-action-target" onClick={() => setViewing(true)}>
        <MarkerIcon>
          <FileText aria-hidden="true" />
        </MarkerIcon>
        <span class="chat-action-target-name">{t("chat.marker.instructionsView")}</span>
      </Button>
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
      <AgentInstructionsDialog
        open={viewing()}
        onOpenChange={(open) => {
          setViewing(open);
          // The agent can change the file while the editor is open.
          if (!open) void refresh();
        }}
        agentId={props.agentId}
        calls={props.calls}
      />
    </>
  );
}
