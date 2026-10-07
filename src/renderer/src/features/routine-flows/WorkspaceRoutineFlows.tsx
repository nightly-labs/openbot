/**
 * The Routines view of the open agent: its canvas, as this computer's host keeps it. The host answers
 * the canvas; every edit goes back to it, and the canvas reloads when the host says it changed or a
 * routine run moved. A moved node is drawn where the user left it at once and saved a moment later.
 * The chat panel sends requests to the open agent, which edits the canvas with its tools.
 */

import { type RoutineFlowCanvas, type RoutineFlowLink, routineFlowAgentKey } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { DiagramView } from "@openbot/ui/features/diagrams/DiagramView";
import type { DiagramPoint } from "@openbot/ui/features/diagrams/diagram-model";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, onSettled, Show } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { createRoutineFlowAssistant } from "./routine-flow-assistant";
import { agentIdOfNode, isRoutineStartEdge, routineFlowDiagram, routineIdOfNode } from "./routine-flow-diagram";
import { type RoutineFlowsPort, routineFlowsPort } from "./routine-flows-port";

/** Coalesces the bursts of events one run sends: a turn ends, a queue moves, a routine changes. */
const RELOAD_DELAY_MS = 250;
/** A drag writes a position on every pointer move; only where it stops is saved. */
const SAVE_DELAY_MS = 400;
/** A connection drawn here and not yet saved by the host. It cannot be removed until it is. */
const PENDING_LINK_PREFIX = "pending:";

interface RoutineFlowState {
  canvas: RoutineFlowCanvas | null;
  error: string | null;
  /** Positions moved here and not yet answered by a reload. */
  moved: Record<string, DiagramPoint>;
  /** Connections drawn here, shown at once while the host saves them. */
  pendingLinks: RoutineFlowLink[];
}

