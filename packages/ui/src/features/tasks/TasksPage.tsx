import type { AgentTask, DraftAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  plainTaskTitle,
  TASKS_CLOSED_SHOWN,
  type TasksSectionId,
  taskSections,
  taskTone,
} from "@openbot/team-client/agent-tasks";
import {
  ActiveCurrentRow,
  ArrowLeft,
  ArrowUp,
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  Combobox,
  IconButton,
  LoaderCircle,
  Mic,
  PanelLeft,
  Popover,
  Search,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import { SwapLabel, type SwapMotion } from "@openbot/ui/components/SwapLabel";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { AgentTaskMark, type AgentTaskWait, agentTaskStatus } from "@openbot/ui/features/conversation/AgentTasks";
import {
  ComposerAttachmentRow,
  type ComposerPendingImage,
} from "@openbot/ui/features/conversation/ComposerAttachmentRow";
import {
  ComposerEditor,
  type ComposerPasteResult,
  type ComposerSelection,
} from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import {
  type VoicePhase,
  VoiceRecordingMorph,
  voiceButtonLabel,
} from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  createUniqueId,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { TasksEmptyBoard, TasksEmptyPitch } from "./TasksEmpty";

/** The microphone of the Tasks composer. The page shows it; the app records and transcribes. */
export interface TasksVoice {
  phase: VoicePhase;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The words the recording heard so far. */
  liveText: string;
  /** The download progress of the voice model, in percent, while the phase is "preparing". */
  modelProgress: number | null;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  /** True while another message box on the page records. */
  blocked?: boolean | undefined;
}

/** The task of the last start, in the line under the composer. */
interface TasksTook {
  task: AgentTask;
  /** True while the start waits: Undo cancels it, and the agent can change. */
  pending: boolean;
}

interface TasksPageProps {
  hostName: string;
  onBack?: (() => void) | undefined;
  /** Whether the agent list shows beside the page. */
  agentsOpen?: boolean | undefined;
  /** Shows or hides the agent list. Without it, the header has no button for the list. */
  onToggleAgents?: (() => void) | undefined;
  agents: AgentProfile[];
  /** The tasks of all agents, also a start that waits. */
  tasks: readonly AgentTask[];
  /** Whether the task lists of all agents loaded. Only then does a page with no task show how tasks work. */
  loaded?: boolean | undefined;
  /** The agent of the next task. */
  agentId: string;
  onAgentChange: (agentId: string) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  /** The files of the next task. The text names each one where it was added. */
  files?: readonly DraftAttachment[] | undefined;
  /** The files in the thumbnail row: each image, and each other file that the text no longer names. */
  rowFiles?: readonly DraftAttachment[] | undefined;
  /** The pasted images that still import, with their local previews. */
  pendingImages?: readonly ComposerPendingImage[] | undefined;
  onRemoveFile?: ((attachment: DraftAttachment) => void) | undefined;
  /** Receives pasted files and long text pastes, as `ComposerEditor` says. Without it, a file paste does nothing here. */
  onPasteFiles?:
    | ((files: File[], selection: ComposerSelection, text?: string) => Promise<ComposerPasteResult | undefined>)
    | undefined;
  /** Each change moves the focus to the composer. */
  focusRequest: number;
  /** The text of a start that failed. The draft is back in the composer. */
  startError: string | null;
  onDismissStartError: () => void;
  onStart: () => void;
  voice?: TasksVoice | undefined;
  took: TasksTook | null;
  onTookAgentChange: (agentId: string) => void;
  onUndo: () => void;
  onOpenTook: () => void;
  onDismissTook: () => void;
  /** The task in the side panel. */
  selectedId: string | null;
  onSelect: (taskId: string | null) => void;
  /** The conversation of one task, for the side panel. */
  panel: (taskId: string) => JSX.Element;
  /** The width of the side panel that the user chose, in pixels. A narrow page shows it narrower. */
  sideWidth: number;
  /** Each move of the side panel edge. */
  onSideResize: (width: number) => void;
  /** The width at the end of a move, to keep for the next visit. */
  onSideResizeEnd: (width: number) => void;
  /** What the task's running turn waits for from the person: an approval, or an answer in the chat. */
  waitOf?: ((task: AgentTask) => AgentTaskWait) | undefined;
  /** The user's send shortcut for the composer. */
  sendShortcut?: SendShortcut | undefined;
  /** The window draws the macOS window controls over the image viewer's top start corner. */
  macWindowControls?: boolean | undefined;
}

const agentOf = (agents: readonly AgentProfile[], agentId: string) => agents.find((agent) => agent.id === agentId);

/** The trigger motion of the header model switcher: mostly a blur, so the old and new name cross in place. */
const AGENT_SWAP: SwapMotion = {
  distance: 6,
  blur: 6,
  enter: { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  leave: { duration: 180, easing: "ease" },
};

/** Lower case, no accents, and `_`, `/` and `-` as spaces: "cafe" finds "Café Orders". */
const foldChar = (char: string) =>
  char
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_/-]/g, " ");

