/**
 * The last run of the focused routine, beside the canvas. With no node selected it lists the steps in
 * the order they ran; a selected agent shows the routines that start it and exactly what it received
 * and returned in the focused one's run, and a
 * selected routine shows what it asks for, which agents it starts, when it fires and how it went.
 */

import { Badge, Button, ChevronLeft, CopyButton, Textarea } from "@openbot/ui";
import { createEffect, createMemo, createSignal, For, flush, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { routineScheduleSummary } from "../conversation/routine-schedule-ui";
import { sidebarMessageTime } from "../sidebar/sidebar-filtering";
import { DiagramStepIcon } from "./DiagramNodeCard";
import { DiagramRoutineWeek, diagramRunStepStatus } from "./DiagramRoutineVisuals";
import {
  diagramAgentTask,
  diagramExecutionSteps,
  diagramRoutineColor,
  diagramRoutineReach,
  diagramRoutineSteps,
  diagramRoutinesReaching,
  diagramRunOf,
} from "./diagram-graph";
import type { Diagram, DiagramNode, DiagramStepRun } from "./diagram-model";
import { DIAGRAM_RUN_STATUS_KEY, DIAGRAM_STEP_STATUS_KEY, diagramStepSeconds } from "./diagram-text";

export interface DiagramInspectorProps {
  diagram: Diagram;
  agents: AgentProfile[];
  selectedNodeId: string | null;
  /** The routine whose last run the panel shows. */
  focusRoutineId: string | null;
  /** The day the routine week strip starts on. */
  now: Date;
  onSelectNode: (nodeId: string | null) => void;
  onFocusRoutine: (routineId: string) => void;
  /** Saves what an agent does in one routine. Without it, the task is read-only. */
  onEditTask?: ((nodeId: string, routineId: string, task: string) => void) | undefined;
}

export function DiagramInspector(props: DiagramInspectorProps) {
  const { t, format } = useText();
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const steps = createMemo(() =>
    props.focusRoutineId
      ? diagramRoutineSteps(props.diagram.edges, props.focusRoutineId)
      : diagramExecutionSteps(props.diagram.nodes, props.diagram.edges),
  );
  const focusedRun = () => diagramRunOf(props.diagram, props.focusRoutineId);
  const stepRuns = createMemo(() => new Map((focusedRun()?.steps ?? []).map((step) => [step.nodeId, step])));
  const selected = () => props.diagram.nodes.find((node) => node.id === props.selectedNodeId);
  const selectedRoutine = () => {
    const node = selected();
    return node?.kind === "routine" ? node : undefined;
  };
  const selectedAgent = () => {
    const node = selected();
    return node?.kind === "agent" ? agentById().get(node.agentId) : undefined;
  };
  const nodeName = (node: DiagramNode | undefined) => {
    if (!node) return "";
    if (node.kind === "routine") return node.name;
    return agentById().get(node.agentId)?.name ?? node.agentId;
  };
  /** The agents of the focused routine's run, in the order they run. */
  const orderedAgents = createMemo(() =>
    props.diagram.nodes
      .filter((node) => node.kind === "agent" && (!props.focusRoutineId || steps().has(node.id)))
      .sort((left, right) => (steps().get(left.id) ?? Infinity) - (steps().get(right.id) ?? Infinity)),
  );
  const startedBy = () => {
    const run = focusedRun();
    if (!run) return "";
    if (run.kind === "manual") return t("diagram.run.manual");
    return t("diagram.run.scheduled", {
      routine: nodeName(props.diagram.nodes.find((n) => n.id === run.routineNodeId)),
    });
  };

  return (
    <aside class="diagram-inspector" aria-label={t("diagram.inspector.label")}>
      <header class="window-drag diagram-inspector-header">
        <Show when={selected()} fallback={<h2 class="diagram-inspector-title">{t("diagram.inspector.label")}</h2>}>
          {(node) => (
            <>
              <Button
                type="button"
                variant="ghost"
                class="header-panel-toggle"
                aria-label={t("diagram.inspector.back")}
                title={t("diagram.inspector.back")}
                onClick={() => props.onSelectNode(null)}
              >
                <ChevronLeft aria-hidden="true" class="size-[14px]" />
              </Button>
              <Show when={selectedAgent()}>
                {(agent) => <AgentAvatar agent={agent()} class="diagram-inspector-avatar" motion="idle" />}
              </Show>
              <h2 class="diagram-inspector-title">{nodeName(node())}</h2>
              <Show when={steps().get(node().id)}>
                {(step) => <Badge>{t("diagram.node.step", { step: step() })}</Badge>}
              </Show>
            </>
          )}
        </Show>
      </header>

      <div class="diagram-inspector-body">
        <Show
          when={selected()}
          fallback={
            <Show when={focusedRun()} fallback={<p class="diagram-inspector-empty">{t("diagram.inspector.noRun")}</p>}>
              {(run) => (
                <>
                  <div class="diagram-inspector-run">
                    <Badge
                      variant={
                        run().status === "failed"
                          ? "destructive-light"
                          : run().status === "succeeded"
                            ? "success-light"
                            : "secondary"
                      }
                    >
                      {t(DIAGRAM_RUN_STATUS_KEY[run().status])}
                    </Badge>
                    <span>{t("diagram.run.last", { time: sidebarMessageTime(run().startedAt, format) })}</span>
                    <span class="diagram-inspector-muted">{startedBy()}</span>
                  </div>
                  <h3 class="diagram-inspector-section-title">{t("diagram.inspector.steps")}</h3>
                  <ol class="diagram-inspector-steps">
                    <For each={orderedAgents()}>
                      {(node) => {
                        const stepRun = () => stepRuns().get(node.id);
                        return (
                          <li>
                            <Button
                              type="button"
                              variant="ghost"
                              class="diagram-inspector-step"
                              onClick={() => props.onSelectNode(node.id)}
                            >
                              <span class="diagram-inspector-step-number">{steps().get(node.id) ?? "–"}</span>
                              <Show when={node.kind === "agent" ? agentById().get(node.agentId) : undefined}>
                                {(agent) => (
                                  <AgentAvatar agent={agent()} class="diagram-inspector-avatar" motion="idle" />
                                )}
                              </Show>
                              <span class="diagram-inspector-step-name">{nodeName(node)}</span>
                              <Show
                                when={stepRun()}
                                fallback={
                                  <span class="diagram-inspector-step-status">
                                    {steps().has(node.id) ? t("diagram.node.noRun") : t("diagram.node.unreachable")}
                                  </span>
                                }
                              >
                                {(current) => <StepStatus step={current()} />}
                              </Show>
                            </Button>
                          </li>
                        );
                      }}
                    </For>
                  </ol>
                </>
              )}
            </Show>
          }
        >
          {(node) => (
            <Show
              when={selectedRoutine()}
              fallback={
                <AgentStepDetail
                  node={node()}
                  diagram={props.diagram}
                  focusRoutineId={props.focusRoutineId}
                  stepRun={stepRuns().get(node().id)}
                  onFocusRoutine={props.onFocusRoutine}
                  onEditTask={props.onEditTask}
                />
              }
            >
              {(routine) => (
                <RoutineDetail
                  routine={routine()}
                  diagram={props.diagram}
                  agents={props.agents}
                  now={props.now}
                  onSelectNode={props.onSelectNode}
                />
              )}
            </Show>
          )}
        </Show>
      </div>
    </aside>
  );
}

function StepStatus(props: { step: DiagramStepRun }) {
  const { t, format } = useText();
  return (
    <span class="diagram-inspector-step-status" data-status={props.step.status}>
      <DiagramStepIcon status={props.step.status} />
      <Show when={diagramStepSeconds(props.step)} fallback={t(DIAGRAM_STEP_STATUS_KEY[props.step.status])}>
        {(seconds) => <>{t("diagram.inspector.seconds", { seconds: format.number(seconds()) })}</>}
      </Show>
    </span>
  );
}

/**
 * The task as text the user can change in place. It saves when it loses focus or on Command or
 * Control with Enter, and Escape puts back the saved task. A new task from the host replaces the
 * draft only while the user is not typing.
 */
function TaskEditor(props: { value: string; labelledBy: string; onSave: (task: string) => void }) {
  const { t } = useText();
  const [draft, setDraft] = createSignal(props.value);
  let editing = false;
  createEffect(
    () => props.value,
    (value) => {
      if (!editing) setDraft(value);
    },
  );
  const save = () => {
    editing = false;
    const next = draft().trim();
    if (next !== props.value.trim()) props.onSave(next);
  };
  return (
    <Textarea
      class="diagram-inspector-task"
      rows={2}
      value={draft()}
      placeholder={t("diagram.inspector.taskPlaceholder")}
      aria-labelledby={props.labelledBy}
      onFocus={() => (editing = true)}
      onValueChange={setDraft}
      onBlur={save}
      onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
        if (event.key === "Escape") {
          event.preventDefault();
          // Applied before the blur below reads the draft, or the blur would save what was typed.
          flush(() => setDraft(props.value));
          editing = false;
          event.currentTarget.blur();
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function AgentStepDetail(props: {
  node: DiagramNode;
  diagram: Diagram;
  focusRoutineId: string | null;
  stepRun: DiagramStepRun | undefined;
  onFocusRoutine: (routineId: string) => void;
  onEditTask?: ((nodeId: string, routineId: string, task: string) => void) | undefined;
}) {
  const { t } = useText();
  const routines = () => diagramRoutinesReaching(props.diagram.nodes, props.diagram.edges, props.node.id);
  const task = () => diagramAgentTask(props.node, props.focusRoutineId);
  /** The routine in focus, when this agent has a task in it that the user can change. */
  const editableIn = () => {
    const routineId = props.focusRoutineId;
    return props.onEditTask &&
      routineId &&
      props.node.kind === "agent" &&
      props.node.tasks &&
      routineId in props.node.tasks
      ? routineId
      : null;
  };
  return (
    <>
      <section class="diagram-inspector-section">
        <h3 class="diagram-inspector-section-title" id={`diagram-task-${props.node.id}`}>
          {t("diagram.inspector.task")}
        </h3>
        <Show when={editableIn()} keyed fallback={<p>{task()}</p>}>
          {(routineId) => (
            <TaskEditor
              value={task()}
              labelledBy={`diagram-task-${props.node.id}`}
              onSave={(next) => props.onEditTask?.(props.node.id, routineId, next)}
            />
          )}
        </Show>
      </section>
      {/* Each routine that starts this agent, with how the agent's step went in its last run. The
          one picked is the run the input and output below come from. */}
      <Show when={routines().length > 0}>
        <section class="diagram-inspector-section">
          <h3 class="diagram-inspector-section-title">{t("diagram.node.startedBy")}</h3>
          <ul class="diagram-inspector-steps">
            <For each={routines()}>
              {(routine) => {
                const step = () =>
                  diagramRunOf(props.diagram, routine.id)?.steps.find((entry) => entry.nodeId === props.node.id);
                return (
                  <li>
                    <Button
                      type="button"
                      variant="ghost"
                      class="diagram-inspector-step diagram-inspector-routine"
                      data-routine-color={diagramRoutineColor(props.diagram.nodes, routine.id)}
                      aria-pressed={props.focusRoutineId === routine.id ? "true" : "false"}
                      onClick={() => props.onFocusRoutine(routine.id)}
                    >
                      <span class="diagram-inspector-routine-dot" aria-hidden="true" />
                      <span class="diagram-inspector-step-name">{routine.name}</span>
                      <Show
                        when={step()}
                        fallback={<span class="diagram-inspector-step-status">{t("diagram.node.noRun")}</span>}
                      >
                        {(current) => <StepStatus step={current()} />}
                      </Show>
                    </Button>
                  </li>
                );
              }}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={props.stepRun} fallback={<p class="diagram-inspector-empty">{t("diagram.inspector.notRun")}</p>}>
        {(step) => (
          <>
            <TextBlock
              title={t("diagram.inspector.input")}
              text={step().input}
              empty={t("diagram.inspector.noInput")}
            />
            <Show when={step().error}>
              {(error) => <TextBlock title={t("diagram.inspector.error")} text={error()} empty="" tone="danger" />}
            </Show>
            <TextBlock
              title={t("diagram.inspector.output")}
              text={step().output}
              empty={t("diagram.inspector.noOutput")}
            />
          </>
        )}
      </Show>
    </>
  );
}

function TextBlock(props: { title: string; text: string | null; empty: string; tone?: "danger" }) {
  return (
    <section class="diagram-inspector-section">
      <div class="diagram-inspector-section-heading">
        <h3 class="diagram-inspector-section-title">{props.title}</h3>
        <Show when={props.text}>{(text) => <CopyButton value={text()} iconOnly size="icon-xs" variant="ghost" />}</Show>
      </div>
      <Show when={props.text} fallback={<p class="diagram-inspector-empty">{props.empty}</p>}>
        {(text) => (
          <pre class="diagram-inspector-text" data-tone={props.tone}>
            {text()}
          </pre>
        )}
      </Show>
    </section>
  );
}

type RoutineNode = Extract<DiagramNode, { kind: "routine" }>;

const UPCOMING_LIMIT = 5;
const HISTORY_LIMIT = 10;

function RoutineDetail(props: {
  routine: RoutineNode;
  diagram: Diagram;
  agents: AgentProfile[];
  now: Date;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const { t, format } = useText();
  const reach = createMemo(() => diagramRoutineReach(props.diagram.edges, props.routine.id));
  const started = () =>
    reach().direct.flatMap((id) => {
      const node = props.diagram.nodes.find((candidate) => candidate.id === id);
      return node?.kind === "agent" ? [node] : [];
    });
  const agentFor = (agentId: string) => props.agents.find((agent) => agent.id === agentId);
  /** The runs the week strip shows, so the list under it matches the picture. */
  const thisWeek = () => {
    const start = new Date(props.now);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 7 * 24 * 60 * 60 * 1000;
    return props.routine.upcomingRuns.filter((value) => Date.parse(value) < end);
  };
  const when = (value: string) =>
    format.date(new Date(value), {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <>
      <div class="diagram-inspector-run">
        <Badge variant={props.routine.active ? "success-light" : "secondary"}>
          {props.routine.active ? t("diagram.routine.active") : t("diagram.node.paused")}
        </Badge>
        <span>{routineScheduleSummary(props.routine.schedule, true)}</span>
      </div>

      <TextBlock title={t("diagram.routine.does")} text={props.routine.instruction} empty="" />

      <section class="diagram-inspector-section">
        <h3 class="diagram-inspector-section-title">{t("diagram.routine.starts")}</h3>
        <Show
          when={started().length > 0}
          fallback={<p class="diagram-inspector-empty">{t("diagram.routine.startsNothing")}</p>}
        >
          <ul class="diagram-inspector-steps">
            <For each={started()}>
              {(node) => (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    class="diagram-inspector-step"
                    onClick={() => props.onSelectNode(node.id)}
                  >
                    <Show when={agentFor(node.agentId)}>
                      {(agent) => <AgentAvatar agent={agent()} class="diagram-inspector-avatar" motion="idle" />}
                    </Show>
                    <span class="diagram-inspector-step-name">{agentFor(node.agentId)?.name ?? node.agentId}</span>
                  </Button>
                </li>
              )}
            </For>
          </ul>
          <p class="diagram-inspector-muted">
            {t("diagram.routine.reach", { count: reach().nodes, steps: reach().steps })}
          </p>
        </Show>
      </section>

      <section class="diagram-inspector-section">
        <h3 class="diagram-inspector-section-title">{t("diagram.routine.week")}</h3>
        <DiagramRoutineWeek upcomingRuns={props.routine.upcomingRuns} now={props.now} size="panel" />
        <Show
          when={thisWeek().length > 0}
          fallback={<p class="diagram-inspector-empty">{t("diagram.routine.noUpcoming")}</p>}
        >
          <ol class="diagram-inspector-times">
            <For each={thisWeek().slice(0, UPCOMING_LIMIT)}>{(at) => <li>{when(at)}</li>}</For>
          </ol>
        </Show>
      </section>

      <section class="diagram-inspector-section">
        <h3 class="diagram-inspector-section-title">{t("diagram.routine.history")}</h3>
        <Show
          when={props.routine.recentRuns.length > 0}
          fallback={<p class="diagram-inspector-empty">{t("diagram.routine.noHistory")}</p>}
        >
          <ol class="diagram-inspector-history">
            <For each={props.routine.recentRuns.slice(0, HISTORY_LIMIT)}>
              {(run) => {
                const seconds = () =>
                  run.finishedAt
                    ? Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))
                    : null;
                return (
                  <li>
                    <span class="diagram-inspector-step-status" data-status={run.status}>
                      <DiagramStepIcon status={diagramRunStepStatus(run.status)} />
                      {t(DIAGRAM_RUN_STATUS_KEY[run.status])}
                    </span>
                    <span class="diagram-inspector-history-time">
                      {when(run.startedAt)}
                      <Show when={run.kind === "manual"}>
                        <span class="diagram-inspector-history-kind">{t("diagram.routine.manual")}</span>
                      </Show>
                    </span>
                    <Show when={seconds()}>
                      {(value) => (
                        <span class="diagram-inspector-muted">
                          {t("diagram.inspector.seconds", { seconds: format.number(value()) })}
                        </span>
                      )}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </Show>
      </section>
    </>
  );
}
