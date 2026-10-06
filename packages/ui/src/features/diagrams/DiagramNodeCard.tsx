/**
 * One node on the canvas: a routine that starts a run, or an agent that takes input and returns
 * output. An agent card shows the output of its last run inline, so the canvas reads as the result
 * of the run as well as its plan. The card itself does not listen for the pointer: the board moves
 * it and draws connections from its ports, and finds it through the `data-diagram-*` attributes.
 */

import { Button, Check, Clock3, Minus, Play, Spinner, TriangleAlert, X } from "@openbot/ui";
import { Match, Show, Switch } from "solid-js";
import type { AvatarMood } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { routineScheduleSummary } from "../conversation/routine-schedule-ui";
import { DiagramRoutineRunDots, DiagramRoutineWeek } from "./DiagramRoutineVisuals";
import { DIAGRAM_NODE_WIDTH } from "./diagram-graph";
import type { DiagramNode, DiagramStepRun, DiagramStepStatus } from "./diagram-model";
import { DIAGRAM_STEP_STATUS_KEY, diagramStepSeconds } from "./diagram-text";

/** How an input port answers a connection in progress. */
export type DiagramPortTarget = "none" | "valid" | "invalid";

export interface DiagramNodeCardProps {
  node: DiagramNode;
  name: string;
  agent?: AgentProfile | undefined;
  /** The step an agent runs in; absent when no routine reaches it. */
  step?: number | undefined;
  stepRun?: DiagramStepRun | undefined;
  selected: boolean;
  editable: boolean;
  /** True while this node's output is the source of a connection in progress. */
  connecting: boolean;
  inputTarget: DiagramPortTarget;
  /** The day the week strip of a routine starts on. */
  now: Date;
  /** True while the run this routine started is in progress. */
  firing?: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onOutputPort: () => void;
  onInputPort: () => void;
  onRunRoutine?: (() => void) | undefined;
}

