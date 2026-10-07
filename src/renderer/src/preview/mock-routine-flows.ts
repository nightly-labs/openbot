// The routine flow group of the preview: links and positions in memory, over the mock's routines.
// It runs no flow, so a step only exists when a story seeds one.

import type {
  OpenBotDesktopApi,
  Routine,
  RoutineFlowLink,
  RoutineFlowStep,
  RoutineFlowsChanged,
  RoutineRun,
} from "@openbot/contracts/ipc";

interface MockRoutineFlowsSource {
  routines: Map<string, Routine[]>;
  routineRuns: Map<string, RoutineRun[]>;
  links?: RoutineFlowLink[];
  steps?: RoutineFlowStep[];
}

export function mockRoutineFlows(source: MockRoutineFlowsSource): OpenBotDesktopApi["routineFlows"] {
  const links: RoutineFlowLink[] = structuredClone(source.links ?? []);
  const steps: RoutineFlowStep[] = structuredClone(source.steps ?? []);
  const positions = new Map<string, Map<string, { x: number; y: number }>>();
  const listeners = new Set<(change: RoutineFlowsChanged) => void>();
  const allRoutines = () => [...source.routines.values()].flat();
  const owner = (routineId: string) => allRoutines().find((routine) => routine.id === routineId)?.agentId ?? null;
  const changed = (agentIds: string[]) => {
    for (const listener of listeners) listener({ agentIds: [...new Set(agentIds)] });
  };

  return {
    canvas: async (agentId) => {
      const own = source.routines.get(agentId) ?? [];
      const touching = new Set(
        links
          .filter((link) => link.fromAgentId === agentId || link.toAgentId === agentId)
          .map((link) => link.routineId),
      );
      const others = allRoutines().filter((routine) => touching.has(routine.id) && routine.agentId !== agentId);
      const routines = [...own, ...others];
      const placed = positions.get(agentId) ?? new Map();
      return structuredClone({
        agentId,
        routines: routines.map((routine) => {
          const recentRuns = (source.routineRuns.get(routine.id) ?? []).slice(0, 10);
          return {
            routine,
            recentRuns,
            upcomingRuns: routine.active ? [routine.trigger.nextRunAt] : [],
            steps: steps.filter((step) => step.runId === recentRuns[0]?.id),
          };
        }),
        links: links.filter((link) => routines.some((routine) => routine.id === link.routineId)),
        positions: [...placed.entries()].map(([nodeKey, point]) => ({ nodeKey, ...point })),
        placedAgentIds: [...placed.keys()].flatMap((key) =>
          key.startsWith("agent:") ? [key.slice("agent:".length)] : [],
        ),
      });
    },
    savePosition: async (input) => {
      const placed = positions.get(input.agentId) ?? new Map();
      placed.set(input.nodeKey, { x: input.x, y: input.y });
      positions.set(input.agentId, placed);
    },
    removePosition: async (input) => {
      positions.get(input.agentId)?.delete(input.nodeKey);
      changed([input.agentId]);
    },
    connect: async (input) => {
      const routineOwner = owner(input.routineId);
      if (!routineOwner) throw new Error("This routine no longer exists.");
      if (input.fromAgentId === input.toAgentId) throw new Error("An agent cannot hand work to itself.");
      if (input.toAgentId === routineOwner)
        throw new Error("The routine starts with its own agent, so that agent cannot take work from another one.");
      if (
        links.some(
          (link) =>
            link.routineId === input.routineId &&
            link.fromAgentId === input.fromAgentId &&
            link.toAgentId === input.toAgentId,
        )
      )
        throw new Error("These agents are already connected in this routine.");
      const link: RoutineFlowLink = {
        id: crypto.randomUUID(),
        routineId: input.routineId,
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        instruction: input.instruction ?? "",
        createdAt: new Date().toISOString(),
      };
      links.push(link);
      changed([routineOwner, input.fromAgentId, input.toAgentId]);
      return structuredClone(link);
    },
    updateLink: async (input) => {
      const link = links.find((candidate) => candidate.id === input.linkId);
      if (!link) throw new Error("This connection no longer exists.");
      link.instruction = input.instruction.trim();
      changed([owner(link.routineId) ?? link.fromAgentId, link.fromAgentId, link.toAgentId]);
      return structuredClone(link);
    },
    disconnect: async (input) => {
      const index = links.findIndex((link) => link.id === input.linkId);
      if (index < 0) throw new Error("This connection no longer exists.");
      const [removed] = links.splice(index, 1);
      if (removed) changed([owner(removed.routineId) ?? removed.fromAgentId, removed.fromAgentId, removed.toAgentId]);
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
