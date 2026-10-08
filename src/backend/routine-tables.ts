import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { sourceText } from "@openbot/i18n/source";
import type { RoutineTables } from "./routine-store";

/**
 * The tables of each routine owner. They live apart from the stores so that the webhook routes,
 * which read both owners, can import them without an import cycle.
 */
export const ROUTINE_TABLES = {
  agent: {
    ownerKind: "agent",
    routineTable: "projection_agent_routines",
    triggerTable: "projection_routine_triggers",
    webhookTable: "projection_routine_webhooks",
    runTable: "projection_routine_runs",
    ownerColumn: "agent_id",
    handleColumn: "delivery_id",
    routineAggregate: "agent-routine",
    runAggregate: "routine-run",
    commandPrefix: "routine",
    eventPrefix: "routine",
    limit: INPUT_LIMITS.agentRoutines,
    limitMessage: sourceText("error.backend.agentRoutineLimit", { limit: INPUT_LIMITS.agentRoutines }),
  },
  channel: {
    ownerKind: "channel",
    routineTable: "projection_channel_routines",
    triggerTable: "projection_channel_routine_triggers",
    webhookTable: "projection_channel_routine_webhooks",
    runTable: "projection_channel_routine_runs",
    ownerColumn: "channel_id",
    handleColumn: "request_message_id",
    routineAggregate: "channel-routine",
    runAggregate: "channel-routine-run",
    commandPrefix: "channel-routine",
    eventPrefix: "channel-routine",
    limit: INPUT_LIMITS.agentRoutines,
    limitMessage: sourceText("error.backend.channelRoutineLimit", { limit: INPUT_LIMITS.agentRoutines }),
  },
} satisfies { [Kind in RoutineTables["ownerKind"]]: RoutineTables & { ownerKind: Kind } };
