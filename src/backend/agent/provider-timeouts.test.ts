import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import type { AgentProvider } from "../agent-client";
import { ProviderClientOperationError } from "../provider-client-effects";
import { NO_PROVIDER_CREDENTIALS } from "../provider-drivers";
import { ModelCatalog, type ModelCatalogClient } from "./model-catalog";
import { PROVIDER_FAST_TIMEOUT_MS, providerAccountReadTimeoutMs, readProviderAccount } from "./provider-request-policy";

const REQUEST_TIMEOUT_MS = 30_000;
const SLOW_DELAY = "8 seconds";

interface FakeCall {
  readonly method: string;
  readonly timeoutMs: number | undefined;
}

/** A client whose every answer arrives after `SLOW_DELAY`, with the timeout its caller gave it. */
function slowClient(provider: AgentProvider, calls: FakeCall[]): ModelCatalogClient {
  return {
    provider,
    request<T>(
      method: string,
      _params: unknown,
      decoder: (value: unknown) => T,
      timeoutMs?: number,
    ): Effect.Effect<T, ProviderClientOperationError> {
      calls.push({ method, timeoutMs });
      const response =
        method === "model/list"
          ? { data: [{ model: "gpt-5.6" }] }
          : { account: { type: "chatgpt", email: "slow@example.com" }, requiresOpenaiAuth: false };
      return Effect.sleep(SLOW_DELAY).pipe(
        Effect.as(decoder(response)),
        Effect.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS),
        Effect.mapError((error) => new ProviderClientOperationError({ cause: error })),
      );
    },
  };
}

/** Runs an effect on the test clock, letting an 8 s answer and its timeout decide the result. */
async function runPastSlowDelay<A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> {
  const program = Effect.gen(function* () {
    const fiber = yield* effect.pipe(Effect.forkChild);
    yield* TestClock.adjust("10 seconds");
    return yield* Fiber.await(fiber);
  });
  return Effect.runPromise(Effect.provide(program, TestClock.layer()));
}

describe("providerAccountReadTimeoutMs", () => {
  it("gives Codex the full request timeout", () => {
    expect(providerAccountReadTimeoutMs("codex", REQUEST_TIMEOUT_MS)).toBe(REQUEST_TIMEOUT_MS);
  });

  it("keeps every other provider on the 5 s fast-fail wait", () => {
    expect(providerAccountReadTimeoutMs("claude", REQUEST_TIMEOUT_MS)).toBe(PROVIDER_FAST_TIMEOUT_MS);
    expect(providerAccountReadTimeoutMs("cursor", REQUEST_TIMEOUT_MS)).toBe(PROVIDER_FAST_TIMEOUT_MS);
  });
});

describe("readProviderAccount", () => {
  it("reads the Codex account after an 8 s delay", async () => {
    const calls: FakeCall[] = [];
    const exit = await runPastSlowDelay(
      readProviderAccount(slowClient("codex", calls), "codex", false, REQUEST_TIMEOUT_MS),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.account?.type).toBe("chatgpt");
    expect(calls).toEqual([{ method: "account/read", timeoutMs: REQUEST_TIMEOUT_MS }]);
  });

  it("still times out another provider's account read at 5 s", async () => {
    const calls: FakeCall[] = [];
    const exit = await runPastSlowDelay(
      readProviderAccount(slowClient("claude", calls), "claude", false, REQUEST_TIMEOUT_MS),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls).toEqual([{ method: "account/read", timeoutMs: PROVIDER_FAST_TIMEOUT_MS }]);
  });
});

describe("ModelCatalog", () => {
  it("waits out an 8 s Codex model list", async () => {
    const calls: FakeCall[] = [];
    const client = slowClient("codex", calls);
    const catalog = new ModelCatalog({
      client: (provider) => (provider === "codex" ? client : undefined),
      isSignedOut: () => false,
      credentials: NO_PROVIDER_CREDENTIALS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      recordProviderError: () => {},
    });

    const exit = await runPastSlowDelay(catalog.refresh());

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.has("codex")).toBe(true);
    expect(calls).toEqual([{ method: "model/list", timeoutMs: REQUEST_TIMEOUT_MS }]);
  });

  it("keeps another provider's model list on the 5 s fast-fail wait", async () => {
    const calls: FakeCall[] = [];
    const errors: unknown[] = [];
    const client = slowClient("claude", calls);
    const catalog = new ModelCatalog({
      client: (provider) => (provider === "claude" ? client : undefined),
      isSignedOut: () => false,
      credentials: NO_PROVIDER_CREDENTIALS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      recordProviderError: (_provider, error) => errors.push(error),
    });

    const exit = await runPastSlowDelay(catalog.refresh());

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.has("claude")).toBe(false);
    expect(errors).toHaveLength(1);
    expect(calls).toEqual([{ method: "model/list", timeoutMs: PROVIDER_FAST_TIMEOUT_MS }]);
  });
});
