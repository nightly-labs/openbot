/**
 * The routine canvas before its first routine. A faint sample diagram builds itself behind the
 * pitch: the cards land, the connections draw, and one run passes through. Then it fades and starts
 * again. The backdrop is the real cards and edges, inert, so nothing in it can be clicked or focused,
 * and a reader hears only the pitch.
 */

import type { AppTextKey } from "@openbot/i18n";
import { Button } from "@openbot/ui";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { DiagramNodeCard, type DiagramNodeCardProps } from "./DiagramNodeCard";
import {
  diagramBounds,
  diagramEdgeArrow,
  diagramEdgeEnd,
  diagramEdgePath,
  diagramInputPort,
  diagramOutputPort,
  diagramRoutineColor,
  diagramRoutineSteps,
} from "./diagram-graph";
import type { DiagramEdge, DiagramNode, DiagramRoutineRun, DiagramStepRun } from "./diagram-model";

/** One step of the loop, in milliseconds. */
const STEP_MS = 1200;
/** Steps in one loop. The last `FADE` steps fade the backdrop out. */
const LENGTH = 12;
const FADE = 2;
/** The routine fires on this step, after the last card has landed. */
const FIRE = 4;
/** Less motion keeps this step: the run is done and each card shows its answer. */
const STILL = 9;
/** The margin the backdrop keeps inside the canvas, and the room a card's answer adds below it. */
const MARGIN = 48;
const ANSWER_ROOM = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

const ROUTINE_ID = "sample:routine";

/** The sample agents: the morning brief of the stories, with each agent's face, kicker, task and answer. */
const SAMPLE_AGENTS = [
  {
    id: "research",
    position: { x: 400, y: 0 },
    avatarSeed: "research",
    avatarHue: 185,
    appear: 1,
    name: "diagram.board.sample.researchName",
    title: "diagram.board.sample.researchTitle",
    task: "diagram.board.sample.researchTask",
    output: "diagram.board.sample.researchOutput",
    seconds: 42,
  },
  {
    id: "sales",
    position: { x: 400, y: 600 },
    avatarSeed: "sales-outbound",
    avatarHue: 280,
    appear: 1,
    name: "diagram.board.sample.salesName",
    title: "diagram.board.sample.salesTitle",
    task: "diagram.board.sample.salesTask",
    output: "diagram.board.sample.salesOutput",
    seconds: 31,
  },
  {
    id: "writer",
    position: { x: 840, y: 0 },
    avatarSeed: "writer",
    avatarHue: null,
    appear: 2,
    name: "diagram.board.sample.writerName",
    title: "diagram.board.sample.writerTitle",
    task: "diagram.board.sample.writerTask",
    output: "diagram.board.sample.writerOutput",
    seconds: 28,
  },
  {
    id: "chief",
    position: { x: 1200, y: 300 },
    avatarSeed: "chief",
    avatarHue: 245,
    appear: 3,
    name: "diagram.board.sample.chiefName",
    title: "diagram.board.sample.chiefTitle",
    task: "diagram.board.sample.chiefTask",
    output: "diagram.board.sample.chiefOutput",
    seconds: 25,
  },
] as const satisfies readonly {
  id: string;
  position: { x: number; y: number };
  avatarSeed: string;
  avatarHue: number | null;
  appear: number;
  name: AppTextKey;
  title: AppTextKey;
  task: AppTextKey;
  output: AppTextKey;
  seconds: number;
}[];

/** Each connection draws on the step its target lands on. */
const SAMPLE_EDGES: (DiagramEdge & { draw: number })[] = [
  { id: "sample:1", from: ROUTINE_ID, to: "research", draw: 1 },
  { id: "sample:2", from: ROUTINE_ID, to: "sales", draw: 1 },
  { id: "sample:3", from: "research", to: "writer", draw: 2 },
  { id: "sample:4", from: "sales", to: "writer", draw: 2 },
  { id: "sample:5", from: "writer", to: "chief", draw: 3 },
];

const RECENT_STATUSES: DiagramRoutineRun["status"][] = [
  "succeeded",
  "succeeded",
  "failed",
  "succeeded",
  "succeeded",
  "succeeded",
  "cancelled",
  "succeeded",
];

/** The next weekday mornings at 7:00, as the sample routine's schedule says. */
function weekdayMornings(from: Date, count: number): string[] {
  const day = new Date(from);
  day.setHours(7, 0, 0, 0);
  if (day <= from) day.setDate(day.getDate() + 1);
  const mornings: string[] = [];
  while (mornings.length < count) {
    if (day.getDay() !== 0 && day.getDay() !== 6) mornings.push(day.toISOString());
    day.setDate(day.getDate() + 1);
  }
  return mornings;
}

