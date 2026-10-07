import { Effect, Result, Schema } from "effect";
import { causeHelpers } from "./effect-boundary";

/** Preserves provider SDK failures at the existing Promise interfaces. */
export class McpOperationError extends Schema.TaggedError<McpOperationError>()("McpOperationError", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toMcpOperationError } = causeHelpers(McpOperationError);

export function mcpFailure(cause: unknown): McpOperationError {
  return cause instanceof McpOperationError ? cause : new McpOperationError({ cause });
}
export function mcpCall<A>(operation: () => A | Promise<A>): Effect.Effect<A, McpOperationError> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: mcpFailure });
}
export const mcpSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: mcpFailure });

/** Lets a native catch keep loop control and inspect the original operational error. */
export function mcpResult<A>(result: Result.Result<A, McpOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
