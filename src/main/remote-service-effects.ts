import { Context, Effect, Layer, Result, Schema } from "effect";
import type { ResponseDecoder } from "./remote-host-decoding";
import type { RemoteRequestFn, RemoteRequestInit } from "./remote-server-client";

export class RemoteWorkflowError extends Schema.TaggedError<RemoteWorkflowError>()("RemoteWorkflowError", {
  cause: Schema.Defect(),
}) {}
export const remoteCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => new RemoteWorkflowError({ cause }) });
export const remoteDecode = <A>(operation: () => A) =>
  Effect.try({ try: operation, catch: (cause) => new RemoteWorkflowError({ cause }) });
export async function runRemoteWorkflow<A>(operation: Effect.Effect<A, RemoteWorkflowError>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}

export class RemoteRequest extends Context.Service<
  RemoteRequest,
  {
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  }
>()("openbot/main/RemoteRequest") {
  static layer(request: RemoteRequestFn) {
    return Layer.succeed(
      RemoteRequest,
      RemoteRequest.of({
        request,
      }),
    );
  }
}
