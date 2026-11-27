import { isReleasedRoutineSchedule } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseCreateRoutine, parseListRoutineRuns, parseUpdateRoutine } from "../ipc/agent-inputs";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { AgentRouteTarget, RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pathIdentifier, readJson, requireReleasedSchedule } from "./request-helpers";

export interface AgentRoutineRouteDependencies {
  agents: Pick<
    TeamApiAgents,
    "listRoutines" | "createRoutine" | "updateRoutine" | "deleteRoutine" | "testRoutine" | "listRoutineRuns"
  >;
}

export async function routeAgentRoutines(
  context: TeamApiRequestContext,
  { agentId, action }: AgentRouteTarget,
  { agents }: AgentRoutineRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, json, empty } = context;

  if (action === "routines") {
    if (method === "GET") {
      return json(200, agents.listRoutines(agentId).filter(isReleasedRoutine));
    }
    if (method === "POST") {
      const body = await readJson(request);
      const input = parseCreateRoutine({ ...body, agentId });
      requireReleasedSchedule(input.schedule);
      return json(201, agents.createRoutine(input));
    }
  }
  const routineMatch = action.match(/^routines\/([^/]+)(?:\/(test|runs))?$/);
  if (routineMatch) {
    const routineId = pathIdentifier(routineMatch[1], "routineId");
    const routineAction = routineMatch[2] ?? "";
    if (method === "PATCH" && !routineAction) {
      const body = await readJson(request);
      if (agents.listRoutines(agentId).some((routine) => routine.id === routineId && !isReleasedRoutine(routine))) {
        throw new HttpError(404, sourceText("error.backend.routineGone"));
      }
      const input = parseUpdateRoutine({ ...body, agentId, routineId });
      requireReleasedSchedule(input.schedule);
      return json(200, agents.updateRoutine(input));
    }
    if (method === "DELETE" && !routineAction) {
      await runCauseEffect(agents.deleteRoutine({ agentId, routineId }));
      return empty(204);
    }
    if (method === "POST" && routineAction === "test") {
      return json(201, await runCauseEffect(agents.testRoutine({ agentId, routineId })));
    }
    if (method === "GET" && routineAction === "runs") {
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      return json(200, agents.listRoutineRuns(parseListRoutineRuns({ agentId, routineId, limit })));
    }
  }

  return "unmatched";
}

export function isReleasedRoutine(routine: { trigger: { schedule: unknown } }): boolean {
  return isReleasedRoutineSchedule(routine.trigger.schedule);
}
