import type { ChildProcess } from "node:child_process";
import type { ProviderCodeLoginStart } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Fiber, Schema, Scope } from "effect";
import type { AgentClient, AgentProvider } from "./../agent-client";
import type { AgentCliInfo } from "./../cli";
import { causeHelpers } from "../effect-boundary";
import type { AccountReadResult } from "./../protocol";
import type { ProviderClientOperationError } from "../provider-client-effects";
import { recordRestartActivity } from "../restart-activity";
import { stopProcessTree } from "../windows-process-tree";
import type { CliCodeLogin, CliCodeLoginFailed } from "./cli-code-login";
import type { ProviderProcessFailed } from "./provider-status";

/** A sign-in that is a CLI process the user completes in a browser the CLI opened, or on another device. */
interface PendingCliLogin {
  /** Absent when the login scope owns the process, as for a Muse host. */
  child?: ChildProcess;
  cli: AgentCliInfo;
  /** True when the sign-in ended with the provider signed in. */
  task: Fiber.Fiber<boolean, CliLoginFailed> | null;
  scope: Scope.Closeable;
  /** A code sign-in: what the CLI printed for the user, and the prompt a pasted code goes to. */
  code?: Pick<CliCodeLogin, "prompt" | "submit">;
}

/** The sign-in process a caller starts, and how it ends. */
export type CliLoginProcess = {
  /** The process to stop on a cancel. Without it, closing the login scope stops the sign-in. */
  child?: ChildProcess;
  done: Effect.Effect<void, ProviderClientOperationError | CliCodeLoginFailed | ProviderProcessFailed>;
} & Partial<Pick<CliCodeLogin, "prompt" | "submit">>;

export interface CliLoginFlowOptions {
  /** The provider runtime's scope, read at each use: a start after a dispose replaces it. */
  scope(): Scope.Scope;
  resolveCli(provider: AgentProvider): Effect.Effect<AgentCliInfo, CliLoginFailed>;
  /** A new client that is started and signed in, but not active. */
  authenticate(
    provider: AgentProvider,
    cli: AgentCliInfo,
  ): Effect.Effect<{ client: AgentClient; account: NonNullable<AccountReadResult["account"]> }, CliLoginFailed>;
  activate(
    provider: AgentProvider,
    client: AgentClient,
    cli: AgentCliInfo,
    account: NonNullable<AccountReadResult["account"]>,
    options: { isCurrent: () => boolean },
  ): Effect.Effect<void, CliLoginFailed>;
  setConnecting(provider: AgentProvider): void;
  clearConnectionState(provider: AgentProvider): void;
  setFailure(provider: AgentProvider, error: unknown, version?: string | null): void;
}

/**
 * Owns the pending CLI sign-ins, at most one for each provider: the sign-in process, the task that
 * waits for it, and the code a code sign-in printed. It never imports the provider runtime, which
 * owns the clients and the status.
 */
export class CliLoginFlow {
  readonly #options: CliLoginFlowOptions;
  readonly #pending = new Map<AgentProvider, PendingCliLogin>();

  constructor(options: CliLoginFlowOptions) {
    this.#options = options;
  }

  get size(): number {
    return this.#pending.size;
  }

  has(provider: AgentProvider): boolean {
    return this.#pending.has(provider);
  }

