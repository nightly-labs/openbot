import { Context, Effect, Layer, Schema } from "effect";

export class CentralAuthOperationError extends Schema.TaggedError<CentralAuthOperationError>()(
  "CentralAuthOperationError",
  {
    cause: Schema.Defect(),
  },
) {}
export const authCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => new CentralAuthOperationError({ cause }) });
export const authDecode = <A>(operation: () => A) =>
  Effect.try({ try: operation, catch: (cause) => new CentralAuthOperationError({ cause }) });

export class CentralAuthTransport extends Context.Service<
  CentralAuthTransport,
  {
    fetch(input: string | URL | Request, init?: RequestInit): Effect.Effect<Response, CentralAuthOperationError>;
  }
>()("openbot/main/CentralAuthTransport") {
  static layer(fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
    return Layer.succeed(
      CentralAuthTransport,
      CentralAuthTransport.of({
        fetch: (input, init) =>
          Effect.tryPromise({
            try: (signal) =>
              fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
            catch: (cause) => new CentralAuthOperationError({ cause }),
          }),
      }),
    );
  }
}
