import {
  type RoutineFlowCanvas,
  type RoutineFlowLink,
  type RoutineFlowRoutineInfo,
  routineFlowAgentKey,
} from "@openbot/contracts/ipc";
import type { EventFilter } from "@openbot/contracts/ipc-events";
import { toast } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import type { DiagramModelChoice, DiagramNewAgentDraft } from "@openbot/ui/features/diagrams/DiagramNewAgentCard";
import { DiagramView } from "@openbot/ui/features/diagrams/DiagramView";
import type { DiagramPoint } from "@openbot/ui/features/diagrams/diagram-model";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, onSettled, Show } from "solid-js";
import { createRoutineFlowAssistant } from "./routine-flow-assistant";
import { agentIdOfNode, isRoutineStartEdge, routineFlowDiagram, routineIdOfNode } from "./routine-flow-diagram";
import type { RoutineFlowsHost } from "./routine-flows-port";

const RELOAD_DELAY_MS = 250;
const SAVE_DELAY_MS = 400;
const PENDING_LINK_PREFIX = "pending:";

interface RoutineFlowState {
  canvas: RoutineFlowCanvas | null;
  error: string | null;
  moved: Record<string, DiagramPoint>;
  pendingLinks: RoutineFlowLink[];
  webhookConnected: boolean | null;
}

export interface RoutineFlowsCanvasProps {
  host: RoutineFlowsHost;
  agent: AgentProfile | undefined;
  agents: AgentProfile[];
  newAgentModels?: DiagramModelChoice | undefined;
  createAgent?: ((draft: DiagramNewAgentDraft) => Promise<{ id: string }>) | undefined;
  onCreateRoutine?: ((agentId: string) => void) | undefined;
}

