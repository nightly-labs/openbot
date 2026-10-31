/**
 * Agent settings > Instructions: the text of `AGENTS.md` at the root of a local agent's workspace, or
 * of `CLAUDE.md` in an older workspace. A bar at the top names the file and its folder; under it the
 * page shows the file as formatted text. Edit puts the whole file in a field on the same page. The
 * agent reads the file in each session and can change it, so the page reads it again after each turn.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentInstructionsFile } from "@openbot/contracts/ipc";
import { Button, FileText, FolderOpen, IconButton, Textarea } from "@openbot/ui";
import { SettingsPanelContent, SettingsPanelHeader } from "@openbot/ui/components/SettingsPanel";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { InstructionsLimit, instructionsTooLong } from "../agents/InstructionsLimit";
import { breakablePath } from "./AgentSettingsPanel";
import { MarkdownMessageText } from "./MarkdownMessageText";

const LIMIT = INPUT_LIMITS.agentInstructionsFile;

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
  /** Shows the file in the file manager. Main finds the file from the agent id. */
  reveal: (agentId: string) => Promise<void>;
}

export function AgentInstructionsView(props: {
  agentId: string;
  /** The workspace folder. The file is at its root. */
  folder?: string | undefined;
  /** The agent has a turn now. When it ends, the page reads the file again. */
  working: boolean;
  calls: AgentInstructionsCalls;
  onBack: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t, errorMessage } = useText();
  const [file, setFile] = createSignal<AgentInstructionsFile | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal(false);
  /** The agent whose file the page shows. A late answer for the agent shown before is dropped. */
  let shown: string | undefined;
  let request = 0;

  function show(next: AgentInstructionsFile): void {
    setFile(next);
    setError(null);
  }

  async function load(agentId: string): Promise<void> {
    const current = ++request;
    try {
      const next = await props.calls.read(agentId);
      if (current === request && shown === agentId) show(next);
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
      setFile(null);
      setError(null);
      void load(agentId);
    },
  );

  createEffect(
    () => props.working,
    (working, previous) => {
      if (working || previous !== true || shown === undefined || editing()) return;
      void load(shown);
    },
  );

  onSettled(() =>
    props.calls.watch((agentId, next) => {
      if (agentId !== shown) return;
      ++request;
      show(next);
    }),
  );

  function reveal(): void {
    const agentId = props.agentId;
    props.calls.reveal(agentId).catch((failure: unknown) => {
      if (shown === agentId) setError(errorMessage(failure, t("error.agent.instructionsReadFailed")));
    });
  }

  return (
    <div class="agent-memories-view">
      <SettingsPanelHeader
        title={t("agentSettings.instructions")}
        onBack={() => (editing() ? setEditing(false) : props.onBack())}
        backLabel={t("agentSettings.backToSettings")}
        onClose={props.onClose}
        closeLabel={t("agentSettings.closeDetails")}
      />
      <SettingsPanelContent>
        <div class="agent-memories-page">
          <Show when={file()}>
            {(current) => (
              <Show
                when={editing()}
                fallback={
                  <>
                    <div class="agent-instructions-bar">
                      <FileText class="agent-instructions-bar-icon" aria-hidden="true" />
                      <div class="agent-instructions-bar-file">
                        <span class="agent-instructions-bar-name">{current().fileName}</span>
                        <Show when={props.folder}>
                          {(folder) => <span class="agent-instructions-bar-folder">{breakablePath(folder())}</span>}
                        </Show>
                      </div>
                      <IconButton label={t("files.action.reveal")} variant="ghost" size="icon-sm" onClick={reveal}>
                        <FolderOpen />
                      </IconButton>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t("agentSettings.instructionsEdit")}
                        onClick={() => setEditing(true)}
                      >
                        {t("common.edit")}
                      </Button>
                    </div>
                    <Show
                      when={current().text.trim()}
                      fallback={<p class="agent-instructions-empty">{t("agentSettings.instructionsPlaceholder")}</p>}
                    >
                      {(body) => (
                        <div class="agent-instructions-text message-markdown">
                          <MarkdownMessageText
                            imagesAsLinks
                            linkFavicons={false}
                            body={body()}
                            agents={[]}
                            onSelectAgent={() => undefined}
                            onOpenLink={props.calls.openLink}
                          />
                        </div>
                      )}
                    </Show>
                  </>
                }
              >
                <InstructionsEditor
                  agentId={props.agentId}
                  initial={current().text}
                  calls={props.calls}
                  onSaved={(saved) => {
                    ++request;
                    show(saved);
                    setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              </Show>
            )}
          </Show>
          <Show when={error()}>
            {(message) => (
              <p class="ui-field-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </SettingsPanelContent>
    </div>
  );
}

/**
 * The whole file in a field, with Cancel and Save. Cmd+Enter saves; Escape cancels. A save sends the
 * text that the edit started from: when the agent changed the file since then, main refuses the
 * save, and the editor keeps the user's text and says so. A second Save then replaces the agent's
 * version.
 */
function InstructionsEditor(props: {
  agentId: string;
  initial: string;
  calls: AgentInstructionsFileCalls;
  onSaved: (file: AgentInstructionsFile) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t, errorMessage } = useText();
  const [text, setText] = createSignal(untrack(() => props.initial));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** The file text that the edit started from. */
  let base = untrack(() => props.initial);
  let closed = false;

  onSettled(() => () => {
    closed = true;
  });

  async function save(): Promise<void> {
    const value = text();
    if (busy() || instructionsTooLong(value, LIMIT)) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await props.calls.save(props.agentId, value, base);
      if (!closed) props.onSaved(saved);
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
    <div class="agent-memories-editor">
      <Textarea
        ref={(element) => {
          queueMicrotask(() => element.focus());
        }}
        class="agent-memories-field agent-instructions-field"
        value={text()}
        aria-label={t("agentSettings.instructionsLabel")}
        placeholder={t("agentSettings.instructionsPlaceholder")}
        invalid={instructionsTooLong(text(), LIMIT)}
        onValueChange={setText}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
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
      <div class="agent-memories-editor-actions">
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={instructionsTooLong(text(), LIMIT)} loading={busy()} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