/**
 * The folded text, and for each of its code units the index of the character in `text` that made
 * it. Folding can change the length, so this map finds the matched part in the original name.
 * A run of spaces and separators becomes one space: "Sales - EU" is "sales eu".
 */
function foldName(text: string) {
  let folded = "";
  const source: number[] = [];
  let index = 0;
  for (const char of text) {
    const raw = foldChar(char);
    const part = raw === " " && folded.endsWith(" ") ? "" : raw;
    folded += part;
    for (let unit = 0; unit < part.length; unit++) source.push(index);
    index += char.length;
  }
  return { folded, source };
}

/** Where `query` is in `name`, and its rank: 0 at the start, 1 at the start of a word, 2 in a word. */
function findMatch(name: string, query: string): { at: number; rank: number } | undefined {
  if (name.startsWith(query)) return { at: 0, rank: 0 };
  const first = name.indexOf(query);
  for (let at = first; at > 0; at = name.indexOf(query, at + 1)) {
    if (name[at - 1] === " ") return { at, rank: 1 };
  }
  return first < 0 ? undefined : { at: first, rank: 2 };
}

/** Names that start with the query, or have a word that does, come before names that only contain it. */
function matchAgents(agents: readonly AgentProfile[], query: string): AgentProfile[] {
  const text = foldName(query.trim()).folded;
  if (!text) return [...agents];
  return agents
    .flatMap((agent) => {
      const match = findMatch(foldName(agent.name).folded, text);
      return match ? [{ agent, rank: match.rank }] : [];
    })
    .sort((a, b) => a.rank - b.rank)
    .map((row) => row.agent);
}

/** The agent name with the matched part in bold, so the eye finds why a row is in the list. */
function MatchedAgentName(props: { name: string; query: string }) {
  const parts = createMemo(() => {
    const text = foldName(props.query.trim()).folded;
    const name = foldName(props.name);
    const match = text ? findMatch(name.folded, text) : undefined;
    if (!match) return { before: props.name, match: "", after: "" };
    const start = name.source[match.at] ?? 0;
    const end = name.source[match.at + text.length] ?? props.name.length;
    return {
      before: props.name.slice(0, start),
      match: props.name.slice(start, end),
      after: props.name.slice(end),
    };
  });
  return (
    <span class="tasks-page-agent-name">
      {parts().before}
      <Show when={parts().match}>
        <b>{parts().match}</b>
      </Show>
      {parts().after}
    </span>
  );
}

/**
 * Kobalte finds a row with an unescaped `[data-key="…"]` selector, to scroll it into view and to
 * name the active row. A key with `"`, `\` or U+0000 matches no row, so the key is encoded.
 */
const agentKey = (id: string) => encodeURIComponent(id);

/**
 * True when the window has space under the trigger for the search field and three rows. The menu
 * opens down, and opens up only when it would show no row there.
 */
function roomBelow(trigger: HTMLElement | undefined): boolean {
  if (!trigger) return true;
  const row = Number.parseFloat(getComputedStyle(trigger).getPropertyValue("--openbot-control-md")) || 32;
  return window.innerHeight - trigger.getBoundingClientRect().bottom >= 5 * row;
}

/**
 * The agent of a task, as a menu with the agent's face and a search field. A server can have many
 * agents: typing filters the rows, the arrows move through them, and Enter takes the active row or
 * the first match. A task has one agent, so the menu marks only the chosen agent.
 */
