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
import { DiagramBoardEmpty } from "./DiagramBoardEmpty";
import { DiagramChatPanel } from "./DiagramChatPanel";
import { DiagramInspector, type DiagramRunStop, DiagramStopButton } from "./DiagramInspector";
import type { DiagramModelChoice, DiagramNewAgentDraft } from "./DiagramNewAgentCard";
import { DiagramStepIcon } from "./DiagramNodeCard";
import { diagramRunStepStatus } from "./DiagramRoutineVisuals";
import type { DiagramWebhookActions } from "./DiagramRoutineWebhookConfig";
import { diagramLatestRun, diagramRoutineColor, diagramRunOf } from "./diagram-graph";
import type { Diagram, DiagramChatMessage, DiagramNode, DiagramPoint, DiagramRunStatus } from "./diagram-model";

export interface DiagramViewProps {
  diagram: Diagram;
  agents: AgentProfile[];
  owner?: AgentProfile | undefined;
  now?: string | undefined;
  editable?: boolean | undefined;
  assistant?:
    | {
        agent: AgentProfile;
        messages: DiagramChatMessage[];
        working: boolean;
        onSend: (text: string) => void;
        onOpenLink?: ((url: string) => void) | undefined;
      }
    | undefined;
  onMoveNode: (nodeId: string, position: DiagramPoint) => void;
  onConnect: (from: string, to: string, routineId: string | null) => boolean | Promise<boolean>;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNode: (nodeId: string, routineId: string | null) => void;
  connectsWithinRoutine?: boolean;
  canRemoveNode?: ((nodeId: string) => boolean) | undefined;
  canRemoveEdge?: ((edgeId: string) => boolean) | undefined;
  onRunRoutine?: ((nodeId: string) => void) | undefined;
  onStopRun?: ((routineNodeId: string, runId: string) => Promise<void>) | undefined;
  addableAgents?: readonly AgentProfile[] | undefined;
  onPlaceAgent?: ((agentId: string, position: DiagramPoint) => void) | undefined;
  onCreateAgent?: ((draft: DiagramNewAgentDraft, position: DiagramPoint) => Promise<void>) | undefined;
  newAgentModels?: DiagramModelChoice | undefined;
  webhooks?: DiagramWebhookActions | undefined;
  onEditTask?: ((nodeId: string, routineId: string, task: string) => void) | undefined;
  onCreateRoutine?: (() => void) | undefined;
}

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

const ALL = "routine-lens:all";

export function DiagramView(props: DiagramViewProps) {
  const { t } = useText();
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [panels, setPanels] = createStore({ inspector: true, chat: false });
  const now = () => (props.now ? new Date(props.now) : new Date());
  const routines = () =>
    props.diagram.nodes.filter((node): node is Extract<DiagramNode, { kind: "routine" }> => node.kind === "routine");
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
  const [stopping, setStopping] = createSignal<string | null>(null);
  const runStop = (routineId: string | null | undefined): DiagramRunStop | undefined => {
    const stop = props.onStopRun;
    const run = routineId ? diagramRunOf(props.diagram, routineId) : undefined;
    if (!stop || !routineId || run?.status !== "running") return undefined;
    return {
      stopping: stopping() === run.id,
      onStop: () => {
        setStopping(run.id);
        stop(routineId, run.id).catch(() => setStopping((current) => (current === run.id ? null : current)));
      },
    };
  };
  const empty = () => props.diagram.nodes.every((node) => node.kind === "agent" && node.agentId === props.owner?.id);
  const routineOptions = (): RoutineOption[] => [
    { id: ALL, name: t("diagram.routine.all"), color: undefined, status: undefined },
    ...routines().map((routine) => ({
      id: routine.id,
      name: routine.name,
      color: diagramRoutineColor(props.diagram.nodes, routine.id),
      status: diagramRunOf(props.diagram, routine.id)?.status,
    })),
  ];
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
          <Show
            when={runStop(runTarget())}
            fallback={
              <Show when={props.onRunRoutine && runTarget()}>
                {(routineId) => (
                  <Button type="button" size="xs" onClick={() => runRoutine(routineId())}>
                    <Play aria-hidden="true" />
                    {t("diagram.node.runNow")}
                  </Button>
                )}
              </Show>
            }
          >
            {(stop) => <DiagramStopButton stop={stop()} />}
          </Show>
          <Show when={!empty()}>
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
          </Show>
        </span>
      </header>

      <div class="diagram-view-body" data-inspector={panels.inspector && !empty() ? "open" : undefined}>
        <div class="diagram-view-canvas">
          <Show when={!empty()} fallback={<DiagramBoardEmpty onCreateRoutine={props.onCreateRoutine} />}>
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
              onRunRoutine={props.onRunRoutine ? runRoutine : undefined}
              addableAgents={props.addableAgents}
              onPlaceAgent={props.onPlaceAgent}
              onCreateAgent={props.onCreateAgent}
              newAgentModels={props.newAgentModels}
            >
              <Show when={routines().length > 1}>
                <div class="diagram-view-lens-bar" data-diagram-overlay="">
                  <Select<RoutineOption>
                    class="diagram-view-lens"
                    options={routineOptions()}
                    optionValue="id"
                    optionTextValue="name"
                    value={routineOptions().find((option) => option.id === (focusRoutineId() ?? ALL)) ?? null}
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
            </DiagramBoard>
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
                  onOpenLink={(url) => assistant().onOpenLink?.(url)}
                />
              </div>
            )}
          </Show>
        </div>

        <Show when={panels.inspector && !empty()}>
          <DiagramInspector
            diagram={props.diagram}
            agents={props.agents}
            selectedNodeId={selectedNodeId()}
            focusRoutineId={focusRoutineId()}
            now={now()}
            onSelectNode={select}
            onFocusRoutine={setPicked}
            onEditTask={props.onEditTask}
            webhooks={props.webhooks}
            runStop={runStop(focusRoutineId())}
          />
        </Show>
      </div>
    </main>
  );
}
