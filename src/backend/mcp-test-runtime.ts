import { Effect, Result } from "effect";
import { McpOperationError } from "./mcp-effects";
import { McpProbeFailure } from "./mcp-probe";
import { McpShapeFailed } from "./mcp-provider-shapes";

export async function runMcp<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) return result.success;
  const failure = result.failure;
  throw failure instanceof McpOperationError || failure instanceof McpShapeFailed || failure instanceof McpProbeFailure
    ? failure.cause
    : failure;
}