export function RoutineFlowsCanvas(props: RoutineFlowsCanvasProps) {
  const { t, errorMessage } = useText();
  const host = () => props.host;
  const agentId = createMemo(() => props.agent?.id ?? null);
  const [state, setState] = createStore<RoutineFlowState>({
    canvas: null,
    error: null,
    moved: {},
    pendingLinks: [],
    webhookConnected: null,
  });
  const assistant = createRoutineFlowAssistant(host, agentId);
  let generation = 0;
  let reloadTimer: number | undefined;
  const pendingSaves = new Map<string, { timer: number; save: () => void }>();
  const savesInFlight = new Map<string, number>();
  const trackSave = <A,>(nodeKey: string, save: Promise<A>): Promise<A> => {
    savesInFlight.set(nodeKey, (savesInFlight.get(nodeKey) ?? 0) + 1);
    return save.finally(() => {
      const count = (savesInFlight.get(nodeKey) ?? 1) - 1;
      if (count > 0) savesInFlight.set(nodeKey, count);
      else savesInFlight.delete(nodeKey);
    });
  };

  const load = async (id: string) => {
    if (id !== agentId()) return;
    const current = ++generation;
    const stale = () => current !== generation || id !== agentId();
    try {
      const canvas = await host().flows.canvas(id);
      if (stale()) return;
      setState((draft) => {
        draft.canvas = canvas;
        draft.error = null;
        for (const nodeKey of Object.keys(draft.moved)) {
          if (!pendingSaves.has(nodeKey) && !savesInFlight.has(nodeKey)) delete draft.moved[nodeKey];
        }
      });
    } catch (error) {
      if (stale()) return;
      setState((draft) => {
        draft.error = errorMessage(error, t("diagram.flows.loadFailed"));
      });
    }
  };
  const reloadSoon = () => {
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      const id = agentId();
      if (id) void load(id);
    }, RELOAD_DELAY_MS);
  };
  const failed = (fallback: string) => (error: unknown) => toast.error(errorMessage(error, fallback));

  createEffect(agentId, (id) => {
    generation += 1;
    setState((draft) => {
      draft.canvas = null;
      draft.error = null;
      draft.moved = {};
      draft.pendingLinks = [];
    });
    if (id) void load(id);
  });

  onSettled(() => {
    host()
      .webhooks?.getStatus()
      .then((status) =>
        setState((draft) => {
          draft.webhookConnected = status.connected;
        }),
      )
      .catch(failed(t("routine.webhook.statusFailed")));
    const stopEvents = host().onEvent((event) => {
      if (event.type === "routine-flows-changed") {
        if (event.agentId === agentId()) reloadSoon();
      } else if (event.type === "routines-changed" || (event.type === "turn-completed" && event.origin === "routine"))
        reloadSoon();
    });
    return () => {
      stopEvents();
      window.clearTimeout(reloadTimer);
      for (const pending of pendingSaves.values()) {
        window.clearTimeout(pending.timer);
        pending.save();
      }
      pendingSaves.clear();
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
    return routineFlowDiagram({ ...canvas, links: [...canvas.links, ...pending] }, props.agents, state.moved);
  });
  const owners = createMemo(() => new Set(state.canvas?.routines.map((entry) => entry.routine.agentId) ?? []));
  const onCanvas = createMemo(
    () => new Set(diagram()?.nodes.flatMap((node) => (node.kind === "agent" ? [node.agentId] : [])) ?? []),
  );

  const placeAgent = (canvasAgentId: string, placed: string, position: DiagramPoint) => {
    const key = routineFlowAgentKey(placed);
    setState((draft) => {
      draft.moved[key] = position;
      if (draft.canvas && !draft.canvas.placedAgentIds.includes(placed)) draft.canvas.placedAgentIds.push(placed);
    });
    trackSave(key, host().flows.savePosition({ agentId: canvasAgentId, nodeKey: key, x: position.x, y: position.y }))
      .then(() => load(canvasAgentId))
      .catch((error) => {
        setState((draft) => {
          delete draft.moved[key];
          if (draft.canvas) draft.canvas.placedAgentIds = draft.canvas.placedAgentIds.filter((id) => id !== placed);
        });
        failed(t("diagram.flows.saveFailed"))(error);
      });
  };

  const assistantOf = (agent: AgentProfile | undefined) =>
    agent
      ? {
          agent,
          messages: assistant.messages(),
          working: assistant.working(),
          onSend: assistant.send,
          onOpenLink: (url: string) =>
            host()
              .openUrl(url)
              .catch(failed(t("composer.error.openLink"))),
        }
      : undefined;

  const routineOfNode = (routineNodeId: string) => {
    const routineId = routineIdOfNode(routineNodeId);
    return state.canvas?.routines.find((entry) => entry.routine.id === routineId)?.routine ?? null;
  };
  const ownerOf = (routine: RoutineFlowRoutineInfo) => ({ kind: "agent" as const, id: routine.agentId });
  const webhooksOrRefuse = () => {
    const webhooks = host().webhooks;
    if (!webhooks) toast.error(t("diagram.flows.webhookAdminOnly"));
    return webhooks;
  };
  const saveWebhookRoutine = (
    routine: RoutineFlowRoutineInfo,
    change: { instruction?: string; eventType?: string | null; filters?: EventFilter[] },
  ) => {
    const webhook = routine.trigger.kind === "webhook" ? routine.trigger : null;
    const webhooks = webhooksOrRefuse();
    if (!webhook || !webhooks) return Promise.reject(new Error(t("diagram.flows.saveFailed")));
    return webhooks.saveRoutine({
      id: routine.id,
      owner: ownerOf(routine),
      name: routine.name,
      instruction: change.instruction ?? routine.instruction,
      active: routine.active,
      timezone: routine.timezone,
      ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
      ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
      trigger: {
        kind: "webhook",
        eventType: change.eventType === undefined ? webhook.eventType : change.eventType,
        filters: change.filters ?? webhook.filters,
      },
    });
  };

  const savePosition = (canvasAgentId: string, nodeKey: string, point: DiagramPoint) => {
    window.clearTimeout(pendingSaves.get(nodeKey)?.timer);
    const save = () => {
      pendingSaves.delete(nodeKey);
      trackSave(nodeKey, host().flows.savePosition({ agentId: canvasAgentId, nodeKey, x: point.x, y: point.y })).catch(
        failed(t("diagram.flows.saveFailed")),
      );
    };
    pendingSaves.set(nodeKey, { timer: window.setTimeout(save, SAVE_DELAY_MS), save });
  };

  return (
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
              agents={props.agents}
              owner={props.agent}
              assistant={assistantOf(props.agent)}
              connectsWithinRoutine
              onCreateRoutine={props.onCreateRoutine ? () => props.onCreateRoutine?.(canvasAgentId) : undefined}
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
                if (!routineId) return Promise.resolve(false);
                if (!fromAgentId || !toAgentId) {
                  toast.error(t("diagram.flows.connectFromAgent"));
                  return Promise.resolve(false);
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
                return host()
                  .flows.connect({ routineId, fromAgentId, toAgentId })
                  .then((saved) => {
                    settle(saved);
                    return true;
                  })
                  .catch((error) => {
                    settle(null);
                    failed(t("diagram.flows.saveFailed"))(error);
                    return false;
                  });
              }}
              onRemoveEdge={(edgeId) => {
                if (isRoutineStartEdge(edgeId) || edgeId.startsWith(PENDING_LINK_PREFIX)) return;
                host()
                  .flows.disconnect({ linkId: edgeId })
                  .catch(failed(t("diagram.flows.saveFailed")));
              }}
              onRemoveNode={(nodeId, routineNodeId) => {
                const removed = agentIdOfNode(nodeId);
                if (!removed) return;
                const nodeKey = routineFlowAgentKey(removed);
                window.clearTimeout(pendingSaves.get(nodeKey)?.timer);
                pendingSaves.delete(nodeKey);
                setState((draft) => {
                  delete draft.moved[nodeKey];
                });
                const routineId = routineIdOfNode(routineNodeId);
                const links =
                  state.canvas?.links.filter(
                    (link) => link.toAgentId === removed && (!routineId || link.routineId === routineId),
                  ) ?? [];
                void Promise.all([
                  ...links.map((link) => host().flows.disconnect({ linkId: link.id })),
                  host().flows.removePosition({ agentId: canvasAgentId, nodeKey }),
                ]).catch(failed(t("diagram.flows.saveFailed")));
              }}
              canRemoveNode={(nodeId) => {
                const id = agentIdOfNode(nodeId);
                return id !== null && id !== canvasAgentId && !owners().has(id);
              }}
              canRemoveEdge={(edgeId) => !isRoutineStartEdge(edgeId) && !edgeId.startsWith(PENDING_LINK_PREFIX)}
              addableAgents={props.agents.filter((agent) => !onCanvas().has(agent.id))}
              onPlaceAgent={(placed, position) => placeAgent(canvasAgentId, placed, position)}
              newAgentModels={props.newAgentModels}
              onCreateAgent={
                props.createAgent
                  ? async (draft, position) => {
                      try {
                        const created = await props.createAgent?.(draft);
                        if (created) placeAgent(canvasAgentId, created.id, position);
                      } catch (error) {
                        toast.error(errorMessage(error, t("agent.error.createFailed")));
                        throw error;
                      }
                    }
                  : undefined
              }
              onEditTask={(nodeId, routineNodeId, task) => {
                const editedAgentId = agentIdOfNode(nodeId);
                const routineId = routineIdOfNode(routineNodeId);
                const routine = state.canvas?.routines.find((entry) => entry.routine.id === routineId)?.routine;
                if (!editedAgentId || !routine) return;
                const saved =
                  routine.agentId === editedAgentId
                    ? routine.trigger.kind === "webhook"
                      ? saveWebhookRoutine(routine, { instruction: task })
                      : host().routines.update({ agentId: routine.agentId, routineId: routine.id, instruction: task })
                    : Promise.all(
                        (state.canvas?.links ?? [])
                          .filter((link) => link.routineId === routine.id && link.toAgentId === editedAgentId)
                          .map((link) => host().flows.updateLink({ linkId: link.id, instruction: task })),
                      );
                saved.then(() => load(canvasAgentId)).catch(failed(t("diagram.flows.saveFailed")));
              }}
              onRunRoutine={(nodeId) => {
                const routineId = routineIdOfNode(nodeId);
                const routine = state.canvas?.routines.find((entry) => entry.routine.id === routineId)?.routine;
                if (!routine) return;
                let started: Promise<unknown>;
                if (routine.trigger.kind === "webhook") {
                  const webhooks = webhooksOrRefuse();
                  if (!webhooks) return;
                  started = webhooks.testRoutine({ id: routine.id, owner: ownerOf(routine) });
                } else started = host().routines.test({ agentId: routine.agentId, routineId: routine.id });
                started.then(() => load(canvasAgentId)).catch(failed(t("diagram.flows.runFailed")));
              }}
              onStopRun={
                host().stopRun
                  ? (nodeId, runId) => {
                      const routineId = routineIdOfNode(nodeId);
                      const stop = host().stopRun;
                      if (!routineId || !stop) return Promise.resolve();
                      return stop({ routineId, runId })
                        .then(() => load(canvasAgentId))
                        .catch((error: unknown) => {
                          failed(t("diagram.flows.stopFailed"))(error);
                          throw error;
                        });
                    }
                  : undefined
              }
              webhooks={
                host().webhooks
                  ? {
                      connected: state.webhookConnected,
                      onSave: async (routineNodeId, change) => {
                        const routine = routineOfNode(routineNodeId);
                        if (!routine) return;
                        await saveWebhookRoutine(routine, change);
                        await load(canvasAgentId);
                      },
                      onRegenerateSecret: async (routineNodeId) => {
                        const routine = routineOfNode(routineNodeId);
                        const webhooks = host().webhooks;
                        if (!routine || !webhooks) throw new Error(t("diagram.flows.saveFailed"));
                        const { secret } = await webhooks.rotateSecret({ id: routine.id, owner: ownerOf(routine) });
                        return secret;
                      },
                    }
                  : undefined
              }
            />
          )}
        </Show>
      )}
    </Show>
  );
}
