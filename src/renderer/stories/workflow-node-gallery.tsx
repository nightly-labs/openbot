import {
  BoardProvider,
  createBoard,
  type WfnEdge,
  type WfnFields,
  type WfnResult,
  type WfnRunStatus,
  type WorkflowAgentProgress,
} from "@openbot/ui/features/workflows/workflow-board";
import type { WorkflowGitHubCanvas } from "@openbot/ui/features/workflows/workflow-github";
import type { WorkflowCatalogs } from "@openbot/ui/features/workflows/workflow-model";
import type { JSX } from "@solidjs/web";
import { createStore, onCleanup, untrack } from "solid-js";
import { STEP_ANSWER, STORY_CATALOGS, STORY_IMAGES, STORY_SEED } from "./workflow-story-data";

export function NodeGallery(props: {
  selected?: string;
  edges?: readonly WfnEdge[];
  results?: Record<string, readonly WfnResult[]>;
  status?: Record<string, WfnRunStatus>;
  errors?: Record<string, string>;
  locked?: readonly string[];
  catalogs?: WorkflowCatalogs;
  github?: WorkflowGitHubCanvas;
  runOnApprove?: boolean;
  fields?: Record<string, WfnFields>;
  answer?: (id: string) => string | undefined;
  progress?: (id: string) => WorkflowAgentProgress | undefined;
  children: JSX.Element;
}) {
  const [run, setRun] = createStore<{ status: Record<string, WfnRunStatus> }>({
    status: untrack(() => ({ ...props.status })),
  });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const drawn = new Map<string, number>();
  let stage: HTMLElement | undefined;
  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
  });
  const answer = (id: string) => {
    const kind = stage?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.dataset.kind;
    if (kind !== "image") return kind === undefined ? undefined : STEP_ANSWER[kind];
    const made = (drawn.get(id) ?? 0) + 1;
    drawn.set(id, made);
    return STORY_IMAGES[made % STORY_IMAGES.length]?.name;
  };
  const runStep = (id: string) => {
    if (timers.has(id)) return;
    setRun((draft) => {
      draft.status[id] = "running";
    });
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        setRun((draft) => {
          draft.status[id] = "done";
        });
        const value = props.answer?.(id) ?? answer(id);
        if (value !== undefined) gallery.board.record(id, value);
      }, 1400),
    );
  };
  const gallery = createBoard({
    catalogs: () => props.catalogs ?? STORY_CATALOGS,
    github: () => props.github,
    selected: untrack(() => props.selected),
    edges: untrack(() => props.edges),
    results: untrack(() => props.results),
    fields: untrack(() => props.fields),
    locked: untrack(() => props.locked),
    status: (id) => run.status[id],
    progress: (id) => props.progress?.(id),
    error: (id) => props.errors?.[id],
    retry: runStep,
    runStep,
    decide: (id, approved) => {
      if (!props.runOnApprove || !approved) return;
      setRun((draft) => {
        draft.status[id] = "done";
      });
      for (const edge of props.edges ?? []) if (edge.from === id) runStep(edge.to);
    },
    schedule: () => STORY_SEED.schedule,
  });
  return (
    <BoardProvider board={gallery.board}>
      <main
        ref={(element) => {
          stage = element;
          gallery.setWorld(element);
        }}
        class="wfn-stage"
        aria-label="Workflow nodes"
        onPointerDown={(event) => gallery.selectFrom(event.target)}
        onFocusIn={(event) => gallery.selectFrom(event.target)}
      >
        <gallery.Edges />
        {props.children}
      </main>
    </BoardProvider>
  );
}
