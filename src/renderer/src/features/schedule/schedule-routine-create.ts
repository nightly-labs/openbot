import type { ServerSummary } from "@openbot/contracts/ipc";
import type {
  RoutineCalendarCreate,
  RoutineCalendarNewRoutine,
} from "@openbot/ui/features/conversation/RoutineCalendarCreateCard";
import { desktopAnalytics } from "../../analytics";
import type { ConversationRuntime } from "../conversation/conversation-runtime";
import { trackRoutineAction } from "../conversation/routine-analytics";
import { desktopChatEventRoutinesApi } from "../conversation/routine-webhooks-api";
import {
  type AgentRoutinesApi,
  agentRoutinesPort,
  eventRoutinesPort,
  type RoutinesPort,
} from "../conversation/routines-port";
import { hostedUpsellRoutineCreated } from "../servers/hosted-server-upsell-controller";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";

/** The agent routine calls of one desktop server. The schedule page can show a server that is not the active one. */
function desktopAgentRoutinesApi(serverId: string): AgentRoutinesApi {
  const agent = window.openbot.agent;
  return {
    listRoutines: (agentId) => agent.listRoutines(agentId, serverId),
    listRoutineRuns: (input) => agent.listRoutineRuns(input, serverId),
    createRoutine: (input) => agent.createRoutine(input, serverId),
    updateRoutine: (input) => agent.updateRoutine(input, serverId),
    deleteRoutine: (input) => agent.deleteRoutine(input, serverId),
    testRoutine: (input) => agent.testRoutine(input, serverId),
    onEvent: agent.onEvent,
  };
}

/**
 * The routines of each agent of a server, as the routine editor of the agent saves them. The web
 * client gives its runtime. On a joined server only an owner or an admin gets a port: the host
 * keeps routine changes to a member who manages the agent, so other members see no create action.
 */
export function scheduleRoutinePorts(
  server: ServerSummary | undefined,
  runtime: ConversationRuntime | undefined,
): ((agentId: string) => RoutinesPort) | undefined {
  if (!server || !serverRoleCanAdminister(server)) return undefined;
  const api = runtime ? runtime.routines : desktopAgentRoutinesApi(server.id);
  if (!api) return undefined;
  const localHost = server.kind === "local";
  const remote = server.kind === "remote";
  const runPlace = localHost || (remote && serverSupportsCapability(server, "routine-run-place-v1"));
  const once = localHost || (remote && serverSupportsCapability(server, "routines-once-v1"));
  const eventApi = runtime ? runtime.admin?.eventRoutines : desktopChatEventRoutinesApi(server, undefined);
  return (agentId) => {
    const legacy = agentRoutinesPort(agentId, undefined, localHost, api, runPlace, undefined, once);
    return eventApi ? eventRoutinesPort({ kind: "agent", id: agentId }, eventApi, legacy) : legacy;
  };
}

/**
 * The create action of the calendar: the same save, policies and reports as the routine editor.
 * `saved` refreshes the calendar. `placeFailed` tells the person that the host kept the routine
 * but not its place.
 */
export function scheduleRoutineCreate(
  ports: (agentId: string) => RoutinesPort,
  saved: () => void,
  placeFailed: () => void,
): RoutineCalendarCreate {
  // The fields depend on the host, not on the agent.
  const sample = ports("");
  return {
    fields: {
      onceSchedule: sample.onceSchedule,
      limitPolicy: sample.limitPolicy,
      missedPolicy: sample.missedPolicy,
      runIn: sample.runIn,
    },
    save: async (routine: RoutineCalendarNewRoutine) => {
      const port = ports(routine.agentId);
      const startedAt = performance.now();
      const analytics = desktopAnalytics.scope();
      const tracked: Parameters<typeof trackRoutineAction>[2] = { triggerKind: "schedule", schedule: routine.schedule };
      try {
        const result = await port.save({
          routineId: null,
          name: routine.name,
          instruction: routine.instruction,
          active: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          schedule: routine.schedule,
          trigger: { kind: "schedule", schedule: routine.schedule },
          ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
          ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
          // As in the editor: only a place other than the chat goes, on a route of its own on a remote host.
          ...(port.runIn && routine.runIn ? { runIn: routine.runIn } : {}),
        });
        trackRoutineAction(analytics, "create", tracked, startedAt, "succeeded");
        hostedUpsellRoutineCreated({ id: result.routine.id, name: result.routine.name, agentId: null });
        // A remote answer leaves out the place that the host kept.
        const place = result.routine.runIn ?? routine.runIn ?? "chat";
        if (port.runIn && place !== (routine.runIn ?? "chat")) placeFailed();
        saved();
      } catch (caught) {
        trackRoutineAction(analytics, "create", tracked, startedAt, "failed", caught);
        throw caught;
      }
    },
  };
}
