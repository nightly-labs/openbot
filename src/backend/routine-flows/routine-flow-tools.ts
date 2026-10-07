/**
 * The `openbot` tools that let an agent read and change routine flows, as the canvas does. A
 * request the model can correct, such as a cycle or an unknown agent, is a tool failure it reads;
 * other errors are faults.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Effect } from "effect";
import { z } from "zod";
import { openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import { ToolOperationFailed, toolStep } from "../agent/tool-operation";
import { RoutineFlowError } from "./routine-flow-store";
import type { RoutineFlowsShape } from "./routine-flows";

const identifier = z.string().min(1).max(INPUT_LIMITS.identifier);
const listSchema = z.object({ agentId: identifier.optional() }).strict();
const connectSchema = z
  .object({
    routineId: identifier,
    fromAgentId: identifier,
    toAgentId: identifier,
    instruction: z.string().max(INPUT_LIMITS.routineInstruction).optional(),
  })
  .strict();
const disconnectSchema = z.object({ linkId: identifier }).strict();

export type RoutineFlowTools = Pick<RoutineFlowsShape, "canvas" | "connect" | "disconnect">;

export const ROUTINE_FLOW_TOOL_DEFINITIONS = [
  {
    name: "list_routine_flows",
    description:
      "List the routines on an agent's routine canvas, yours when you omit agentId, and the links of each routine. A link hands one agent's answer in a routine run to the next agent.",
    shape: listSchema.shape,
  },
  {
    name: "connect_routine_agents",
    description:
      "Add a link to a routine flow: after fromAgentId answers in a run of routineId, its answer goes to toAgentId with the optional instruction. fromAgentId must be the routine's own agent or an agent the flow already reaches. The link applies to runs that start after it is made.",
    shape: connectSchema.shape,
  },
  {
    name: "disconnect_routine_agents",
    description:
      "Remove one link from a routine flow by its linkId from list_routine_flows. Links that only this link kept in the flow are removed too.",
    shape: disconnectSchema.shape,
  },
] as const;

const NAMES = new Set<string>(ROUTINE_FLOW_TOOL_DEFINITIONS.map((tool) => tool.name));

export const handleRoutineFlowTool = Effect.fn("RoutineFlowTools.handle")(function* (
  tool: string,
  args: unknown,
  senderAgentId: string,
  flows: RoutineFlowTools | null,
  agentIds: ReadonlySet<string>,
) {
  if (!NAMES.has(tool)) return null;
  if (!flows) return yield* new ToolOperationFailed({ cause: new Error("Routine flows are unavailable.") });
  const unknownAgent = (ids: readonly string[]) => ids.find((id) => !agentIds.has(id));
  const operation = Effect.gen(function* () {
    if (tool === "list_routine_flows") {
      const input = yield* toolStep(() => listSchema.parse(args ?? {}));
      const agentId = input.agentId ?? senderAgentId;
      if (unknownAgent([agentId])) return openBotToolFailure(`Unknown agent: ${agentId}.`);
      const canvas = yield* flows.canvas(agentId);
      return openBotToolResult({
        routines: canvas.routines.map(({ routine }) => ({
          routineId: routine.id,
          name: routine.name,
          agentId: routine.agentId,
          active: routine.active,
        })),
        links: canvas.links.map((link) => ({
          linkId: link.id,
          routineId: link.routineId,
          fromAgentId: link.fromAgentId,
          toAgentId: link.toAgentId,
          instruction: link.instruction,
        })),
      });
    }
    if (tool === "connect_routine_agents") {
      const input = yield* toolStep(() => connectSchema.parse(args));
      const unknown = unknownAgent([input.fromAgentId, input.toAgentId]);
      if (unknown) return openBotToolFailure(`Unknown agent: ${unknown}.`);
      const link = yield* flows.connect(input);
      return openBotToolResult({ linkId: link.id });
    }
    const input = yield* toolStep(() => disconnectSchema.parse(args));
    yield* flows.disconnect(input);
    return openBotToolResult({ removed: input.linkId });
  });
  return yield* operation.pipe(
    Effect.catchTag("RoutineFlowFailed", (failure) =>
      failure.cause instanceof RoutineFlowError
        ? Effect.succeed(openBotToolFailure(failure.cause.message))
        : Effect.fail(new ToolOperationFailed({ cause: failure.cause })),
    ),
  );
});
