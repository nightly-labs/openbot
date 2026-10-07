/**
 * A diagram in the chat area: its header, the canvas, the assistant over the canvas, and the last
 * run beside it. The view owns what is only presentation (the selection, the routine in focus, and
 * which panels are open); the diagram and every edit to it belong to the caller.
 *
 * When an agent is started by several routines, one routine is in focus at a time: the canvas shows
 * its path and its last run, and the panel shows what each agent received and returned in it. The
 * focus follows the newest run until the user picks a routine.
 */

import {
  Button,
  ChevronRight,
  PanelRight,
  Play,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Workflow,
} from "@openbot/ui";
import { createSignal, createStore, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { DiagramBoard } from "./DiagramBoard";
import { DiagramChatPanel } from "./DiagramChatPanel";
import { DiagramInspector } from "./DiagramInspector";
import { DiagramStepIcon } from "./DiagramNodeCard";
import { diagramRunStepStatus } from "./DiagramRoutineVisuals";
import { diagramLatestRun, diagramRoutineColor, diagramRunOf } from "./diagram-graph";
import type { Diagram, DiagramChatMessage, DiagramNode, DiagramPoint, DiagramRunStatus } from "./diagram-model";

export interface DiagramViewProps {
  diagram: Diagram;
  agents: AgentProfile[];
  /** The agent whose routines the diagram holds; its face replaces the diagram icon. */
  owner?: AgentProfile | undefined;
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
  /** `routineId` is the routine in focus when the connection was drawn, or null on "All routines". */
  onConnect: (from: string, to: string, routineId: string | null) => void;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNode: (nodeId: string, routineId: string | null) => void;
  /** A connection belongs to one routine, so new ones are drawn only while a routine is in focus. */
  connectsWithinRoutine?: boolean;
  canRemoveNode?: ((nodeId: string) => boolean) | undefined;
  canRemoveEdge?: ((edgeId: string) => boolean) | undefined;
  addableAgents?: readonly AgentProfile[] | undefined;
  onPlaceAgent?: ((agentId: string) => void) | undefined;
  onRunRoutine?: ((nodeId: string) => void) | undefined;
  onAddRoutine?: (() => void) | undefined;
  onAddAgent?: (() => void) | undefined;
}

/** One choice in the routine selector, with its colour and how its last run went. */
interface RoutineOption {
  id: string;
  name: string;
  color: number | undefined;
  status: DiagramRunStatus | undefined;
}

function RoutineOptionLabel(props: { option: RoutineOption }) {
  return (
    <span class="diagram-view-lens-option" data-routine-color={props.option.color}>
      <span
        class="diagram-view-lens-dot"
        data-all={props.option.color === undefined ? "" : undefined}
        aria-hidden="true"
      />
      <span class="diagram-view-lens-name">{props.option.name}</span>
      <Show when={props.option.status}>
        {(status) => (
          <span class="diagram-node-status" data-status={status()}>
            <DiagramStepIcon status={diagramRunStepStatus(status())} />
          </span>
        )}
      </Show>
    </span>
  );
}

/** The lens value that shows every routine at once. A node id never takes this form. */
const ALL = "routine-lens:all";

export function DiagramView(props: DiagramViewProps) {
  const { t } = useText();
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [panels, setPanels] = createStore({ inspector: true, chat: false });
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
  const runRoutine = (routineId: string) => {
    setPicked(routineId);
    props.onRunRoutine?.(routineId);
  };
  const runTarget = () => focusRoutineId() ?? routines()[0]?.id;
  /** The routines to highlight, after the choice to show them all. */
  const routineOptions = (): RoutineOption[] => [
    { id: ALL, name: t("diagram.routine.all"), color: undefined, status: undefined },
    ...routines().map((routine) => ({
      id: routine.id,
      name: routine.name,
      color: diagramRoutineColor(props.diagram.nodes, routine.id),
      status: diagramRunOf(props.diagram, routine.id)?.status,
    })),
  ];
  /** A routine also takes the focus, as picking it in the routine select does. */
  const select = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId && routines().some((node) => node.id === nodeId)) setPicked(nodeId);
    if (nodeId)
      setPanels((state) => {
        state.inspector = true;
      });
  };
  return (
    <main class="diagram-view" aria-label={t("diagram.view.label", { name: props.diagram.name })}>
      <header class="window-drag diagram-view-header">
        <Show
          when={props.owner}
          fallback={
            <span class="diagram-view-icon" aria-hidden="true">
              <Workflow />
            </span>
          }
        >
          {(owner) => <AgentAvatar agent={owner()} class="diagram-view-avatar" motion="idle" />}
        </Show>
        <h1 class="diagram-view-title">{props.diagram.name}</h1>
        <span class="diagram-view-actions">
          <Show when={props.onRunRoutine && runTarget()}>
            {(routineId) => (
              <Button type="button" size="xs" onClick={() => runRoutine(routineId())}>
                <Play aria-hidden="true" />
                {t("diagram.node.runNow")}
              </Button>
            )}
          </Show>
          <Button
            type="button"
            variant="ghost"
            class="header-panel-toggle"
            aria-label={t(panels.inspector ? "diagram.inspector.close" : "diagram.inspector.label")}
            aria-expanded={panels.inspector ? "true" : "false"}
            title={t(panels.inspector ? "diagram.inspector.close" : "diagram.inspector.label")}
            onClick={() =>
              setPanels((state) => {
                state.inspector = !state.inspector;
              })
            }
          >
            <Show when={panels.inspector} fallback={<PanelRight aria-hidden="true" class="size-[14px]" />}>
              <ChevronRight aria-hidden="true" class="size-[14px]" />
            </Show>
          </Button>
        </span>
      </header>

      <div class="diagram-view-body" data-inspector={panels.inspector ? "open" : undefined}>
        <DiagramBoard
          diagram={props.diagram}
          agents={props.agents}
          selectedNodeId={selectedNodeId()}
          focusRoutineId={focusRoutineId()}
          editable={props.editable}
          onSelectNode={select}
          onFocusRoutine={setPicked}
          onMoveNode={props.onMoveNode}
          onConnect={(from, to) => props.onConnect(from, to, focusRoutineId())}
          onRemoveEdge={props.onRemoveEdge}
          onRemoveNode={(nodeId) => {
            if (selectedNodeId() === nodeId) setSelectedNodeId(null);
            props.onRemoveNode(nodeId, focusRoutineId());
          }}
          connectable={!props.connectsWithinRoutine || focusRoutineId() !== null}
          canRemoveNode={props.canRemoveNode}
          canRemoveEdge={props.canRemoveEdge}
          addableAgents={props.addableAgents}
          onPlaceAgent={props.onPlaceAgent}
          onRunRoutine={props.onRunRoutine ? runRoutine : undefined}
          onAddRoutine={props.onAddRoutine}
          onAddAgent={props.onAddAgent}
        >
          <Show when={routines().length > 1}>
            <div class="diagram-view-lens-bar" data-diagram-overlay="">
              <Select<RoutineOption>
                class="diagram-view-lens"
                options={routineOptions()}
                optionValue="id"
                optionTextValue="name"
                value={routineOptions().find((option) => option.id === (focusRoutineId() ?? ALL))}
                onChange={(option) => option && setPicked(option.id === ALL ? null : option.id)}
                placement="bottom"
                sameWidth={false}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>
                    <RoutineOptionLabel option={itemProps.item.rawValue} />
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" class="diagram-view-lens-trigger" aria-label={t("diagram.routine.lens")}>
                  <SelectValue<RoutineOption>>
                    {(state) => <RoutineOptionLabel option={state.selectedOption()} />}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>
          </Show>
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
            onRunRoutine={props.onRunRoutine ? runRoutine : undefined}
          />
        </Show>
      </div>
    </main>
  );
}
