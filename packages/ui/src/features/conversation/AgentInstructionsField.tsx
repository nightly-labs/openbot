/**
 * The Instructions field of a local agent: the text of `AGENTS.md` at the root of its workspace, or
 * of `CLAUDE.md` in an older workspace. The agent reads the file in each session and can change it,
 * so the field reads it again after each turn when the user has no unsaved change in it.
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
  save: (agentId: string, text: string) => Promise<AgentInstructionsFile>;
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
  let focused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;
  // One save at a time, so that an older save cannot write over a newer text.
  let saving: Promise<void> = Promise.resolve();

  async function load(agentId: string): Promise<void> {
    const current = ++request;
    try {
      const file = await props.calls.read(agentId);
      if (current !== request || shown !== agentId || dirty) return;
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
      try {
        await props.calls.save(agentId, value);
        if (shown !== agentId) return;
        if (text() === value) dirty = false;
        setError(null);
      } catch (failure) {
        if (shown === agentId) setError(errorMessage(failure, t("error.agent.instructionsSaveFailed")));
      }
    });
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
      if (working || previous !== true || dirty || focused || shown === undefined) return;
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
        onFocus={() => {
          focused = true;
        }}
        onValueChange={(value) => {
          setText(value);
          dirty = true;
          const agentId = shown;
          clearTimer();
          if (agentId !== undefined) timer = setTimeout(() => save(agentId, value), SAVE_DELAY_MS);
        }}
        onBlur={() => {
          focused = false;
          flush();
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
    </SettingsField>
  );
}