function TaskAgentSelect(props: {
  agents: AgentProfile[];
  agentId: string;
  /** The task title, when the select changes the agent of a task that is already sent. */
  title?: string;
  onChange: (agentId: string) => void;
}) {
  const { t } = useText();
  const agent = () => agentOf(props.agents, props.agentId);
  let shownId = untrack(() => props.agentId);
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const matches = createMemo(() => matchAgents(props.agents, query()));
  const fades = createScrollFades();
  // Kobalte scrolls the current row into view before the list has its final height. So when the
  // list resizes, the active row comes back into view.
  let resize: ResizeObserver | undefined;
  const keepActiveRow = () => {
    const id = input?.getAttribute("aria-activedescendant");
    if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  };
  onCleanup(() => {
    fades.stop();
    resize?.disconnect();
  });
  const [placement, setPlacement] = createSignal<"bottom-start" | "top-start">("bottom-start");
  let trigger: HTMLElement | undefined;
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;
  let list: HTMLElement | undefined;
  const choose = (option: AgentProfile) => {
    setOpen(false);
    if (option.id !== props.agentId) props.onChange(option.id);
  };
  const toggle = (next: boolean) => {
    if (next) {
      setQuery("");
      setPlacement(roomBelow(trigger) ? "bottom-start" : "top-start");
    }
    setOpen(next);
  };
  return (
    <Popover.Root
      open={open()}
      onOpenChange={toggle}
      placement={placement()}
      gutter={4}
      // The list shrinks to the space next to the trigger, so it does not flip when a search adds rows.
      flip={false}
      modal
    >
      <Popover.Trigger
        ref={(element: HTMLElement) => {
          trigger = element;
        }}
        class={`${buttonVariants({ variant: "ghost", size: "sm" })} tasks-page-agent`}
        aria-label={
          props.title === undefined
            ? t("conversation.tasks.page.agent", { name: agent()?.name ?? props.agentId })
            : t("conversation.tasks.page.reassign", { title: props.title, name: agent()?.name ?? props.agentId })
        }
        onKeyDown={(event: KeyboardEvent) => {
          // The arrow keys open the menu, as on a select.
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          toggle(true);
        }}
      >
        {/* Keyed by agent, so the face of a newly chosen agent springs in, as the model mark does. */}
        <For each={[props.agentId]} keyed={(id) => id}>
          {(id) => {
            const entering = untrack(id) !== shownId;
            shownId = untrack(id);
            return (
              <span class="tasks-page-agent-face" data-entering={entering ? "" : undefined}>
                <AgentAvatar agent={agentOf(props.agents, id())} class="tasks-page-avatar" />
              </span>
            );
          }}
        </For>
        <SwapLabel text={agent()?.name ?? props.agentId} motion={AGENT_SWAP} />
        <ChevronDown class="tasks-page-agent-chevron" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLElement) => {
            panel = element;
          }}
          class="ui-action-menu tasks-page-agent-menu"
          aria-label={t("conversation.tasks.page.agents")}
        >
          <ContentExitMotion panel={() => panel} />
          <Combobox.Root<AgentProfile>
            class="tasks-page-agent-picker"
            options={matches()}
            optionValue={(option) => agentKey(option.id)}
            optionTextValue="name"
            optionLabel="name"
            open={true}
            modal={false}
            triggerMode="manual"
            allowsEmptyCollection={true}
            shouldFocusWrap={true}
            defaultFilter={() => true}
            onInputChange={(value) => {
              setQuery(value);
              // A new search starts at the best match.
              if (list) list.scrollTop = 0;
            }}
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
            onChange={(option) => {
              if (option) choose(option);
            }}
            itemComponent={(item) => (
              <Combobox.Item
                item={item.item}
                class="tasks-page-agent-option"
                // The combobox has no selection, so the row says that it is the current agent.
                aria-selected={item.item.rawValue.id === props.agentId ? "true" : "false"}
              >
                <AgentAvatar agent={item.item.rawValue} class="tasks-page-avatar" />
                <MatchedAgentName name={item.item.rawValue.name} query={query()} />
                <Show when={item.item.rawValue.id === props.agentId}>
                  <Check aria-hidden="true" class="tasks-page-agent-check" />
                </Show>
              </Combobox.Item>
            )}
          >
            <Combobox.Control class="tasks-page-agent-search">
              <Search aria-hidden="true" />
              <Combobox.Input
                ref={(element: HTMLInputElement) => {
                  input = element;
                }}
                class="tasks-page-agent-search-input"
                aria-label={t("conversation.tasks.page.searchAgents")}
                placeholder={t("conversation.tasks.page.searchAgents")}
                autocomplete="off"
                spellcheck={false}
                onKeyDown={(event: KeyboardEvent) => {
                  // After typing, no row is active: then Enter takes the first match.
                  if (event.key !== "Enter" || event.isComposing || !query().trim()) return;
                  if (input?.getAttribute("aria-activedescendant")) return;
                  const [first] = matches();
                  if (!first) return;
                  event.preventDefault();
                  choose(first);
                }}
              />
            </Combobox.Control>
            <ActiveCurrentRow key={agentKey(props.agentId)} />
            <Combobox.Listbox
              ref={(element: HTMLElement) => {
                list = element;
                fades.bind(element);
                resize?.disconnect();
                resize = new ResizeObserver(keepActiveRow);
                resize.observe(element);
              }}
              class={["tasks-page-agent-list", fades.classes()]}
              style={{ "--tasks-agent-rows": String(matches().length) }}
              onScroll={fades.measure}
              aria-label={t("conversation.tasks.page.agents")}
            />
            <Show when={matches().length === 0}>
              <p class="tasks-page-agent-empty" role="status">
                {t("conversation.tasks.page.noAgent", { query: query().trim() })}
              </p>
            </Show>
          </Combobox.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The composer of the Tasks page: the conversation composer, and the agent selector in its toolbar.
 * Enter starts the task and Shift+Enter adds a line. The microphone dictates the task, as in a chat.
 */
