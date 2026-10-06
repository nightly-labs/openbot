/**
 * A diagram in the chat area: its header, the canvas, the assistant over the canvas, and the last
 * run beside it. The view owns what is only presentation (the selection and which panels are open);
 * the diagram and every edit to it belong to the caller.
 */

import { Badge, Button, PanelRight, Play, Workflow } from "@openbot/ui";
import { createSignal, createStore, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { sidebarMessageTime } from "../sidebar/sidebar-filtering";
import { DiagramBoard } from "./DiagramBoard";
import { DiagramChatPanel } from "./DiagramChatPanel";
import { DiagramInspector } from "./DiagramInspector";
import type { Diagram, DiagramChatMessage, DiagramPoint } from "./diagram-model";
import { DIAGRAM_RUN_STATUS_KEY } from "./diagram-text";

export interface DiagramViewProps {
  diagram: Diagram;
  agents: AgentProfile[];
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

export function DiagramView(props: DiagramViewProps) {
  const { t, format } = useText();
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [panels, setPanels] = createStore({ inspector: true, chat: true });
  const firstRoutineId = () => props.diagram.nodes.find((node) => node.kind === "routine")?.id;
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
        <Show when={props.diagram.lastRun} fallback={<span class="diagram-view-run">{t("diagram.run.none")}</span>}>
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
          <Show when={props.onRunRoutine && firstRoutineId()}>
            {(routineId) => (
              <Button type="button" size="sm" onClick={() => props.onRunRoutine?.(routineId())}>
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
          editable={props.editable}
          onSelectNode={select}
          onMoveNode={props.onMoveNode}
          onConnect={props.onConnect}
          onRemoveEdge={props.onRemoveEdge}
          onRemoveNode={(nodeId) => {
            if (selectedNodeId() === nodeId) setSelectedNodeId(null);
            props.onRemoveNode(nodeId);
          }}
          onRunRoutine={props.onRunRoutine}
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
            onSelectNode={select}
            onClose={() =>
              setPanels((state) => {
                state.inspector = false;
              })
            }
            onRunRoutine={props.onRunRoutine}
          />
        </Show>
      </div>
    </main>
  );
}
