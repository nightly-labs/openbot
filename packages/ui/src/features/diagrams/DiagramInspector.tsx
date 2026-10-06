/**
 * The last run of a diagram, beside the canvas. With no node selected it lists the steps in the
 * order they ran; a selected agent shows exactly what it received and what it returned, and a
 * selected routine shows its schedule.
 */

import { Badge, Button, ChevronLeft, CopyButton, Play, X } from "@openbot/ui";
import { createMemo, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { routineScheduleSummary } from "../conversation/routine-schedule-ui";
import { sidebarMessageTime } from "../sidebar/sidebar-filtering";
import { DiagramStepIcon } from "./DiagramNodeCard";
import { diagramExecutionSteps } from "./diagram-graph";
import type { Diagram, DiagramNode, DiagramStepRun } from "./diagram-model";
import { DIAGRAM_RUN_STATUS_KEY, DIAGRAM_STEP_STATUS_KEY, diagramStepSeconds } from "./diagram-text";

export interface DiagramInspectorProps {
  diagram: Diagram;
  agents: AgentProfile[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onClose: () => void;
  onRunRoutine?: ((nodeId: string) => void) | undefined;
}

export function DiagramInspector(props: DiagramInspectorProps) {
  const { t, format } = useText();
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const steps = createMemo(() => diagramExecutionSteps(props.diagram.nodes, props.diagram.edges));
  const stepRuns = createMemo(() => new Map((props.diagram.lastRun?.steps ?? []).map((step) => [step.nodeId, step])));
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
  /** Agents in the order they run; an agent no routine reaches comes last. */
  const orderedAgents = createMemo(() =>
    props.diagram.nodes
      .filter((node) => node.kind === "agent")
      .sort((left, right) => (steps().get(left.id) ?? Infinity) - (steps().get(right.id) ?? Infinity)),
  );
  const startedBy = () => {
    const run = props.diagram.lastRun;
    if (!run) return "";
    if (run.kind === "manual") return t("diagram.run.manual");
    return t("diagram.run.scheduled", {
      routine: nodeName(props.diagram.nodes.find((n) => n.id === run.routineNodeId)),
    });
  };

  return (
    <aside class="diagram-inspector" aria-label={t("diagram.inspector.label")}>
      <header class="diagram-inspector-header">
        <Show when={selected()} fallback={<h2 class="diagram-inspector-title">{t("diagram.inspector.label")}</h2>}>
          {(node) => (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("diagram.inspector.back")}
                title={t("diagram.inspector.back")}
                onClick={() => props.onSelectNode(null)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Show when={selectedAgent()}>
                {(agent) => <AgentAvatar agent={agent()} class="diagram-inspector-avatar" motion="idle" />}
              </Show>
              <h2 class="diagram-inspector-title">{nodeName(node())}</h2>
              <Show when={steps().get(node().id)}>
                {(step) => (
                  <Badge size="sm" shape="pill">
                    {t("diagram.node.step", { step: step() })}
                  </Badge>
                )}
              </Show>
            </>
          )}
        </Show>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="diagram-inspector-close"
          aria-label={t("diagram.inspector.close")}
          title={t("diagram.inspector.close")}
          onClick={() => props.onClose()}
        >
          <X aria-hidden="true" />
        </Button>
      </header>

      <div class="diagram-inspector-body">
        <Show
          when={selected()}
          fallback={
            <Show
              when={props.diagram.lastRun}
              fallback={<p class="diagram-inspector-empty">{t("diagram.inspector.noRun")}</p>}
            >
              {(run) => (
                <>
                  <div class="diagram-inspector-run">
                    <Badge
                      size="sm"
                      shape="pill"
                      tone={run().status === "failed" ? "danger" : run().status === "succeeded" ? "success" : "neutral"}
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
              fallback={<AgentStepDetail node={node()} stepRun={stepRuns().get(node().id)} />}
            >
              {(routine) => (
                <>
                  <section class="diagram-inspector-section">
                    <h3 class="diagram-inspector-section-title">{t("diagram.inspector.schedule")}</h3>
                    <p>{routineScheduleSummary(routine().schedule, true)}</p>
                  </section>
                  <Show when={routine().active && routine().nextRunAt}>
                    {(at) => (
                      <section class="diagram-inspector-section">
                        <h3 class="diagram-inspector-section-title">{t("diagram.inspector.nextRun")}</h3>
                        <p>{format.date(new Date(at()), { dateStyle: "medium", timeStyle: "short" })}</p>
                      </section>
                    )}
                  </Show>
                  <Show when={props.onRunRoutine}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => props.onRunRoutine?.(routine().id)}
                    >
                      <Play aria-hidden="true" />
                      {t("diagram.node.runNow")}
                    </Button>
                  </Show>
                </>
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

function AgentStepDetail(props: { node: DiagramNode; stepRun: DiagramStepRun | undefined }) {
  const { t } = useText();
  return (
    <>
      <Show when={props.stepRun}>{(step) => <StepStatus step={step()} />}</Show>
      <section class="diagram-inspector-section">
        <h3 class="diagram-inspector-section-title">{t("diagram.inspector.task")}</h3>
        <p>{props.node.kind === "agent" ? props.node.task : ""}</p>
      </section>
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
