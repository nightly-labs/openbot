import type { RoutineFlowCanvas, RoutineFlowStep } from "@openbot/contracts/ipc";
import {
  ROUTINE_FLOW_STEP_TEXT_LIMIT,
  ROUTINE_FLOWS_CAPABILITY,
  ROUTINE_FLOWS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-flows-v1";
import { TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import { RoutineFlowError } from "../../backend/routine-flows/routine-flow-store";
import {
  parseConnectRoutineFlow,
  parseDisconnectRoutineFlow,
  parseRemoveRoutineFlowPosition,
  parseSaveRoutineFlowPosition,
  parseUpdateRoutineFlowLink,
} from "../ipc/routine-flow-inputs";
import type { TeamApiAgents, TeamApiRoutineFlows } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, stringField } from "./request-helpers";

const ROUTINE_FLOW_PATHS = new Set<string>(Object.values(ROUTINE_FLOWS_ROUTES));
/** A canvas leaves room in one WebRTC frame for the response envelope around it. */
const CANVAS_BYTE_BUDGET = Math.floor(TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES * 0.75);

function agentNotFound(): never {
  throw new HttpError(404, sourceText("error.team.agentNotFound"));
}

/** The wire codec has already checked the body, so only a malformed payload fails here, in English. */
function parse<A>(decode: (value: unknown) => A, body: unknown): A {
  try {
    return decode(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid routine flow request.");
  }
}

/** A flow refused by the store, such as a cycle, is the member's sentence. Anything else is a host fault. */
async function run<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  try {
    return await runCauseEffect(operation);
  } catch (error) {
    if (error instanceof RoutineFlowError) throw new HttpError(400, error.message);
    throw error;
  }
}

function clip(text: string): string {
  return text.length > ROUTINE_FLOW_STEP_TEXT_LIMIT ? text.slice(0, ROUTINE_FLOW_STEP_TEXT_LIMIT) : text;
}

function clipStep(step: RoutineFlowStep): RoutineFlowStep {
  return {
    ...step,
    input: clip(step.input),
    output: step.output === null ? null : clip(step.output),
    error: step.error === null ? null : clip(step.error),
  };
}

/**
 * The canvas a member may read: no routine that touches a hidden agent, and no webhook URL unless
 * the member administers the server. Step texts are clipped, and emptied from the routines with the
 * oldest runs first while the canvas would not fit one WebRTC frame; then the older runs' texts.
 */
function memberCanvas(canvas: RoutineFlowCanvas, hidden: ReadonlySet<string>, admin: boolean): RoutineFlowCanvas {
  const visibleRoutineIds = new Set(
    canvas.routines
      .filter(
        ({ routine }) =>
          !hidden.has(routine.agentId) &&
          canvas.links.every(
            (link) => link.routineId !== routine.id || (!hidden.has(link.fromAgentId) && !hidden.has(link.toAgentId)),
          ),
      )
      .map(({ routine }) => routine.id),
  );
  const result: RoutineFlowCanvas = {
    agentId: canvas.agentId,
    routines: canvas.routines
      .filter(({ routine }) => visibleRoutineIds.has(routine.id))
      .map((flow) => ({
        ...flow,
        routine:
          flow.routine.trigger.kind === "webhook" && !admin
            ? { ...flow.routine, trigger: { ...flow.routine.trigger, url: null } }
            : flow.routine,
        steps: flow.steps.map(clipStep),
      })),
    links: canvas.links.filter((link) => visibleRoutineIds.has(link.routineId)),
    positions: canvas.positions.filter((position) => !hidden.has(nodeAgentId(position.nodeKey) ?? "")),
    placedAgentIds: canvas.placedAgentIds.filter((agentId) => !hidden.has(agentId)),
  };
  const oldestFirst = [...result.routines].sort((left, right) =>
    (left.recentRuns[0]?.createdAt ?? "").localeCompare(right.recentRuns[0]?.createdAt ?? ""),
  );
  let bytes = Buffer.byteLength(JSON.stringify(result));
  for (const flow of oldestFirst) {
    if (bytes <= CANVAS_BYTE_BUDGET) break;
    const before = Buffer.byteLength(JSON.stringify(flow.steps));
    flow.steps = flow.steps.map((step) => ({ ...step, input: "", output: null, error: null }));
    bytes -= before - Buffer.byteLength(JSON.stringify(flow.steps));
  }
  // The run history shows only a run's status and times, and only the newest run shows its
  // instruction, so the older runs give up their texts next.
  for (const flow of oldestFirst) {
    if (bytes <= CANVAS_BYTE_BUDGET) break;
    const before = Buffer.byteLength(JSON.stringify(flow.recentRuns));
    flow.recentRuns = flow.recentRuns.map((run, index) =>
      index === 0 ? run : { ...run, instruction: "", error: null },
    );
    bytes -= before - Buffer.byteLength(JSON.stringify(flow.recentRuns));
  }
  // The routines and links themselves cannot be cut: a canvas that still does not fit is refused.
  if (bytes > CANVAS_BYTE_BUDGET) throw new HttpError(413, sourceText("error.team.routineCanvasTooLarge"));
  return result;
}

function nodeAgentId(nodeKey: string): string | null {
  return nodeKey.startsWith("agent:") ? nodeKey.slice("agent:".length) : null;
}

/**
 * The routine canvas of an agent, its node positions, and the links that hand a routine's answer on.
 * Any member can use them for the agents the member can see; every agent, routine or link that a
 * request names, or that a flow touches, is checked against the agents hidden from the caller, and a
 * hidden one answers as missing. Frozen by `routine-flows-v1`.
 */
export async function routeRoutineFlows(
  context: TeamApiRequestContext,
  routineFlows: TeamApiRoutineFlows | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || !ROUTINE_FLOW_PATHS.has(path)) return "unmatched";
  if (!routineFlows || !capabilities.has(ROUTINE_FLOWS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineFlowsUnsupported"));
  // `readJson` has already run the body through the routine-flows wire codec.
  const body = await readJson(request);
  const visible = (agentId: string) =>
    !hiddenAgentIds.has(agentId) && agents.listAgents().some((agent) => agent.id === agentId);
  const requireVisible = (...agentIds: string[]) => {
    if (!agentIds.every(visible)) agentNotFound();
  };
  const requireVisibleFlow = async (ref: { routineId: string } | { linkId: string }) => {
    const touched = await run(routineFlows.agentsOf(ref));
    if (!touched?.every((agentId) => !hiddenAgentIds.has(agentId))) agentNotFound();
  };
  switch (path) {
    case ROUTINE_FLOWS_ROUTES.canvas: {
      const agentId = stringField(body, "agentId");
      requireVisible(agentId);
      const canvas = await run(routineFlows.canvas(agentId));
      return json(200, memberCanvas(canvas, hiddenAgentIds, member.role !== "member"));
    }
    case ROUTINE_FLOWS_ROUTES.savePosition: {
      const input = parse(parseSaveRoutineFlowPosition, body);
      requireVisible(input.agentId, ...nodeAgentIds(input.nodeKey));
      await run(routineFlows.savePosition(input));
      return json(200, {});
    }
    case ROUTINE_FLOWS_ROUTES.removePosition: {
      const input = parse(parseRemoveRoutineFlowPosition, body);
      requireVisible(input.agentId, ...nodeAgentIds(input.nodeKey));
      await run(routineFlows.removePosition(input));
      return json(200, {});
    }
    case ROUTINE_FLOWS_ROUTES.connect: {
      const input = parse(parseConnectRoutineFlow, body);
      requireVisible(input.fromAgentId, input.toAgentId);
      await requireVisibleFlow({ routineId: input.routineId });
      return json(200, await run(routineFlows.connect(input)));
    }
    case ROUTINE_FLOWS_ROUTES.disconnect: {
      const input = parse(parseDisconnectRoutineFlow, body);
      await requireVisibleFlow({ linkId: input.linkId });
      await run(routineFlows.disconnect(input));
      return json(200, {});
    }
    case ROUTINE_FLOWS_ROUTES.updateLink: {
      const input = parse(parseUpdateRoutineFlowLink, body);
      await requireVisibleFlow({ linkId: input.linkId });
      return json(200, await run(routineFlows.updateLink(input)));
    }
  }
  return "unmatched";
}

function nodeAgentIds(nodeKey: string): string[] {
  const agentId = nodeAgentId(nodeKey);
  return agentId ? [agentId] : [];
}
