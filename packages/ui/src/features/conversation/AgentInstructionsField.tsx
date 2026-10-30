/**
 * The Instructions field of a local agent: the text of `AGENTS.md` at the root of its workspace, or
 * of `CLAUDE.md` in an older workspace. The agent reads the file in each session and can change it,
 * so the field reads it again after each turn when the user has no unsaved change in it. A save
 * sends the text that the edit started from: when the agent changed the file since then, main
 * refuses the save and the field shows the agent's text.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentInstructionsFile } from "@openbot/contracts/ipc";
import { ResizableTextarea } from "@openbot/ui/components/ResizableTextarea";
import { SettingsField } from "@openbot/ui/components/SettingsPanel";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { InstructionsLimit, instructionsTooLong } from "../agents/InstructionsLimit";

/** The calls of the computer that runs the agent. */
export interface AgentInstructionsCalls {
  read: (agentId: string) => Promise<AgentInstructionsFile>;
  /** `expected` is the file text that the edit started from. */
  save: (agentId: string, text: string, expected: string) => Promise<AgentInstructionsFile>;
}

const SAVE_DELAY_MS = 400;
const LIMIT = INPUT_LIMITS.agentInstructionsFile;

export function AgentInstructionsField(props: {
  agentId: string;
  /** The agent has a turn now. When it ends, the field reads the file again. */
  working: boolean;
  calls: AgentInstructionsCalls;
}): JSX.Element {
  const { t, errorMessage } = useText();
  const [text, setText] = createSignal("");
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  /** The agent whose file the field shows. A late answer for the agent shown before is dropped. */
  let shown: string | undefined;
  let dirty = false;
  /** The file text of each agent after the last read or save. A save on an agent switch still uses it. */
  const bases = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;
  // One save at a time, so that an older save cannot write over a newer text.
  let saving: Promise<void> = Promise.resolve();

  async function load(agentId: string): Promise<void> {
    const current = ++request;
    try {
      const file = await props.calls.read(agentId);
      if (current !== request || shown !== agentId || dirty) return;
      bases.set(agentId, file.text);
      setText(file.text);
      setLoaded(true);
      setError(null);
    } catch (failure) {
      if (current === request && shown === agentId)
        setError(errorMessage(failure, t("error.agent.instructionsReadFailed")));
    }
  }

  function clearTimer(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  // Text over the limit stays in the field, unsaved, until the user shortens it.
  function save(agentId: string, value: string): void {
    clearTimer();
    if (instructionsTooLong(value, LIMIT)) return;
    saving = saving.then(async () => {
      // A newer text has its own save. When the agent changed the file, the field shows its text now.
      if (shown === agentId && text() !== value) return;
      try {
        await props.calls.save(agentId, value, bases.get(agentId) ?? "");
        bases.set(agentId, value);
        if (shown !== agentId) return;
        if (text() === value) dirty = false;
        setError(null);
      } catch (failure) {
        if (shown !== agentId) return;
        setError(errorMessage(failure, t("error.agent.instructionsSaveFailed")));
        await showChangedFile(agentId);
      }
    });
  }

  /** After a failed save: when the agent changed the file, the field shows its text. */
  async function showChangedFile(agentId: string): Promise<void> {
    const current = ++request;
    try {
      const file = await props.calls.read(agentId);
      if (current !== request || shown !== agentId || file.text === bases.get(agentId)) return;
      clearTimer();
      bases.set(agentId, file.text);
      dirty = false;
      setText(file.text);
    } catch {
      // The save error already shows.
    }
  }

  function flush(): void {
    if (dirty && shown !== undefined) save(shown, text());
  }

  createEffect(
    () => props.agentId,
    (agentId) => {
      flush();
      shown = agentId;
      dirty = false;
      setLoaded(false);
      setText("");
      setError(null);
      void load(agentId);
    },
  );

  createEffect(
    () => props.working,
    (working, previous) => {
      if (working || previous !== true || dirty || shown === undefined) return;
      void load(shown);
    },
  );

  onSettled(() => () => flush());

  return (
    <SettingsField label={t("agentSettings.instructions")}>
      <ResizableTextarea
        class="settings-instructions-input"
        rows="5"
        value={text()}
        disabled={!loaded()}
        aria-label={t("agentSettings.instructionsLabel")}
        resizeLabel={t("agentSettings.instructionsResize")}
        placeholder={t("agentSettings.instructionsPlaceholder")}
        invalid={instructionsTooLong(text(), LIMIT)}
        onValueChange={(value) => {
          setText(value);
          dirty = true;
          const agentId = shown;
          clearTimer();
          if (agentId !== undefined) timer = setTimeout(() => save(agentId, value), SAVE_DELAY_MS);
        }}
        onBlur={flush}
      />
      <InstructionsLimit text={text()} limit={LIMIT} />
      <Show when={error()}>
        {(message) => (
          <span class="ui-field-error" role="alert">
            {message()}
          </span>
        )}
      </Show>
    </SettingsField>
  );
}