  readonly start = Effect.fn("CliLogin.start")(function* (
    this: CliLoginFlow,
    provider: AgentProvider,
    start: (
      cli: AgentCliInfo,
    ) => Effect.Effect<
      CliLoginProcess,
      ProviderClientOperationError | CliCodeLoginFailed | CliLoginFailed,
      Scope.Scope
    >,
  ) {
    let cli: AgentCliInfo | null = null;
    this.#options.setConnecting(provider);
    return yield* Effect.gen({ self: this }, function* () {
      const resolved = yield* this.#options.resolveCli(provider);
      cli = resolved;
      const scope = Scope.makeUnsafe();
      const { child, done, prompt, submit } = yield* start(resolved).pipe(
        Effect.provideService(Scope.Scope, scope),
        toCliLoginFailed,
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
      const pending: PendingCliLogin = {
        ...(child ? { child } : {}),
        cli: resolved,
        scope,
        task: null,
        ...(prompt && submit ? { code: { prompt, submit } } : {}),
      };
      this.#pending.set(provider, pending);
      recordRestartActivity();
      // The login outlives the request; dispose/cancel owns the registered child and task.
      pending.task = yield* Effect.forkIn(
        done.pipe(
          toCliLoginFailed,
          Effect.flatMap(() => this.#complete(provider, pending)),
          Effect.catch((failure) => this.#fail(provider, pending, failure.cause).pipe(Effect.as(false))),
          Effect.ensuring(Scope.close(scope, Exit.void)),
        ),
        this.#options.scope(),
      );
    }).pipe(
      Effect.tapError((failure) => Effect.sync(() => this.#options.setFailure(provider, failure.cause, cli?.version))),
    );
  }, Effect.uninterruptible).bind(this);

  /**
   * Starts a sign-in the user finishes on another device, and reports what the CLI printed for it.
   * `start` is the provider's CLI command (`startCliCodeLogin`) or another process with a prompt,
   * and `timeoutMs` is how long that process waits for the user.
   */
  readonly startCode = Effect.fn("CliLogin.startCode")(function* (
    this: CliLoginFlow,
    provider: AgentProvider,
    start: (
      cli: AgentCliInfo,
    ) => Effect.Effect<
      CliLoginProcess,
      ProviderClientOperationError | CliCodeLoginFailed | CliLoginFailed,
      Scope.Scope
    >,
    timeoutMs: number,
  ): Effect.fn.Return<ProviderCodeLoginStart, CliLoginFailed> {
    yield* this.start(provider, start);
    const code = this.#pending.get(provider)?.code;
    if (!code) return yield* new CliLoginFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) });
    const expiresAt = Date.now() + timeoutMs;
    const prompt = yield* code.prompt.pipe(toCliLoginFailed);
    if (prompt === null) return { kind: "connected" };
    if (prompt.flow === "link") return { kind: "link", verificationUrl: prompt.verificationUrl, expiresAt };
    return prompt.flow === "paste"
      ? { kind: "paste", verificationUrl: prompt.verificationUrl, expiresAt }
      : {
          kind: "code",
          userCode: prompt.userCode,
          verificationUrl: prompt.verificationUrl,
          ...(prompt.verificationUrlComplete ? { verificationUrlComplete: prompt.verificationUrlComplete } : {}),
          expiresAt,
        };
  }, Effect.uninterruptible).bind(this);

  /** Types a pasted code into the CLI that waits for it. The code is a credential: it goes nowhere else. */
  submit(provider: AgentProvider, code: string): void {
    const pending = this.#pending.get(provider);
    if (!pending?.code) throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
    pending.code.submit(code);
  }

  readonly cancel = Effect.fn("CliLogin.cancel")(function* (
    this: CliLoginFlow,
    provider: AgentProvider,
    message: string | null,
  ) {
    const pending = this.#pending.get(provider);
    if (!pending) return;
    this.#pending.delete(provider);
    const settle = Effect.gen({ self: this }, function* () {
      yield* Scope.close(pending.scope, Exit.void);
      const task = pending.task;
      // Closing the login scope can interrupt its completion task. Wait for cleanup without
      // propagating that expected interruption into Cancel or the next Connect command.
      if (task) yield* Fiber.await(task);
      if (message) this.#options.setFailure(provider, new Error(message), pending.cli.version);
      else this.#options.clearConnectionState(provider);
    });
    // A stop that fails still ends the sign-in: the row must not stay connecting after it is forgotten.
    yield* (pending.child ? stopProcessTree(pending.child) : Effect.void).pipe(
      toCliLoginFailed,
      Effect.ensuring(settle),
    );
  }, Effect.uninterruptible).bind(this);

  /**
   * Waits until the pending sign-in of `provider` ends, and answers whether it signed the provider
   * in. `null` when no sign-in is pending: it did not start, or it already ended.
   */
  readonly settled = Effect.fn("CliLogin.settled")(function* (this: CliLoginFlow, provider: AgentProvider) {
    const task = this.#pending.get(provider)?.task;
    if (!task) return null;
    const exit = yield* Fiber.await(task);
    return Exit.isSuccess(exit) && exit.value;
  }).bind(this);

  /** Forgets every pending sign-in now, and returns the stop of their processes, which the caller runs. */
  dispose(): Effect.Effect<void> {
    const logins = [...this.#pending.values()];
    this.#pending.clear();
    return Effect.forEach(
      logins,
      (login) =>
        (login.child ? stopProcessTree(login.child).pipe(Effect.ignore) : Effect.void).pipe(
          Effect.andThen(Scope.close(login.scope, Exit.void)),
        ),
      { discard: true },
    );
  }

  readonly #complete = Effect.fn("CliLogin.complete")(function* (
    this: CliLoginFlow,
    provider: AgentProvider,
    pending: PendingCliLogin,
  ) {
    if (this.#pending.get(provider) !== pending) return false;
    return yield* Effect.gen({ self: this }, function* () {
      const candidate = yield* this.#options.authenticate(provider, pending.cli);
      if (this.#pending.get(provider) !== pending) {
        yield* candidate.client.stop().pipe(toCliLoginFailed).pipe(Effect.ignore);
        return false;
      }
      yield* this.#options.activate(provider, candidate.client, pending.cli, candidate.account, {
        isCurrent: () => this.#pending.get(provider) === pending,
      });
      if (this.#pending.get(provider) !== pending) return false;
      this.#pending.delete(provider);
      return true;
    }).pipe(Effect.catch((failure) => this.#fail(provider, pending, failure.cause).pipe(Effect.as(false))));
  }, Effect.uninterruptible);

  readonly #fail = Effect.fn("CliLogin.fail")(function* (
    this: CliLoginFlow,
    provider: AgentProvider,
    pending: PendingCliLogin,
    error: unknown,
  ) {
    if (this.#pending.get(provider) !== pending) return;
    this.#pending.delete(provider);
    yield* (pending.child ? stopProcessTree(pending.child) : Effect.void).pipe(
      toCliLoginFailed,
      Effect.ensuring(Effect.sync(() => this.#options.setFailure(provider, error, pending.cli.version))),
    );
  });
}

export class CliLoginFailed extends Schema.TaggedError<CliLoginFailed>()("CliLoginFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toCliLoginFailed } = causeHelpers(CliLoginFailed);
