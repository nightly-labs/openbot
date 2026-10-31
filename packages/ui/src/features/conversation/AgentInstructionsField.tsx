/**
 * The Instructions of a local agent: the text of `AGENTS.md` at the root of its workspace, or of
 * `CLAUDE.md` in an older workspace. The panel shows the start of the file as formatted text, and
 * Edit opens the whole file in a dialog. The agent reads the file in each session and can change it,
 * so the preview reads it again after each turn.
 */

import type { AgentInstructionsFile } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { AgentInstructionsDialog } from "./AgentInstructionsDialog";
import { MarkdownMessageText } from "./MarkdownMessageText";

/** The calls of the computer that runs the agent. */
export interface AgentInstructionsFileCalls {
  read: (agentId: string) => Promise<AgentInstructionsFile>;
  /** `expected` is the file text that the edit started from. */
  save: (agentId: string, text: string, expected: string) => Promise<AgentInstructionsFile>;
  /** Calls `watcher` after each save. Returns the call that stops it. */
  watch: (watcher: (agentId: string, file: AgentInstructionsFile) => void) => () => void;
}

export interface AgentInstructionsCalls extends AgentInstructionsFileCalls {
  /** Opens a link of the formatted text. */
  openLink: (url: string) => void;
}

export function AgentInstructionsField(props: {
  agentId: string;
  /** The agent has a turn now. When it ends, the preview reads the file again. */
  working: boolean;
  calls: AgentInstructionsCalls;
}): JSX.Element {
  const { t, errorMessage } = useText();
  const [text, setText] = createSignal("");
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [clamped, setClamped] = createSignal(false);
  /** The agent whose file the preview shows. A late answer for the agent shown before is dropped. */
  let shown: string | undefined;
  let request = 0;
  let preview: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;

  async function load(agentId: string): Promise<void> {
    const current = ++request;
    try {
      const file = await props.calls.read(agentId);
      if (current !== request || shown !== agentId) return;
      setText(file.text);
      setLoaded(true);
      setError(null);
    } catch (failure) {
      if (current === request && shown === agentId)
        setError(errorMessage(failure, t("error.agent.instructionsReadFailed")));
    }
  }

  createEffect(
    () => props.agentId,
    (agentId) => {
      shown = agentId;
      setEditing(false);
      setLoaded(false);
      setText("");
      setError(null);
      void load(agentId);
    },
  );

  createEffect(
    () => props.working,
    (working, previous) => {
      if (working || previous !== true || shown === undefined) return;
      void load(shown);
    },
  );

  onSettled(() =>
    props.calls.watch((agentId, file) => {
      if (agentId !== shown) return;
      ++request;
      setText(file.text);
      setLoaded(true);
      setError(null);
    }),
  );

  // A long file shows only its start, with a fade at the bottom edge.
  onSettled(() => {
    if (!preview || !content) return;
    const box = preview;
    const inner = content;
    const observer = new ResizeObserver(() => setClamped(inner.offsetHeight > box.clientHeight));
    observer.observe(inner);
    observer.observe(box);
    return () => observer.disconnect();
  });

  return (
    <div class="settings-field agent-instructions-field">
      <div class="agent-instructions-header">
        <span>{t("agentSettings.instructions")}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("agentSettings.instructionsEdit")}
          disabled={!loaded()}
          onClick={() => setEditing(true)}
        >
          {t("common.edit")}
        </Button>
      </div>
      <div
        ref={(element) => {
          preview = element;
        }}
        class="agent-instructions-preview message-markdown"
        data-clamped={clamped() ? "true" : undefined}
      >
        <div
          ref={(element) => {
            content = element;
          }}
        >
          <Show
            when={text().trim()}
            fallback={<span class="agent-instructions-empty">{t("agentSettings.instructionsPlaceholder")}</span>}
          >
            {(body) => (
              <MarkdownMessageText
                imagesAsLinks
                linkFavicons={false}
                body={body()}
                agents={[]}
                onSelectAgent={() => undefined}
                onOpenLink={props.calls.openLink}
              />
            )}
          </Show>
        </div>
      </div>
      <Show when={error()}>
        {(message) => (
          <span class="ui-field-error" role="alert">
            {message()}
          </span>
        )}
      </Show>
      <AgentInstructionsDialog open={editing()} onOpenChange={setEditing} agentId={props.agentId} calls={props.calls} />
    </div>
  );
}