export interface DiagramBoardEmptyProps {
  /** Opens the settings of a new routine. Without it, the pitch has no action. */
  onCreateRoutine?: (() => void) | undefined;
}

export function DiagramBoardEmpty(props: DiagramBoardEmptyProps) {
  const { t } = useText();
  const [tick, setTick] = createSignal(0);
  const [still, setStill] = createSignal(false);
  onSettled(() => {
    if (prefersReducedMotion()) {
      setStill(true);
      setTick(STILL);
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  });
  const step = () => tick() % LENGTH;
  const loop = () => Math.floor(tick() / LENGTH);

  const title = () => {
    const marker = "\u0000";
    const [before = "", after = ""] = t("diagram.board.emptyTitle", { run: marker }).split(marker);
    return { before, after };
  };

  return (
    <div class="diagram-board diagram-empty" data-still={still() ? "" : undefined}>
      <div class="diagram-board-viewport diagram-empty-viewport">
        <DiagramEmptyBackdrop step={step()} loop={loop()} />
        <div class="diagram-empty-pitch">
          <h2 class="diagram-empty-title">
            <span class="diagram-empty-lead">{t("diagram.board.emptyLead")}</span>
            <span>
              {title().before}
              <span class="diagram-empty-hand">{t("diagram.board.emptyRun")}</span>
              {title().after}
            </span>
          </h2>
          <p class="diagram-empty-lines">
            <span>{t("diagram.board.emptyStart")}</span>
            <span>{t("diagram.board.emptyHandoff")}</span>
          </p>
          <Show when={props.onCreateRoutine}>
            {(create) => (
              <Button type="button" class="diagram-empty-action" onClick={() => create()()}>
                {t("routine.settings.create")}
              </Button>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

/** The faint diagram. It is decoration: inert, with no names for a reader. */
function DiagramEmptyBackdrop(props: { step: number; loop: number }) {
  const { t } = useText();
  let frame: HTMLDivElement | undefined;
  const [scale, setScale] = createSignal(1);
  const opened = new Date();

  const nodes = createMemo((): DiagramNode[] => [
    {
      kind: "routine",
      id: ROUTINE_ID,
      position: { x: 0, y: 300 },
      name: t("diagram.board.sample.routine"),
      instruction: t("diagram.board.sample.instruction"),
      schedule: { kind: "weekdays", time: "07:00" },
      active: true,
      upcomingRuns: weekdayMornings(opened, 6),
      recentRuns: RECENT_STATUSES.map((status, index) => {
        const started = opened.getTime() - (index + 1) * DAY_MS;
        return {
          id: `sample:run-${index}`,
          kind: "scheduled",
          status,
          startedAt: new Date(started).toISOString(),
          finishedAt: new Date(started + 60_000).toISOString(),
        };
      }),
    },
    ...SAMPLE_AGENTS.map(
      (agent): DiagramNode => ({
        kind: "agent",
        id: agent.id,
        position: agent.position,
        agentId: agent.id,
        task: t(agent.task),
      }),
    ),
  ]);
  const nodeById = createMemo(() => new Map(nodes().map((node) => [node.id, node])));
  const bounds = createMemo(() => diagramBounds(nodes()));
  const depth = diagramRoutineSteps(SAMPLE_EDGES, ROUTINE_ID);
  const routineColor = createMemo(() => diagramRoutineColor(nodes(), ROUTINE_ID));

  onSettled(() => {
    const area = frame;
    if (!area) return;
    const observer = new ResizeObserver(() => {
      setScale(
        Math.min(
          1,
          (area.clientWidth - MARGIN * 2) / bounds().width,
          (area.clientHeight - MARGIN * 2) / (bounds().height + ANSWER_ROOM),
        ),
      );
    });
    observer.observe(area);
    return () => observer.disconnect();
  });

  const fired = () => props.step >= FIRE;
  /** An agent runs on `FIRE + depth` and is done one step later, as the board shows a real run. */
  const stepRun = (nodeId: string): DiagramStepRun | undefined => {
    const agentDepth = depth.get(nodeId);
    const agent = SAMPLE_AGENTS.find((entry) => entry.id === nodeId);
    if (!fired() || agentDepth === undefined || !agent) return undefined;
    const start = FIRE + agentDepth;
    const status = props.step < start ? "waiting" : props.step === start ? "running" : "succeeded";
    const startedAt = opened.getTime() + agentDepth * 60_000;
    return {
      nodeId,
      status,
      input: null,
      output: status === "succeeded" ? t(agent.output) : null,
      error: null,
      startedAt: status === "waiting" ? null : new Date(startedAt).toISOString(),
      finishedAt: status === "succeeded" ? new Date(startedAt + agent.seconds * 1000).toISOString() : null,
    };
  };
  const lastStep = Math.max(0, ...depth.values());
  const firing = (nodeId: string) => nodeId === ROUTINE_ID && fired() && props.step <= FIRE + lastStep;
  const edgeState = (edge: DiagramEdge) => {
    const status = stepRun(edge.to)?.status;
    if (status === "running") return "running";
    return status === "succeeded" ? "delivered" : "idle";
  };
  const agentOf = (nodeId: string): DiagramNodeCardProps["agent"] => {
    const agent = SAMPLE_AGENTS.find((entry) => entry.id === nodeId);
    return agent
      ? { avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue, avatarUrl: null, title: t(agent.title) }
      : undefined;
  };
  const name = (node: DiagramNode) => {
    if (node.kind === "routine") return node.name;
    const agent = SAMPLE_AGENTS.find((entry) => entry.id === node.id);
    return agent ? t(agent.name) : "";
  };
  const appear = (nodeId: string) => SAMPLE_AGENTS.find((entry) => entry.id === nodeId)?.appear ?? 0;
  const pulsePath = (edge: DiagramEdge) => {
    const from = nodeById().get(edge.from);
    const to = nodeById().get(edge.to);
    return from && to ? diagramEdgePath(diagramOutputPort(from), diagramInputPort(to)) : "";
  };

  return (
    <div
      ref={(element) => (frame = element)}
      class="diagram-empty-backdrop"
      data-leaving={props.step >= LENGTH - FADE ? "" : undefined}
      inert
      aria-hidden="true"
    >
      <div class="diagram-empty-grid" />
      {/* One world per loop, so each loop lands its cards and draws its connections again. */}
      <For each={[props.loop]}>
        {() => (
          <div
            class="diagram-board-world diagram-empty-world"
            data-routine-color={fired() ? routineColor() : undefined}
            style={{
              width: `${bounds().width}px`,
              height: `${bounds().height}px`,
              "--diagram-empty-scale": String(scale()),
            }}
          >
            <svg class="diagram-edges" aria-hidden="true">
              <For each={SAMPLE_EDGES}>
                {(edge) => {
                  const ends = () => {
                    const from = nodeById().get(edge.from);
                    const to = nodeById().get(edge.to);
                    return from && to ? { from: diagramOutputPort(from), to: diagramInputPort(to) } : undefined;
                  };
                  return (
                    <Show when={ends()}>
                      {(points) => (
                        <g
                          class="diagram-edge diagram-empty-edge"
                          data-state={edgeState(edge)}
                          data-drawn={edge.draw <= props.step ? "" : undefined}
                        >
                          <path
                            class="diagram-edge-line"
                            d={diagramEdgePath(points().from, diagramEdgeEnd(points().to))}
                          />
                          <path class="diagram-edge-arrow" d={diagramEdgeArrow(points().to)} />
                        </g>
                      )}
                    </Show>
                  );
                }}
              </For>
            </svg>

            {/* The run pulse: one dot that rides each connection while its next agent starts. */}
            <For each={SAMPLE_EDGES}>
              {(edge) => (
                <Show when={edgeState(edge) === "running"}>
                  <span class="diagram-empty-pulse" style={{ "offset-path": `path("${pulsePath(edge)}")` }} />
                </Show>
              )}
            </For>

            <For each={nodes()}>
              {(node) => (
                <div class="diagram-empty-node" data-shown={appear(node.id) <= props.step ? "" : undefined}>
                  <DiagramNodeCard
                    node={node}
                    name={name(node)}
                    agent={node.kind === "agent" ? agentOf(node.id) : undefined}
                    unreachable={false}
                    dimmed={false}
                    routineColor={node.kind === "routine" ? routineColor() : undefined}
                    routines={[]}
                    focusRoutineId={ROUTINE_ID}
                    onFocusRoutine={() => undefined}
                    stepRun={stepRun(node.id)}
                    selected={false}
                    connectable={false}
                    removable={false}
                    connecting={false}
                    inputTarget="none"
                    firing={firing(node.id)}
                    onSelect={() => undefined}
                    onRemove={() => undefined}
                    onOutputPort={() => undefined}
                    onInputPort={() => undefined}
                  />
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