function TasksComposer(props: TasksPageProps) {
  const { t } = useText();
  const phase = (): VoicePhase => props.voice?.phase ?? "idle";
  const busy = () => phase() === "requesting" || phase() === "preparing" || phase() === "transcribing";
  const hasRow = () => (props.rowFiles?.length ?? 0) > 0 || (props.pendingImages?.length ?? 0) > 0;
  // A start of files only names them, so it has a title too.
  const canStart = () =>
    phase() === "recording" ||
    (phase() === "idle" && (plainTaskTitle(props.draft) !== "" || (props.files?.length ?? 0) > 0));
  const start = () => {
    if (canStart()) props.onStart();
  };
  const send = () => (
    <Button
      type="submit"
      variant="ghost"
      class="voice-button"
      aria-label={phase() === "recording" ? t("composer.send.voice") : t("conversation.tasks.page.start")}
      disabled={!canStart()}
    >
      <ArrowUp aria-hidden="true" />
    </Button>
  );
  return (
    <div class="composer-wrap tasks-page-composer">
      <Show when={props.startError}>
        {(body) => (
          <ComposerNotice
            tone="danger"
            title={t("conversation.tasks.error.start")}
            body={body()}
            onDismiss={props.onDismissStartError}
          />
        )}
      </Show>
      <form
        class="composer"
        data-has-attachments={hasRow() ? "" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <ComposerAttachmentRow
          attachments={props.rowFiles ?? []}
          pending={props.pendingImages}
          removeDisabled={phase() === "transcribing"}
          onRemove={(attachment) => props.onRemoveFile?.(attachment)}
          macWindowControls={props.macWindowControls}
        />
        <div class="composer-input-label">
          <ComposerEditor
            agentId={undefined}
            agents={props.agents}
            value={props.draft}
            placeholder={t("conversation.tasks.page.ask")}
            ariaLabel={t("conversation.tasks.page.ask")}
            disabled={phase() === "transcribing"}
            focusRequest={props.focusRequest}
            dictation={{ text: props.voice?.liveText ?? "", final: phase() === "transcribing" }}
            sendShortcut={props.sendShortcut}
            onSubmit={start}
            onValueChange={props.onDraftChange}
            attachments={props.files ? [...props.files] : undefined}
            onPasteFiles={props.onPasteFiles}
          />
        </div>
        <div class="composer-toolbar">
          <div class="tasks-page-composer-agent">
            <TaskAgentSelect agents={props.agents} agentId={props.agentId} onChange={props.onAgentChange} />
          </div>
          <div class="composer-primary-actions">
            <Show when={props.voice} fallback={send()}>
              {(voice) => (
                <>
                  <Show when={phase() === "preparing"}>
                    <span class="voice-model-progress" role="status">
                      {t("composer.voice.progress", { progress: voice().modelProgress ?? 0 })}
                    </span>
                  </Show>
                  <VoiceRecordingMorph
                    recording={phase() === "recording"}
                    levels={[...voice().levels]}
                    elapsedSeconds={voice().elapsedSeconds}
                    onCancel={() => voice().onCancel()}
                    onFinish={() => voice().onFinish()}
                    send={send()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      class="dictation-button"
                      aria-label={t(voiceButtonLabel(phase()))}
                      disabled={busy() || voice().blocked === true}
                      onClick={() => voice().onStart()}
                    >
                      <Show when={busy()} fallback={<Mic aria-hidden="true" />}>
                        <LoaderCircle class="composer-spinner" aria-hidden="true" />
                      </Show>
                    </Button>
                  </VoiceRecordingMorph>
                </>
              )}
            </Show>
          </div>
        </div>
      </form>
    </div>
  );
}

/** The line under the composer after a start: the agent that took the task, Undo, and Open. */
function TaskTookLine(props: TasksPageProps & { took: TasksTook }) {
  const { t } = useText();
  const agent = () => agentOf(props.agents, props.took.task.agentId);
  return (
    <div class="tasks-page-took">
      <Show
        when={props.took.pending}
        fallback={
          <span class="tasks-page-took-agent">
            <AgentAvatar agent={agent()} class="tasks-page-avatar" />
            <span>{agent()?.name ?? props.took.task.agentId}</span>
          </span>
        }
      >
        <TaskAgentSelect
          agents={props.agents}
          agentId={props.took.task.agentId}
          title={props.took.task.title}
          onChange={props.onTookAgentChange}
        />
      </Show>
      <span class="tasks-page-took-text">{t("conversation.tasks.page.took", { title: props.took.task.title })}</span>
      <Show when={props.took.pending}>
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onUndo()}>
          {t("conversation.tasks.page.undo")}
        </Button>
      </Show>
      <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenTook()}>
        {t("common.open")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("conversation.tasks.page.dismiss")}
        onClick={() => props.onDismissTook()}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

/** One task in the list: its mark, title and state, and the face of its agent at the end. */
function TaskRow(props: {
  task: AgentTask;
  agent: AgentProfile | undefined;
  selected: boolean;
  wait: AgentTaskWait;
  onOpen: () => void;
}) {
  const { t } = useText();
  const status = () => agentTaskStatus(props.task, t, props.wait);
  return (
    <Button
      type="button"
      variant="ghost"
      class="tasks-page-row"
      data-selected={props.selected ? "" : undefined}
      aria-label={t("conversation.tasks.page.row", {
        title: props.task.title,
        agent: props.agent?.name ?? props.task.agentId,
        status: status(),
      })}
      aria-pressed={props.selected ? "true" : "false"}
      onClick={() => props.onOpen()}
    >
      <AgentTaskMark task={props.task} decorative />
      <span class="tasks-page-row-title" title={props.task.title}>
        {props.task.title}
      </span>
      <span class="tasks-page-status" data-tone={props.wait ? "attention" : taskTone(props.task)}>
        {status()}
      </span>
      <AgentAvatar agent={props.agent} class="tasks-page-avatar" />
    </Button>
  );
}

const SECTION_TITLE = {
  needsYou: "conversation.tasks.section.needsYou",
  working: "conversation.tasks.section.working",
  waiting: "conversation.tasks.section.waiting",
  unread: "conversation.tasks.section.unread",
  read: "conversation.tasks.section.read",
  closed: "conversation.threads.archived",
} as const satisfies Record<TasksSectionId, AppTextKey>;

/** The tasks by what they need, each section with its heading. The archived tasks are faded. */
function TasksList(props: TasksPageProps) {
  const { t } = useText();
  const ids = createUniqueId();
  const [view, setView] = createStore({ showAllClosed: false });
  const waitOf = (task: AgentTask) => props.waitOf?.(task);
  const sections = () => taskSections(props.tasks, view.showAllClosed, undefined, (task) => waitOf(task) !== undefined);
  return (
    <For each={sections()} keyed={(section) => section.id}>
      {(section) => (
        <Show when={section().tasks.length > 0}>
          <section
            class="tasks-page-section"
            data-closed={section().id === "closed" ? "" : undefined}
            aria-labelledby={`${ids}-${section().id}`}
          >
            <h3 id={`${ids}-${section().id}`} class="tasks-page-section-heading">
              <span>{t(SECTION_TITLE[section().id])}</span>
              <span class="tasks-page-count">{section().count}</span>
            </h3>
            <ul class="tasks-page-list">
              <For each={section().tasks} keyed={(task) => task.id}>
                {(task) => (
                  <li data-arrived={props.took?.task.id === task().id ? "" : undefined}>
                    <TaskRow
                      task={task()}
                      agent={agentOf(props.agents, task().agentId)}
                      selected={props.selectedId === task().id}
                      wait={waitOf(task())}
                      onOpen={() => props.onSelect(props.selectedId === task().id ? null : task().id)}
                    />
                  </li>
                )}
              </For>
            </ul>
            <Show when={section().id === "closed" && section().count > TASKS_CLOSED_SHOWN}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="tasks-page-show-all"
                aria-expanded={view.showAllClosed ? "true" : "false"}
                onClick={() =>
                  setView((draft) => {
                    draft.showAllClosed = !draft.showAllClosed;
                  })
                }
              >
                {view.showAllClosed
                  ? t("conversation.tasks.showLess")
                  : t("conversation.tasks.showAll", { count: section().count })}
              </Button>
            </Show>
          </section>
        </Show>
      )}
    </For>
  );
}

/** The close transition is 200ms; this ends a close whose `transitionend` does not come. */
const SIDE_CLOSE_FALLBACK_MS = 300;

export const TASKS_SIDE_DEFAULT = 420;
export const TASKS_SIDE_MIN = 320;
/** What the list keeps for itself, however far the side panel is dragged. */
const TASKS_LIST_MIN = 320;

/**
 * The task panel at the right of the page. It makes the list narrower; it does not cover it. The
 * panel slides in from the right and out again, so it stays shown until its close ends.
 */
function TasksSidePanel(props: {
  tasks: readonly AgentTask[];
  taskId: string | null;
  panel: (taskId: string) => JSX.Element;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}) {
  const { t } = useText();
  const sideId = createUniqueId();
  const [view, setView] = createStore<{
    shownId: string | null;
    closing: boolean;
    /** The width of the page, once measured. A narrow page makes the panel narrower, not the saved width. */
    pageWidth: number | null;
  }>({ shownId: untrack(() => props.taskId), closing: false, pageWidth: null });
  let side: HTMLDivElement | undefined;
  /** The list keeps its minimum; a page too narrow for both keeps the panel minimum. */
  const maxFor = (page: number | null | undefined) =>
    page == null ? Number.POSITIVE_INFINITY : Math.max(TASKS_SIDE_MIN, page - TASKS_LIST_MIN);
  const width = () => Math.round(Math.min(maxFor(view.pageWidth), Math.max(TASKS_SIDE_MIN, props.width)));
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const finishClose = () => {
    clearTimeout(closeTimer);
    setView((draft) => {
      draft.shownId = null;
      draft.closing = false;
    });
  };
  createEffect(
    () => props.taskId,
    (taskId) => {
      clearTimeout(closeTimer);
      if (taskId) {
        setView((draft) => {
          draft.shownId = taskId;
          draft.closing = false;
        });
        return;
      }
      if (!untrack(() => view.shownId)) return;
      if (prefersReducedMotion()) return finishClose();
      setView((draft) => {
        draft.closing = true;
      });
      closeTimer = setTimeout(finishClose, SIDE_CLOSE_FALLBACK_MS);
    },
  );
  onCleanup(() => clearTimeout(closeTimer));
  const shown = () => {
    const id = view.shownId;
    return id && props.tasks.some((task) => task.id === id) ? id : null;
  };
  /* The first task of an open slides in with the panel; only a change to a different task fades in. */
  let contentId: string | null = null;
  return (
    <Show when={shown()}>
      {(taskId) => {
        onCleanup(() => {
          contentId = null;
        });
        // Escape closes the panel, as on the settings page: on the document and after the delegated
        // handlers, so a control that handles Escape keeps it. An open popup or another text field also keeps it.
        onSettled(() => {
          const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
            if (
              target &&
              !target.closest(".tasks-page") &&
              target.closest("input, textarea, select, [contenteditable]")
            )
              return;
            event.preventDefault();
            props.onClose();
          };
          document.addEventListener("keydown", closeOnEscape);
          return () => document.removeEventListener("keydown", closeOnEscape);
        });
        return (
          <div
            ref={(element) => (side = element)}
            id={sideId}
            class="tasks-page-side"
            style={{ "--tasks-page-side-width": `${width()}px` }}
            data-closing={view.closing ? "" : undefined}
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget && event.propertyName === "flex-basis" && view.closing) {
                finishClose();
              }
            }}
          >
            <PanelResizer
              class="right-panel-resizer"
              label={t("conversation.tasks.panel.resize")}
              controls={sideId}
              direction="right"
              value={width()}
              defaultValue={TASKS_SIDE_DEFAULT}
              min={TASKS_SIDE_MIN}
              max={() => maxFor(side?.parentElement?.clientWidth)}
              onResize={props.onResize}
              onResizeEnd={props.onResizeEnd}
              onParentResize={() =>
                setView((draft) => {
                  draft.pageWidth = side?.parentElement?.clientWidth ?? null;
                })
              }
            />
            {/* The panel clips its content while it opens and closes; the edge handle stays outside the clip. */}
            <div class="tasks-page-side-clip">
              <For each={[taskId()]} keyed={(id) => id}>
                {(id) => {
                  const current = untrack(id);
                  const entering = contentId !== null && contentId !== current;
                  contentId = current;
                  return (
                    <div class="tasks-page-side-content" data-entering={entering ? "" : undefined}>
                      {props.panel(current)}
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

/**
 * The Tasks page of a server, on desktop and on the web: one calm column for the tasks of all agents.
 * The composer is at the top, with the agent selector. Below it, the tasks by what they need. A start
 * can be undone for a few seconds. A task opens in the panel beside the list.
 */
export function TasksPage(props: TasksPageProps) {
  const { t } = useText();
  const headingId = createUniqueId();
  let heading: HTMLHeadingElement | undefined;
  const agentsLabel = () =>
    t(props.agentsOpen ? "conversation.tasks.page.hideAgents" : "conversation.tasks.page.showAgents");
  // The first start adds a task that waits, so the page shows the list as soon as the user sends.
  const empty = () => props.loaded === true && props.tasks.length === 0;
  onSettled(() => {
    if (untrack(() => props.onBack)) heading?.focus();
  });
  return (
    <section class="tasks-page" aria-labelledby={headingId} data-empty={empty() ? "" : undefined}>
      <div class="tasks-page-scroll">
        <div class="tasks-page-column">
          <header class="tasks-page-header">
            <Show when={props.onBack}>
              {(back) => (
                <IconButton
                  variant="ghost"
                  label={t("common.back")}
                  data-cuelume-tap="navigate"
                  onClick={() => back()()}
                >
                  <ArrowLeft />
                </IconButton>
              )}
            </Show>
            <Show when={props.onToggleAgents}>
              {(toggle) => (
                <Button
                  variant="ghost"
                  type="button"
                  class="header-panel-toggle side-panel-toggle"
                  aria-label={agentsLabel()}
                  title={agentsLabel()}
                  aria-expanded={props.agentsOpen ? "true" : "false"}
                  onClick={() => toggle()()}
                >
                  <PanelLeft aria-hidden="true" class="size-[14px]" />
                </Button>
              )}
            </Show>
            <h2 id={headingId} ref={heading} tabindex={-1}>
              {t("conversation.tasks.title")}
              <Show when={props.hostName}>
                {(host) => (
                  <>
                    {" "}
                    <span aria-hidden="true">/</span> <span>{host()}</span>
                  </>
                )}
              </Show>
            </h2>
          </header>
          <Show when={empty()}>
            <TasksEmptyPitch />
          </Show>
          <TasksComposer {...props} />
          <div class="tasks-page-took-slot" aria-live="polite">
            <Show when={props.took}>{(took) => <TaskTookLine {...props} took={took()} />}</Show>
          </div>
          <TasksList {...props} />
          <Show when={empty()}>
            <TasksEmptyBoard agents={props.agents} />
          </Show>
        </div>
      </div>
      <TasksSidePanel
        tasks={props.tasks}
        taskId={props.selectedId}
        panel={props.panel}
        onClose={() => props.onSelect(null)}
        width={props.sideWidth}
        onResize={props.onSideResize}
        onResizeEnd={props.onSideResizeEnd}
      />
    </section>
  );
}
