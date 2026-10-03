import { Effect, Result, Schema } from "effect";

/** Preserves provider SDK failures at the existing Promise interfaces. */
export class McpOperationError extends Schema.TaggedError<McpOperationError>()("McpOperationError", {
  cause: Schema.Defect(),
}) {}

export function mcpFailure(cause: unknown): McpOperationError {
  return cause instanceof McpOperationError ? cause : new McpOperationError({ cause });
}
export function mcpCall<A>(operation: () => A | Promise<A>): Effect.Effect<A, McpOperationError> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: mcpFailure });
}
export const mcpSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: mcpFailure });

export async function runMcpEffect<A>(operation: Effect.Effect<A, McpOperationError>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}

/** Lets a native catch keep loop control and inspect the original operational error. */
export function mcpResult<A>(result: Result.Result<A, McpOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}
