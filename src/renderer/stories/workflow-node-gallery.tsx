/**
 * The canvas of a node story. A press on a node selects it, a press on the canvas clears the
 * selection, and Delete in a node toolbar removes the node. Ports connect here too.
 */

import {
  BoardProvider,
  createBoard,
  type WfnEdge,
  type WfnResult,
  type WfnRunStatus,
} from "@openbot/ui/features/workflows/workflow-board";
import type { WorkflowCatalogs } from "@openbot/ui/features/workflows/workflow-model";
import type { JSX } from "@solidjs/web";
import { createStore, onCleanup, untrack } from "solid-js";
import { STEP_ANSWER, STORY_CATALOGS, STORY_IMAGES, STORY_SEED } from "./workflow-story-data";

export function NodeGallery(props: {
  selected?: string;
  edges?: readonly WfnEdge[];
  results?: Record<string, readonly WfnResult[]>;
  /** The run state of each step when the story opens. Retry on a failed step runs it again. */
  status?: Record<string, WfnRunStatus>;
  errors?: Record<string, string>;
  locked?: readonly string[];
  /** The choices of the nodes. The story catalogs when absent. */
  catalogs?: WorkflowCatalogs;
  children: JSX.Element;
}) {
  const [run, setRun] = createStore<{ status: Record<string, WfnRunStatus> }>({
    status: untrack(() => ({ ...props.status })),
  });
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** How many images each image step drew, so the next run draws the next story image. */
  const drawn = new Map<string, number>();
  let stage: HTMLElement | undefined;
  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
  });
  /** The result that a story run of the step records, from the kind of the node. */
  const answer = (id: string) => {
    const kind = stage?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.dataset.kind;
    if (kind !== "image") return kind === undefined ? undefined : STEP_ANSWER[kind];
    const made = (drawn.get(id) ?? 0) + 1;
    drawn.set(id, made);
    return STORY_IMAGES[made % STORY_IMAGES.length]?.name;
  };
  /** Each step runs by itself for 1.4 s, then adds its result. */
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
        const value = answer(id);
        if (value !== undefined) gallery.board.record(id, value);
      }, 1400),
    );
  };
  const gallery = createBoard({
    catalogs: () => props.catalogs ?? STORY_CATALOGS,
    selected: untrack(() => props.selected),
    edges: untrack(() => props.edges),
    results: untrack(() => props.results),
    locked: untrack(() => props.locked),
    status: (id) => run.status[id],
    error: (id) => props.errors?.[id],
    retry: runStep,
    runStep,
    // Each trigger of the gallery has the schedule of the story workflow.
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
