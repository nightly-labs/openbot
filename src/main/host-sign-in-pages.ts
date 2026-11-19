import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Duration, Effect, Exit, Fiber, Scope } from "effect";
import type { BrowserHost } from "../backend/browser-host";
import { runCauseEffect } from "../backend/effect-boundary";

const logger = createOpenBotLogger("host-sign-in-pages");

const RESULT_KEPT_MS = 60_000;

export interface HostSignInPage<R> {
  tabId: string | null;
  result: R | null;
}

export type HostSignInPageMode = "tab" | "relay";

interface HostSignIn<R> extends HostSignInPage<R> {
  mode: HostSignInPageMode;
  pageUrl: string | null;
  run?: Fiber.Fiber<unknown, unknown>;
}

export class HostSignInPages<K, R> {
  readonly #browser: Pick<BrowserHost, "openPrivate" | "privateTab" | "close">;
  readonly #signIns = new Map<K, HostSignIn<R>>();
  readonly #scope = Scope.makeUnsafe();

  constructor(browser: Pick<BrowserHost, "openPrivate" | "privateTab" | "close">) {
    this.#browser = browser;
  }

  readonly start = Effect.fn("HostSignInPages.start")(function* <A, E>(
    this: HostSignInPages<K, R>,
    key: K,
    run: (openPage: (url: string) => Promise<void>) => Effect.Effect<A, E>,
    resultOf: (exit: Exit.Exit<A, E>) => R,
    mode: HostSignInPageMode = "tab",
  ) {
    const signIn: HostSignIn<R> = { mode, tabId: null, pageUrl: null, result: null };
    this.#signIns.set(key, signIn);
    const fiber = yield* Effect.forkIn(
      run((url) => runCauseEffect(this.#show(key, signIn, url))),
      this.#scope,
      { startImmediately: true },
    );
    signIn.run = fiber;
    yield* Effect.forkIn(
      Fiber.await(fiber).pipe(Effect.flatMap((exit) => this.#finish(key, signIn, resultOf(exit)))),
      this.#scope,
    );
  });

  pageUrl(key: K): string | null {
    const signIn = this.#signIns.get(key);
    return signIn?.mode === "relay" && signIn.result === null ? signIn.pageUrl : null;
  }

  status(key: K): HostSignInPage<R> | undefined {
    const signIn = this.#signIns.get(key);
    if (!signIn) return undefined;
    return { tabId: signIn.tabId && this.#browser.privateTab(signIn.tabId), result: signIn.result };
  }

  readonly interrupt = Effect.fn("HostSignInPages.interrupt")(function* (this: HostSignInPages<K, R>, key: K) {
    const run = this.#signIns.get(key)?.run;
    if (run) yield* Fiber.interrupt(run);
  });

  readonly close = Effect.fn("HostSignInPages.close")(function* (this: HostSignInPages<K, R>) {
    yield* Scope.close(this.#scope, Exit.void);
  });

  readonly #show = Effect.fn("HostSignInPages.show")(function* (
    this: HostSignInPages<K, R>,
    key: K,
    signIn: HostSignIn<R>,
    url: string,
  ) {
    if (signIn.mode === "relay") {
      signIn.pageUrl = url;
      return;
    }
    const tab = yield* this.#browser.openPrivate(url);
    if (this.#signIns.get(key) === signIn && signIn.result === null) {
      signIn.tabId = tab.id;
      return;
    }
    yield* this.#closeTab(tab.id);
  });

  readonly #finish = Effect.fn("HostSignInPages.finish")(function* (
    this: HostSignInPages<K, R>,
    key: K,
    signIn: HostSignIn<R>,
    result: R,
  ) {
    signIn.result = result;
    const tabId = signIn.tabId;
    signIn.tabId = null;
    if (tabId) yield* this.#closeTab(tabId);
    yield* Effect.sleep(Duration.millis(RESULT_KEPT_MS));
    if (this.#signIns.get(key) === signIn) this.#signIns.delete(key);
  });

  #closeTab(tabId: string) {
    return this.#browser
      .close(tabId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("Unable to close a sign-in tab", { error: toLogValue(error) })),
        ),
      );
  }
}