export function DiagramNodeCard(props: DiagramNodeCardProps) {
  const { t, format } = useText();
  const routine = () => (props.node.kind === "routine" ? props.node : undefined);
  const status = (): DiagramStepStatus | "idle" => props.stepRun?.status ?? "idle";
  const mood = (): AvatarMood => {
    if (status() === "running") return "working";
    return status() === "failed" ? "failed" : "idle";
  };
  /** A routine's kicker says when it fires next, or that it is paused. */
  const routineKicker = (node: Extract<DiagramNode, { kind: "routine" }>) => {
    if (!node.active) return t("diagram.node.paused");
    const next = node.upcomingRuns[0];
    if (!next) return t("diagram.node.routine");
    return t("diagram.node.nextRun", {
      time: format.date(new Date(next), { weekday: "short", hour: "numeric", minute: "2-digit" }),
    });
  };
  const label = () => {
    const node = routine();
    if (node)
      return t("diagram.node.routineLabel", { name: props.name, schedule: routineScheduleSummary(node.schedule) });
    return props.step === undefined
      ? t("diagram.node.agentUnreachableLabel", { name: props.name })
      : t("diagram.node.agentLabel", { name: props.name, step: props.step });
  };
  return (
    <div
      class="diagram-node"
      style={{
        "--diagram-node-x": `${props.node.position.x}px`,
        "--diagram-node-y": `${props.node.position.y}px`,
        "--diagram-node-width": `${DIAGRAM_NODE_WIDTH[props.node.kind]}px`,
      }}
      data-diagram-node={props.node.id}
      data-kind={props.node.kind}
      data-status={status()}
      data-firing={props.firing ? "" : undefined}
      data-selected={props.selected ? "" : undefined}
      data-unreachable={props.node.kind === "agent" && props.step === undefined ? "" : undefined}
    >
      <Show when={props.node.kind === "agent"}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="diagram-port diagram-port-in"
          data-diagram-control=""
          data-diagram-port="in"
          data-target={props.inputTarget}
          disabled={!props.editable}
          aria-label={t("diagram.port.input", { name: props.name })}
          onClick={() => props.onInputPort()}
        />
      </Show>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="diagram-port diagram-port-out"
        data-diagram-control=""
        data-diagram-port="out"
        data-connecting={props.connecting ? "" : undefined}
        disabled={!props.editable}
        aria-label={t("diagram.port.output", { name: props.name })}
        aria-pressed={props.connecting ? "true" : "false"}
        onClick={() => props.onOutputPort()}
      />

      <div class="diagram-node-header">
        <Button
          type="button"
          variant="ghost"
          class="diagram-node-select"
          aria-label={label()}
          aria-pressed={props.selected ? "true" : "false"}
          onClick={() => props.onSelect()}
        >
          <Show
            when={props.agent}
            fallback={
              <span class="diagram-node-icon" aria-hidden="true">
                <Clock3 />
              </span>
            }
          >
            {(agent) => <AgentAvatar agent={agent()} class="diagram-node-avatar" motion="idle" mood={mood()} />}
          </Show>
          <span class="diagram-node-heading">
            <span class="diagram-node-kicker">
              <Show when={routine()} fallback={props.agent?.title || props.agent?.model}>
                {(node) => <>{routineKicker(node())}</>}
              </Show>
            </span>
            <strong class="diagram-node-name">{props.name}</strong>
          </span>
        </Button>
        <Show when={props.step}>
          {(step) => (
            <span class="diagram-node-step" title={t("diagram.node.step", { step: step() })}>
              {step()}
            </span>
          )}
        </Show>
        <Show when={props.selected && props.editable}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="diagram-node-remove"
            data-diagram-control=""
            aria-label={t("diagram.node.remove", { name: props.name })}
            onClick={() => props.onRemove()}
          >
            <X aria-hidden="true" />
          </Button>
        </Show>
      </div>

      <Show
        when={routine()}
        fallback={
          <div class="diagram-node-body">
            <p class="diagram-node-task">{props.node.kind === "agent" ? props.node.task : ""}</p>
            <div class="diagram-node-preview" data-empty={props.stepRun?.output ? undefined : ""}>
              <Show
                when={props.stepRun?.error ?? props.stepRun?.output}
                fallback={
                  <span class="diagram-node-preview-empty">
                    {props.stepRun?.status === "running" ? t("diagram.step.running") : t("diagram.node.noRun")}
                  </span>
                }
              >
                {(text) => <p>{text()}</p>}
              </Show>
            </div>
            <div class="diagram-node-footer">
              <Show
                when={props.step !== undefined}
                fallback={
                  <span class="diagram-node-status" data-status="unreachable">
                    <TriangleAlert aria-hidden="true" />
                    {t("diagram.node.unreachable")}
                  </span>
                }
              >
                <Show when={props.stepRun}>
                  {(run) => (
                    <span class="diagram-node-status" data-status={run().status}>
                      <DiagramStepIcon status={run().status} />
                      {t(DIAGRAM_STEP_STATUS_KEY[run().status])}
                      <Show when={diagramStepSeconds(run())}>
                        {(seconds) => (
                          <span class="diagram-node-duration">
                            {t("diagram.inspector.seconds", { seconds: format.number(seconds()) })}
                          </span>
                        )}
                      </Show>
                    </span>
                  )}
                </Show>
              </Show>
            </div>
          </div>
        }
      >
        {(node) => (
          <div class="diagram-node-body">
            <p class="diagram-node-schedule">{routineScheduleSummary(node().schedule)}</p>
            <p class="diagram-routine-instruction">{node().instruction}</p>
            <DiagramRoutineWeek upcomingRuns={node().upcomingRuns} now={props.now} size="card" />
            <div class="diagram-node-footer">
              <DiagramRoutineRunDots runs={node().recentRuns} limit={8} />
              <Show when={props.onRunRoutine}>
                {(run) => (
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    class="diagram-node-run"
                    data-diagram-control=""
                    onClick={() => run()()}
                  >
                    <Play aria-hidden="true" />
                    {t("diagram.node.runNow")}
                  </Button>
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

export function DiagramStepIcon(props: { status: DiagramStepStatus }) {
  return (
    <Switch>
      <Match when={props.status === "running"}>
        <Spinner size="sm" />
      </Match>
      <Match when={props.status === "succeeded"}>
        <Check aria-hidden="true" />
      </Match>
      <Match when={props.status === "failed"}>
        <TriangleAlert aria-hidden="true" />
      </Match>
      <Match when={props.status === "skipped"}>
        <Minus aria-hidden="true" />
      </Match>
      <Match when={props.status === "waiting"}>
        <Clock3 aria-hidden="true" />
      </Match>
    </Switch>
  );
}
