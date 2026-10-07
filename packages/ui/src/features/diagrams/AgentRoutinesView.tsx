/**
 * The routines of one agent or channel, in the main area: a list of every routine whose run reaches
 * it, and the canvas of the one picked. Each routine is its own diagram, the routine and every agent
 * its run reaches, so the canvas always shows one run's path. The caller renders that canvas as the
 * children, because it owns the diagram and every edit to it.
 */

import { Button, Plus, Workflow } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { routineScheduleSummary } from "../conversation/routine-schedule-ui";
import { DiagramStepIcon } from "./DiagramNodeCard";
import { DiagramRoutineRunDots, diagramRunStepStatus } from "./DiagramRoutineVisuals";
import { diagramLatestRun, diagramRoutineColor } from "./diagram-graph";
import type { Diagram, DiagramNode } from "./diagram-model";

type RoutineNode = Extract<DiagramNode, { kind: "routine" }>;

export interface AgentRoutinesViewProps {
  /** The agent whose routines these are; absent for a channel, which has no face of its own. */
  agent?: AgentProfile | undefined;
  name: string;
  /** One diagram per routine. */
  diagrams: Diagram[];
  selectedId: string | null;
  onSelect: (diagramId: string) => void;
  onCreateRoutine?: (() => void) | undefined;
  /** The canvas of the selected routine. */
  children?: JSX.Element;
}

function routineOf(diagram: Diagram): RoutineNode | undefined {
  return diagram.nodes.find((node): node is RoutineNode => node.kind === "routine");
}

export function AgentRoutinesView(props: AgentRoutinesViewProps) {
  const { t, format } = useText();
  return (
    // Not a landmark: the canvas inside is the page's main region.
    <div class="agent-routines">
      <section class="agent-routines-list" aria-label={t("diagram.agentRoutines.label", { name: props.name })}>
        <header class="agent-routines-header">
          <Show
            when={props.agent}
            fallback={
              <span class="diagram-view-icon" aria-hidden="true">
                <Workflow />
              </span>
            }
          >
            {(agent) => <AgentAvatar agent={agent()} class="agent-routines-avatar" motion="idle" />}
          </Show>
          <span class="agent-routines-heading">
            <span class="agent-routines-kicker">{t("diagram.agentRoutines.title")}</span>
            <h1 class="agent-routines-name">{props.name}</h1>
          </span>
          <Show when={props.onCreateRoutine}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("diagram.agentRoutines.create")}
              title={t("diagram.agentRoutines.create")}
              onClick={() => props.onCreateRoutine?.()}
            >
              <Plus aria-hidden="true" />
            </Button>
          </Show>
        </header>

        <ul class="agent-routines-items">
          <For
            each={props.diagrams}
            fallback={
              <li class="agent-routines-empty">
                <p>{t("diagram.agentRoutines.empty", { name: props.name })}</p>
                <Show when={props.onCreateRoutine}>
                  <Button type="button" variant="secondary" size="sm" onClick={() => props.onCreateRoutine?.()}>
                    <Plus aria-hidden="true" />
                    {t("diagram.agentRoutines.create")}
                  </Button>
                </Show>
              </li>
            }
          >
            {(diagram) => (
              <Show when={routineOf(diagram)}>
                {(routine) => {
                  const lastRun = () => diagramLatestRun(diagram);
                  const agentCount = () => diagram.nodes.filter((node) => node.kind === "agent").length;
                  const next = () =>
                    routine().active
                      ? routine().upcomingRuns[0]
                        ? t("diagram.node.nextRun", {
                            time: format.date(new Date(routine().upcomingRuns[0] ?? ""), {
                              weekday: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            }),
                          })
                        : ""
                      : t("diagram.node.paused");
                  return (
                    <li>
                      <Button
                        type="button"
                        variant="ghost"
                        class="agent-routines-item"
                        data-routine-color={diagramRoutineColor(diagram.nodes, routine().id)}
                        aria-pressed={props.selectedId === diagram.id ? "true" : "false"}
                        onClick={() => props.onSelect(diagram.id)}
                      >
                        <span class="agent-routines-item-top">
                          <span class="diagram-view-lens-dot" aria-hidden="true" />
                          <strong class="agent-routines-item-name">{routine().name}</strong>
                          <Show when={lastRun()}>
                            {(run) => <DiagramStepIcon status={diagramRunStepStatus(run().status)} />}
                          </Show>
                        </span>
                        <span class="agent-routines-item-schedule">{routineScheduleSummary(routine().schedule)}</span>
                        <span class="agent-routines-item-meta">
                          <span>{next()}</span>
                          <span>{t("diagram.agentRoutines.agents", { count: agentCount() })}</span>
                        </span>
                        <DiagramRoutineRunDots runs={routine().recentRuns} limit={10} />
                      </Button>
                    </li>
                  );
                }}
              </Show>
            )}
          </For>
        </ul>
      </section>

      <div class="agent-routines-canvas">{props.children}</div>
    </div>
  );
}