export function WorkspaceRoutineFlows(props: { port?: RoutineFlowsPort }) {
  const { t, errorMessage } = useText();
  const { activeAgent, agentList } = useAgents();
  const { activeServerId } = useServers();
  const port = () => props.port ?? routineFlowsPort();
  const local = () => activeServerId() === "local";
  const agentId = () => activeAgent()?.id ?? null;
  const [state, setState] = createStore<RoutineFlowState>({
    canvas: null,
    error: null,
    moved: {},
    pendingLinks: [],
  });
  const assistant = createRoutineFlowAssistant(port, agentId);
  let generation = 0;
  let reloadTimer: number | undefined;
  const saveTimers = new Map<string, number>();

  const load = async (id: string) => {
    const current = ++generation;
    try {
      const canvas = await port().routineFlows.canvas(id, "local");
      if (current !== generation) return;
      setState((draft) => {
        draft.canvas = canvas;
        draft.error = null;
      });
    } catch (error) {
      if (current !== generation) return;
      setState((draft) => {
        draft.error = errorMessage(error, t("diagram.flows.loadFailed"));
      });
    }
  };
  const reloadSoon = () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      const id = agentId();
      if (id && local()) void load(id);
    }, RELOAD_DELAY_MS);
  };
  const failed = (fallback: string) => (error: unknown) => toast.error(errorMessage(error, fallback));

  createEffect(
    () => [agentId(), local()] as const,
    ([id, isLocal]) => {
      generation += 1;
      setState((draft) => {
        draft.canvas = null;
        draft.error = null;
        draft.moved = {};
        draft.pendingLinks = [];
      });
      if (id && isLocal) void load(id);
    },
  );

  onSettled(() => {
    const stopChanged = port().routineFlows.onChanged((change) => {
      const id = agentId();
      if (id && change.agentIds.includes(id)) reloadSoon();
    });
    const stopEvents = port().agent.onScopedEvent(({ serverId, event }) => {
      if (serverId !== "local") return;
      if (event.type === "routines-changed" || (event.type === "turn-completed" && event.origin === "routine"))
        reloadSoon();
    });
    return () => {
      stopChanged();
      stopEvents();
      window.clearTimeout(reloadTimer);
      for (const timer of saveTimers.values()) window.clearTimeout(timer);
    };
  });

  const diagram = createMemo(() => {
    const canvas = state.canvas;
    if (!canvas) return null;
    const pending = state.pendingLinks.filter(
      (link) =>
        !canvas.links.some(
          (saved) =>
            saved.routineId === link.routineId &&
            saved.fromAgentId === link.fromAgentId &&
            saved.toAgentId === link.toAgentId,
        ),
    );
    return routineFlowDiagram({ ...canvas, links: [...canvas.links, ...pending] }, agentList(), state.moved);
  });
  /** An agent with routines of its own stays: removing it would remove the routine, which belongs to settings. */
  const owners = createMemo(() => new Set(state.canvas?.routines.map((entry) => entry.routine.agentId) ?? []));

  /** The open agent edits its own canvas from the chat panel. */
  const assistantOf = (agent: AgentProfile | undefined) =>
    agent ? { agent, messages: assistant.messages(), working: assistant.working(), onSend: assistant.send } : undefined;

  const savePosition = (canvasAgentId: string, nodeKey: string, point: DiagramPoint) => {
    window.clearTimeout(saveTimers.get(nodeKey));
    saveTimers.set(
      nodeKey,
      window.setTimeout(() => {
        saveTimers.delete(nodeKey);
        port()
          .routineFlows.savePosition({ agentId: canvasAgentId, nodeKey, x: point.x, y: point.y }, "local")
          .catch(failed(t("diagram.flows.saveFailed")));
      }, SAVE_DELAY_MS),
    );
  };

  return (
    <Show
      when={local()}
      fallback={
        <main class="diagram-view diagram-flows-notice">
          <p>{t("diagram.flows.remoteOnly")}</p>
        </main>
      }
    >
      <Show
        when={diagram()}
        fallback={
          <main class="diagram-view diagram-flows-notice">
            <Show when={state.error}>{(error) => <p role="alert">{error()}</p>}</Show>
          </main>
        }
      >
        {(current) => (
          <Show when={agentId()} keyed>
            {(canvasAgentId) => (
              <DiagramView
                diagram={current()}
                agents={agentList()}
                owner={activeAgent()}
                assistant={assistantOf(activeAgent())}
                connectsWithinRoutine
                onMoveNode={(nodeId, position) => {
                  setState((draft) => {
                    draft.moved[nodeId] = position;
                  });
                  savePosition(canvasAgentId, nodeId, position);
                }}
                onConnect={(from, to, routineNodeId) => {
                  const routineId = routineIdOfNode(routineNodeId);
                  const fromAgentId = agentIdOfNode(from);
                  const toAgentId = agentIdOfNode(to);
                  if (!routineId) return;
                  if (!fromAgentId || !toAgentId) {
                    toast.error(t("diagram.flows.connectFromAgent"));
                    return;
                  }
                  const pending: RoutineFlowLink = {
                    id: `${PENDING_LINK_PREFIX}${crypto.randomUUID()}`,
                    routineId,
                    fromAgentId,
                    toAgentId,
                    instruction: "",
                    createdAt: new Date().toISOString(),
                  };
                  const settle = (saved: RoutineFlowLink | null) =>
                    setState((draft) => {
                      draft.pendingLinks = draft.pendingLinks.filter((link) => link.id !== pending.id);
                      if (
                        saved &&
                        draft.canvas?.agentId === canvasAgentId &&
                        !draft.canvas.links.some((link) => link.id === saved.id)
                      )
                        draft.canvas.links.push(saved);
                    });
                  setState((draft) => {
                    draft.pendingLinks.push(pending);
                  });
                  port()
                    .routineFlows.connect({ routineId, fromAgentId, toAgentId }, "local")
                    .then(settle)
                    .catch((error) => {
                      settle(null);
                      failed(t("diagram.flows.saveFailed"))(error);
                    });
                }}
                onRemoveEdge={(edgeId) => {
                  if (isRoutineStartEdge(edgeId) || edgeId.startsWith(PENDING_LINK_PREFIX)) return;
                  port()
                    .routineFlows.disconnect({ linkId: edgeId }, "local")
                    .catch(failed(t("diagram.flows.saveFailed")));
                }}
                onRemoveNode={(nodeId, routineNodeId) => {
                  const removed = agentIdOfNode(nodeId);
                  if (!removed) return;
                  const routineId = routineIdOfNode(routineNodeId);
                  const links =
                    state.canvas?.links.filter(
                      (link) => link.toAgentId === removed && (!routineId || link.routineId === routineId),
                    ) ?? [];
                  void Promise.all([
                    ...links.map((link) => port().routineFlows.disconnect({ linkId: link.id }, "local")),
                    port().routineFlows.removePosition(
                      { agentId: canvasAgentId, nodeKey: routineFlowAgentKey(removed) },
                      "local",
                    ),
                  ]).catch(failed(t("diagram.flows.saveFailed")));
                }}
                canRemoveNode={(nodeId) => {
                  const id = agentIdOfNode(nodeId);
                  return id !== null && id !== canvasAgentId && !owners().has(id);
                }}
                canRemoveEdge={(edgeId) => !isRoutineStartEdge(edgeId) && !edgeId.startsWith(PENDING_LINK_PREFIX)}
                onEditTask={(nodeId, routineNodeId, task) => {
                  const editedAgentId = agentIdOfNode(nodeId);
                  const routineId = routineIdOfNode(routineNodeId);
                  const routine = state.canvas?.routines.find((entry) => entry.routine.id === routineId)?.routine;
                  if (!editedAgentId || !routine) return;
                  // The routine's own agent does what the routine asks; every other agent, what the
                  // links that reach it in this routine ask.
                  const saved =
                    routine.agentId === editedAgentId
                      ? port().agent.updateRoutine(
                          { agentId: routine.agentId, routineId: routine.id, instruction: task },
                          "local",
                        )
                      : Promise.all(
                          (state.canvas?.links ?? [])
                            .filter((link) => link.routineId === routine.id && link.toAgentId === editedAgentId)
                            .map((link) =>
                              port().routineFlows.updateLink({ linkId: link.id, instruction: task }, "local"),
                            ),
                        );
                  saved.then(() => load(canvasAgentId)).catch(failed(t("diagram.flows.saveFailed")));
                }}
                onRunRoutine={(nodeId) => {
                  const routineId = routineIdOfNode(nodeId);
                  const routine = state.canvas?.routines.find((entry) => entry.routine.id === routineId)?.routine;
                  if (!routine) return;
                  port()
                    .agent.testRoutine({ agentId: routine.agentId, routineId: routine.id }, "local")
                    .then(() => load(canvasAgentId))
                    .catch(failed(t("diagram.flows.runFailed")));
                }}
              />
            )}
          </Show>
        )}
      </Show>
    </Show>
  );
}
