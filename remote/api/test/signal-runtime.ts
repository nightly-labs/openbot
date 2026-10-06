import { type Effect, ManagedRuntime } from "effect";
import { afterEach } from "vitest";
import type { SignalService, SignalTokens } from "../src/signal-service";

const runtimes = new Map<SignalService, ManagedRuntime.ManagedRuntime<SignalTokens, never>>();

export function signalRuntime(service: SignalService) {
  let runtime = runtimes.get(service);
  if (!runtime) {
    runtime = ManagedRuntime.make(service.dependencies);
    runtimes.set(service, runtime);
  }
  return runtime;
}

export function runSignal<A, E>(
  service: SignalService,
  operation: Effect.Effect<A, E, SignalTokens>,
  signal?: AbortSignal,
) {
  return signalRuntime(service).runPromise(operation, { signal });
}

afterEach(async () => {
  for (const [service, runtime] of runtimes) {
    await runtime.dispose();
    service.close();
  }
  runtimes.clear();
});
