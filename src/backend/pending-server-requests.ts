import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { AppServerRequest, RequestId, RpcError } from "./protocol";
import { ProviderClientOperationError } from "./provider-client-effects";

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class PendingServerRequests {
  readonly #send: (request: AppServerRequest) => void;
  readonly #pending = new Map<RequestId, PendingServerRequest>();

  constructor(send: (request: AppServerRequest) => void) {
    this.#send = send;
  }

  readonly call = Effect.fn("PendingServerRequests.call")(function* (
    this: PendingServerRequests,
    method: string,
    params: unknown,
    signal?: AbortSignal,
    detachAfterMs?: number,
    answerBeforeMs?: number,
    subagent = false,
  ) {
    const id = randomUUID();
    return yield* Effect.callback<unknown, ProviderClientOperationError>((resume) => {
      const controller = new AbortController();
      const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      if (requestSignal.aborted) {
        resume(
          Effect.fail(new ProviderClientOperationError({ cause: new Error("The provider cancelled the request.") })),
        );
        return;
      }
      const abandon = () => this.reject(id, { code: -32800, message: "The provider cancelled the request." });
      requestSignal.addEventListener("abort", abandon, { once: true });
      this.#pending.set(id, {
        resolve: (value) => resume(Effect.succeed(value)),
        reject: (cause) => resume(Effect.fail(new ProviderClientOperationError({ cause }))),
      });
      try {
        this.#send({
          id,
          method,
          params,
          signal: requestSignal,
          ...(detachAfterMs === undefined ? {} : { detachAfterMs }),
          ...(answerBeforeMs === undefined ? {} : { answerBeforeMs }),
          ...(subagent ? { subagent: true as const } : {}),
        });
      } catch (cause) {
        resume(Effect.fail(new ProviderClientOperationError({ cause })));
      }
      return Effect.sync(() => {
        this.#pending.delete(id);
        requestSignal.removeEventListener("abort", abandon);
        controller.abort();
      });
    });
  });

  resolve(id: RequestId, result: unknown): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.resolve(result);
  }

  reject(id: RequestId, error: RpcError): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.reject(new Error(error.message));
  }

  rejectAll(message: string): void {
    for (const pending of this.#pending.values()) pending.reject(new Error(message));
    this.#pending.clear();
  }
}
