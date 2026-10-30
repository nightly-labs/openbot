import type { AppMessages, AppTextKey } from "@openbot/i18n";
import { Button, Plus, Trash2 } from "@openbot/ui";
import { createMemo, createSignal, For, onSettled } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

/** One sample memory, in the order that the list adds them. */
interface SampleMemory {
  text: AppTextKey;
  origin: "automatic" | "manual";
}

const SAMPLE_MEMORIES: SampleMemory[] = [
  { text: "memory.sample.updates", origin: "automatic" },
  { text: "memory.sample.scripts", origin: "manual" },
  { text: "memory.sample.brief", origin: "automatic" },
  { text: "memory.sample.confirm", origin: "manual" },
];

/** The list adds one row on each step. One more step clears it, and the loop starts again. */
const STEP_MS = 3000;
const CYCLE = SAMPLE_MEMORIES.length + 1;
/** The handwriting speed and the pause before it starts, in milliseconds. */
const WRITE_START_MS = 500;
const MS_PER_CHAR = 30;
const LINE_GAP_MS = 140;
/** A long memory writes faster: its writing ends at this time, so its meta line shows before the next step. */
const WRITE_END_MS = 2600;
/** A line of handwriting breaks before this width. A wide character, such as a kanji, counts as two. */
const LINE_WIDTH = 46;
const DAY_MS = 86_400_000;

const LEARNS_TEXT = {
  agent: "memory.emptyLearnsAgent",
  channel: "memory.emptyLearnsChannel",
} as const satisfies Record<"agent" | "channel", keyof AppMessages>;

export interface AgentMemoriesEmptyProps {
  ownerNoun: "agent" | "channel";
  ownerLabel: string;
  addDisabled: boolean;
  onAdd: () => void;
}

/**
 * The memories dialog before its first memory. A faint copy of the real list fills in from the top:
 * the newest memory writes itself in handwriting, and when the next one comes, it becomes a typed
 * row. Nothing in the list can be opened, and a reader hears only the pitch.
 */
export function AgentMemoriesEmpty(props: AgentMemoriesEmptyProps) {
  const { t } = useText();
  const [step, setStep] = createSignal(0);
  const [still, setStill] = createSignal(false);
  onSettled(() => {
    // Less motion keeps one frame with the full list.
    if (prefersReducedMotion()) {
      setStill(true);
      setStep(SAMPLE_MEMORIES.length - 1);
      return;
    }
    const timer = window.setInterval(() => setStep((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  });

  const position = () => step() % CYCLE;
  const shown = createMemo(() => {
    const cycle = Math.floor(step() / CYCLE);
    return SAMPLE_MEMORIES.slice(0, Math.min(position() + 1, SAMPLE_MEMORIES.length))
      .map((memory, index) => ({ key: `${cycle}-${index}`, memory, index }))
      .reverse();
  });

  const title = () => {
    const marker = "\u0000";
    const [before = "", after = ""] = t("memory.emptyTitle", { remember: marker }).split(marker);
    return { before, after };
  };

  return (
    <div class="agent-memories-empty" data-still={still() ? "" : undefined}>
      <ul
        class="agent-memory-list agent-memories-empty-list"
        aria-hidden="true"
        data-clearing={position() === SAMPLE_MEMORIES.length ? "" : undefined}
      >
        <For each={shown()} keyed={(item) => item.key}>
          {(item, age) => (
            <li class="agent-memories-empty-item" data-age={Math.min(age(), 3)} data-dry={age() > 0 ? "" : undefined}>
              <SampleRow memory={item().memory} age={SAMPLE_MEMORIES.length - 1 - item().index} />
            </li>
          )}
        </For>
      </ul>
      <div class="agent-memories-empty-pitch">
        <h3 class="agent-memories-empty-title">
          <span class="agent-memories-empty-lead">{t("memory.emptyLead")}</span>
          <span>
            {title().before}
            <span class="agent-memories-hand agent-memories-empty-word">{t("memory.emptyRemember")}</span>
            {title().after}
          </span>
        </h3>
        <p class="agent-memories-empty-lines">
          <span>{t(LEARNS_TEXT[props.ownerNoun], { name: props.ownerLabel })}</span>
          <span>{t("memory.emptyAddOwn")}</span>
        </p>
        <Button class="agent-memories-empty-action" disabled={props.addDisabled} onClick={() => props.onAdd()}>
          <Plus />
          {t("memory.add")}
        </Button>
      </div>
    </div>
  );
}

/**
 * One row with the real row styles. The row button and the delete button are inert copies: spans
 * with the button classes. The handwriting folds away when the row is dry, and the typed text opens.
 */
function SampleRow(props: { memory: SampleMemory; age: number }) {
  const { t, format } = useText();
  const text = () => t(props.memory.text);
  const lines = createMemo(() => handLines(text()));
  const times = createMemo(() => {
    const gaps = lines().length * LINE_GAP_MS;
    const chars = lines().reduce((total, line) => total + line.length, 0);
    const perChar = Math.min(MS_PER_CHAR, (WRITE_END_MS - WRITE_START_MS - gaps) / chars);
    let written = 0;
    const delays = lines().map((line, index) => {
      const delay = WRITE_START_MS + written * perChar + index * LINE_GAP_MS;
      written += line.length;
      return delay;
    });
    return { delays, perChar, end: WRITE_START_MS + written * perChar + gaps };
  });
  // The newest sample is from today, and each one before it is a day older.
  const date = () => format.date(new Date(Date.now() - props.age * DAY_MS), { dateStyle: "medium" });
  return (
    <span class="agent-memory-row agent-memories-empty-row">
      <span class="ui-button ui-button-variant-ghost ui-button-size-default agent-memory-row-main">
        <span class="agent-memories-empty-fold agent-memories-empty-fold-hand">
          <span>
            <span class="agent-memories-hand agent-memories-empty-hand">
              <For each={lines()}>
                {(line, index) => (
                  <span
                    class="agent-memories-empty-line"
                    style={{
                      "--agent-memories-empty-delay": `${times().delays[index()] ?? 0}ms`,
                      "--agent-memories-empty-length": `${line.length * times().perChar}ms`,
                    }}
                  >
                    {line}
                  </span>
                )}
              </For>
            </span>
          </span>
        </span>
        <span class="agent-memories-empty-fold agent-memories-empty-fold-typed">
          <span class="agent-memory-text">{text()}</span>
        </span>
        <span
          class="agent-memory-meta agent-memories-empty-meta"
          style={{ "--agent-memories-empty-delay": `${times().end}ms` }}
        >
          {props.memory.origin === "automatic" ? t("memory.learned") : t("memory.manual")}
          {" · "}
          {date()}
        </span>
      </span>
      <span class="ui-button ui-button-variant-destructive-ghost ui-button-size-icon-sm ui-icon-button agent-memory-delete-button">
        <Trash2 />
      </span>
    </span>
  );
}

/** Breaks a memory into short lines at a word, so each line writes itself in turn. */
function handLines(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  const add = (part: string, gap: string) => {
    if (line && width(line) + width(gap) + width(part) > LINE_WIDTH) {
      lines.push(line);
      line = part;
    } else {
      line = line ? `${line}${gap}${part}` : part;
    }
  };
  for (const word of text.split(" ")) {
    if (width(word) <= LINE_WIDTH) {
      add(word, " ");
      continue;
    }
    // A language with no spaces, such as Japanese, breaks between characters.
    let first = true;
    for (const char of word) {
      add(char, first ? " " : "");
      first = false;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function width(text: string) {
  let total = 0;
  for (const char of text) total += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1;
  return total;
}
