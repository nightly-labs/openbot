import type { AgentTask, DraftAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  plainTaskTitle,
  TASKS_CLOSED_SHOWN,
  type TasksSectionId,
  taskSections,
  taskTone,
} from "@openbot/team-client/agent-tasks";
import { ArrowUp, Button, LoaderCircle, Mic, X } from "@openbot/ui";
import { PanelResizer } from "@openbot/ui/components/PanelResizer";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { AgentSearchSelect, agentOf } from "@openbot/ui/features/agents/AgentSearchSelect";
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
import { ComposerStackCard } from "@openbot/ui/features/conversation/ComposerStackCard";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import {
  type VoicePhase,
  VoiceRecordingMorph,
  voiceButtonLabel,
} from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { PageHeader, type PageHeaderFrame } from "@openbot/ui/features/window/PageHeader";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createStore, createUniqueId, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { createComposerRowsResize } from "../conversation/createComposerRowsResize";
import { TasksEmptyBoard, TasksEmptyPitch } from "./TasksEmpty";

export interface TasksVoice {
  phase: VoicePhase;
  levels: readonly number[];
  elapsedSeconds: number;
  liveText: string;
  modelProgress: number | null;
  onStart: () => void;
  onCancel: () => void;
  onFinish: () => void;
  blocked?: boolean | undefined;
}

interface TasksTook {
  task: AgentTask;
  pending: boolean;
}

interface TasksPageProps {
  hostName: string;
  onBack?: (() => void) | undefined;
  frame?: PageHeaderFrame | undefined;
  agents: AgentProfile[];
  tasks: readonly AgentTask[];
  loaded?: boolean | undefined;
  agentId: string;
  onAgentChange: (agentId: string) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  files?: readonly DraftAttachment[] | undefined;
  rowFiles?: readonly DraftAttachment[] | undefined;
  pendingImages?: readonly ComposerPendingImage[] | undefined;
  onRemoveFile?: ((attachment: DraftAttachment) => void) | undefined;
  onPasteFiles?:
    | ((files: File[], selection: ComposerSelection, text?: string) => Promise<ComposerPasteResult | undefined>)
    | undefined;
  focusRequest: number;
  startError: string | null;
  onDismissStartError: () => void;
  onStart: () => void;
  voice?: TasksVoice | undefined;
  took: TasksTook | null;
  onTookAgentChange: (agentId: string) => void;
  onUndo: () => void;
  onOpenTook: () => void;
  onDismissTook: () => void;
  selectedId: string | null;
  onSelect: (taskId: string | null) => void;
  panel: (taskId: string) => JSX.Element;
  sideWidth: number;
  onSideResize: (width: number) => void;
  onSideResizeEnd: (width: number) => void;
  waitOf?: ((task: AgentTask) => AgentTaskWait) | undefined;
  sendShortcut?: SendShortcut | undefined;
  macWindowControls?: boolean | undefined;
}

function TasksComposer(props: TasksPageProps) {
  const { t } = useText();
  const phase = (): VoicePhase => props.voice?.phase ?? "idle";
  const busy = () => phase() === "requesting" || phase() === "preparing" || phase() === "transcribing";
  const draftRows = createComposerRowsResize();
  const hasRow = () => (props.rowFiles?.length ?? 0) > 0 || (props.pendingImages?.length ?? 0) > 0;
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
      <div class="composer-stack">
        <ComposerStackCard when={props.startError}>
          {(body) => (
            <ComposerNotice
              tone="danger"
              title={t("conversation.tasks.error.start")}
              body={body()}
              onDismiss={props.onDismissStartError}
            />
          )}
        </ComposerStackCard>
      </div>
      <form
        ref={draftRows.form}
        class="composer"
        data-compact={hasRow() ? undefined : ""}
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
        <div class="composer-input-label" ref={draftRows.label}>
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
            <AgentSearchSelect
              agents={props.agents}
              agentId={props.agentId}
              label={t("conversation.tasks.page.agent", {
                name: agentOf(props.agents, props.agentId)?.name ?? props.agentId,
              })}
              onChange={props.onAgentChange}
            />
          </div>
          <div class="composer-primary-actions">
            <Show when={props.voice} fallback={send()}>
              {(voice) => (
                <>
                  <Show when={phase() === "preparing" && voice().modelProgress !== null}>
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
                    onSend={start}
                    send={send()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      class="dictation-button"
                      aria-label={t(voiceButtonLabel(phase(), voice().modelProgress))}
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
        <AgentSearchSelect
          agents={props.agents}
          agentId={props.took.task.agentId}
          label={t("conversation.tasks.page.reassign", {
            title: props.took.task.title,
            name: agent()?.name ?? props.took.task.agentId,
          })}
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

const SIDE_CLOSE_FALLBACK_MS = 300;

export const TASKS_SIDE_DEFAULT = 420;
export const TASKS_SIDE_MIN = 320;
const TASKS_LIST_MIN = 320;

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
    pageWidth: number | null;
  }>({ shownId: untrack(() => props.taskId), closing: false, pageWidth: null });
  let side: HTMLDivElement | undefined;
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
  let contentId: string | null = null;
  return (
    <Show when={shown()}>
      {(taskId) => {
        onCleanup(() => {
          contentId = null;
        });
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

function markComposerStuck(scroll: HTMLElement): void {
  const composer = scroll.querySelector(".tasks-page-composer");
  const stuck =
    composer !== null &&
    scroll.scrollTop > 0 &&
    Math.abs(composer.getBoundingClientRect().top - scroll.getBoundingClientRect().top) <= 1;
  scroll.toggleAttribute("data-composer-stuck", stuck);
}

export function TasksPage(props: TasksPageProps) {
  const { t } = useText();
  const headingId = createUniqueId();
  const empty = () => props.loaded === true && props.tasks.length === 0;
  const fades = createScrollFades({ stuck: ".tasks-page-composer" });
  onCleanup(() => fades.stop());
  return (
    <section class="tasks-page" aria-labelledby={headingId} data-empty={empty() ? "" : undefined}>
      <div
        class={["tasks-page-scroll", fades.classes()]}
        style={{ "--tasks-page-stuck-height": `${fades.stuckHeight()}px` }}
        ref={(element) => fades.bind(element)}
        onScroll={(event) => {
          fades.measure();
          markComposerStuck(event.currentTarget);
        }}
      >
        <div class="tasks-page-column" ref={fades.watch}>
          <PageHeader
            class="tasks-page-header"
            title={t("conversation.tasks.title")}
            hostName={props.hostName}
            headingId={headingId}
            onBack={props.onBack}
            frame={props.frame}
          />
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
      <ScrollEdgeBlur fades={fades} />
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
