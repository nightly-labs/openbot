import type { AgentTask } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  plainTaskTitle,
  TASKS_CLOSED_SHOWN,
  type TasksSectionId,
  taskSections,
  taskTone,
} from "@openbot/team-client/agent-tasks";
import {
  ArrowLeft,
  ArrowUp,
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  DropdownMenu,
  IconButton,
  LoaderCircle,
  Mic,
  PanelLeft,
  X,
} from "@openbot/ui";
import { SwapLabel, type SwapMotion } from "@openbot/ui/components/SwapLabel";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { AgentTaskMark, type AgentTaskWait, agentTaskStatus } from "@openbot/ui/features/conversation/AgentTasks";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import {
  type VoicePhase,
  VoiceRecordingMorph,
  voiceButtonLabel,
} from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, createUniqueId, For, onCleanup, onSettled, Show, untrack } from "solid-js";
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
  /** What the task's running turn waits for from the person: an approval, or an answer in the chat. */
  waitOf?: ((task: AgentTask) => AgentTaskWait) | undefined;
  /** The user's send shortcut for the composer. */
  sendShortcut?: SendShortcut | undefined;
}

const agentOf = (agents: readonly AgentProfile[], agentId: string) => agents.find((agent) => agent.id === agentId);

/** The trigger motion of the header model switcher: mostly a blur, so the old and new name cross in place. */
const AGENT_SWAP: SwapMotion = {
  distance: 6,
  blur: 6,
  enter: { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  leave: { duration: 180, easing: "ease" },
};

/**
 * The agent of a task, as a menu with the agent's face. A task has one agent, so the menu marks only
 * the chosen agent, as the routine trigger menu does.
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
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "sm" })} tasks-page-agent`}
        aria-label={
          props.title === undefined
            ? t("conversation.tasks.page.agent", { name: agent()?.name ?? props.agentId })
            : t("conversation.tasks.page.reassign", { title: props.title, name: agent()?.name ?? props.agentId })
        }
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
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="tasks-page-agent-menu">
          <DropdownMenu.RadioGroup value={props.agentId} onChange={(value) => props.onChange(value)}>
            <For each={props.agents} keyed={(option) => option.id}>
              {(option) => (
                <DropdownMenu.RadioItem value={option().id} closeOnSelect class="tasks-page-agent-option">
                  <AgentAvatar agent={option()} class="tasks-page-avatar" />
                  <span>{option().name}</span>
                  <Show when={props.agentId === option().id}>
                    <Check aria-hidden="true" class="tasks-page-agent-check" />
                  </Show>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  const canStart = () => phase() === "recording" || (phase() === "idle" && plainTaskTitle(props.draft) !== "");
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
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
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
                      disabled={busy()}
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

/**
 * The task panel at the right of the page. It makes the list narrower; it does not cover it. The
 * panel slides in from the right and out again, so it stays shown until its close ends.
 */
function TasksSidePanel(props: {
  tasks: readonly AgentTask[];
  taskId: string | null;
  panel: (taskId: string) => JSX.Element;
  onClose: () => void;
}) {
  const [view, setView] = createStore({ shownId: untrack(() => props.taskId), closing: false });
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
            class="tasks-page-side"
            data-closing={view.closing ? "" : undefined}
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget && event.propertyName === "flex-basis" && view.closing) {
                finishClose();
              }
            }}
          >
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
      />
    </section>
  );
}
