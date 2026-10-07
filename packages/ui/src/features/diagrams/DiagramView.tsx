/**
 * A diagram in the chat area: its header, the canvas, the assistant over the canvas, and the last
 * run beside it. The view owns what is only presentation (the selection, the routine in focus, and
 * which panels are open); the diagram and every edit to it belong to the caller.
 *
 * When an agent is started by several routines, one routine is in focus at a time: the canvas shows
 * its path and its last run, and the panel shows what each agent received and returned in it. The
 * focus follows the newest run until the user picks a routine.
 */

import { Badge, Button, PanelRight, Play, SlidingTabs, Workflow } from "@openbot/ui";
import { createSignal, createStore, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { sidebarMessageTime } from "../sidebar/sidebar-filtering";
import { DiagramBoard } from "./DiagramBoard";
import { DiagramChatPanel } from "./DiagramChatPanel";
import { DiagramInspector } from "./DiagramInspector";
import { diagramLatestRun, diagramRoutineColor, diagramRunOf } from "./diagram-graph";
import type { Diagram, DiagramChatMessage, DiagramNode, DiagramPoint } from "./diagram-model";
import { DIAGRAM_RUN_STATUS_KEY } from "./diagram-text";

export interface DiagramViewProps {
  diagram: Diagram;
  agents: AgentProfile[];
  /** The day the routine week strips start on. Defaults to the time the view opens. */
  now?: string | undefined;
  editable?: boolean;
  /** The agent that edits the diagram from the chat panel. Without it, the panel is hidden. */
  assistant?:
    | {
        agent: AgentProfile;
        messages: DiagramChatMessage[];
        working: boolean;
        onSend: (text: string) => void;
      }
    | undefined;
  onMoveNode: (nodeId: string, position: DiagramPoint) => void;
  onConnect: (from: string, to: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
  onRunRoutine?: ((nodeId: string) => void) | undefined;
  onAddRoutine?: (() => void) | undefined;
  onAddAgent?: (() => void) | undefined;
}

/** The lens value that shows every routine at once. A node id never takes this form. */
const ALL = "routine-lens:all";

export function DiagramView(props: DiagramViewProps) {
  const { t, format } = useText();
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [panels, setPanels] = createStore({ inspector: true, chat: true });
  const now = () => (props.now ? new Date(props.now) : new Date());
  const routines = () =>
    props.diagram.nodes.filter((node): node is Extract<DiagramNode, { kind: "routine" }> => node.kind === "routine");
  /** `undefined` follows the newest run; `null` shows every routine at once, with no run. */
  const [picked, setPicked] = createSignal<string | null | undefined>(undefined);
  const focusRoutineId = (): string | null => {
    const choice = picked();
    if (choice === null) return null;
    if (choice && routines().some((node) => node.id === choice)) return choice;
    return diagramLatestRun(props.diagram)?.routineNodeId ?? null;
  };
  const focusedRun = () => diagramRunOf(props.diagram, focusRoutineId());
  const runRoutine = (routineId: string) => {
    setPicked(routineId);
    props.onRunRoutine?.(routineId);
  };
  const runTarget = () => focusRoutineId() ?? routines()[0]?.id;
  const select = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId)
      setPanels((state) => {
        state.inspector = true;
      });
  };
  return (
    <main class="diagram-view" aria-label={t("diagram.view.label", { name: props.diagram.name })}>
      <header class="diagram-view-header">
        <span class="diagram-view-icon" aria-hidden="true">
          <Workflow />
        </span>
        <h1 class="diagram-view-title">{props.diagram.name}</h1>
        <Show when={routines().length > 1}>
          <SlidingTabs.Root
            value={focusRoutineId() ?? ALL}
            onChange={(value: string) => setPicked(value === ALL ? null : value)}
          >
            <SlidingTabs.List class="diagram-view-lens" aria-label={t("diagram.routine.lens")}>
              <SlidingTabs.Trigger value={ALL} class="diagram-view-lens-tab">
                {t("diagram.routine.all")}
              </SlidingTabs.Trigger>
              <For each={routines()}>
                {(routine) => (
                  <SlidingTabs.Trigger
                    value={routine.id}
                    class="diagram-view-lens-tab"
                    data-routine-color={diagramRoutineColor(props.diagram.nodes, routine.id)}
                  >
                    <span class="diagram-view-lens-dot" aria-hidden="true" />
                    {routine.name}
                  </SlidingTabs.Trigger>
                )}
              </For>
            </SlidingTabs.List>
          </SlidingTabs.Root>
        </Show>
        <Show when={focusedRun()} fallback={<span class="diagram-view-run">{t("diagram.run.none")}</span>}>
          {(run) => (
            <span class="diagram-view-run">
              <Badge
                size="sm"
                shape="pill"
                tone={run().status === "failed" ? "danger" : run().status === "succeeded" ? "success" : "neutral"}
              >
                {t(DIAGRAM_RUN_STATUS_KEY[run().status])}
              </Badge>
              {t("diagram.run.last", { time: sidebarMessageTime(run().startedAt, format) })}
            </span>
          )}
        </Show>
        <span class="diagram-view-actions">
          <Show when={props.onRunRoutine && runTarget()}>
            {(routineId) => (
              <Button type="button" size="sm" onClick={() => runRoutine(routineId())}>
                <Play aria-hidden="true" />
                {t("diagram.node.runNow")}
              </Button>
            )}
          </Show>
          <Show when={!panels.inspector}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("diagram.inspector.label")}
              title={t("diagram.inspector.label")}
              onClick={() =>
                setPanels((state) => {
                  state.inspector = true;
                })
              }
            >
              <PanelRight aria-hidden="true" />
            </Button>
          </Show>
        </span>
      </header>

      <div class="diagram-view-body">
        <DiagramBoard
          diagram={props.diagram}
          agents={props.agents}
          selectedNodeId={selectedNodeId()}
          focusRoutineId={focusRoutineId()}
          now={now()}
          editable={props.editable}
          onSelectNode={select}
          onFocusRoutine={setPicked}
          onMoveNode={props.onMoveNode}
          onConnect={props.onConnect}
          onRemoveEdge={props.onRemoveEdge}
          onRemoveNode={(nodeId) => {
            if (selectedNodeId() === nodeId) setSelectedNodeId(null);
            props.onRemoveNode(nodeId);
          }}
          onRunRoutine={props.onRunRoutine ? runRoutine : undefined}
          onAddRoutine={props.onAddRoutine}
          onAddAgent={props.onAddAgent}
        >
          <Show when={props.assistant}>
            {(assistant) => (
              <div class="diagram-view-chat">
                <DiagramChatPanel
                  agent={assistant().agent}
                  messages={assistant().messages}
                  working={assistant().working}
                  open={panels.chat}
                  onOpenChange={(open) =>
                    setPanels((state) => {
                      state.chat = open;
                    })
                  }
                  onSend={(text) => assistant().onSend(text)}
                />
              </div>
            )}
          </Show>
        </DiagramBoard>

        <Show when={panels.inspector}>
          <DiagramInspector
            diagram={props.diagram}
            agents={props.agents}
            selectedNodeId={selectedNodeId()}
            focusRoutineId={focusRoutineId()}
            now={now()}
            onSelectNode={select}
            onFocusRoutine={setPicked}
            onClose={() =>
              setPanels((state) => {
                state.inspector = false;
              })
            }
            onRunRoutine={props.onRunRoutine ? runRoutine : undefined}
          />
        </Show>
      </div>
    </main>
  );
}
