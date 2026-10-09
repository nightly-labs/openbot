// MCP sign-ins that an administrator starts on this host from another computer (`mcp-sign-in-v1`).

import type {
  McpSignInState,
  McpSignInStatus,
  McpTestResult,
  SignOutMcpServerInput,
  TestMcpServerInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Duration, Effect, Exit, Scope } from "effect";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import { runCauseEffect } from "../backend/effect-boundary";
import { normalizeResource } from "../backend/mcp-oauth-provider";

const logger = createOpenBotLogger("mcp-host-sign-ins");

/** How long a finished sign-in still answers `status`, so the client that polls it reads the end. */
const RESULT_KEPT_MS = 60_000;
/** The bound of an error on the wire, as `mcp-sign-in-v1` reads it. */
const ERROR_LIMIT = 2_000;

/** Changed in place while the sign-in runs; `status` answers a copy. */
type HostSignIn = McpSignInStatus;

export interface McpHostSignInDependencies {
  service: Pick<AgentService, "signInMcpServer" | "cancelMcpSignIn" | "signOutMcpServer" | "listMcpSignIns">;
  browser: Pick<BrowserHost, "openPrivate" | "closePrivate">;
}

/**
 * A sign-in for an administrator who is not at this computer.
 *
 * The grant comes back to this host's loopback listener, and only a browser here can reach it. So the
 * page opens in a private tab of this host's browser, and the administrator signs in through the live
 * view of that tab. `start` returns at once; the client reads `status` until the sign-in ends. One
 * sign-in runs for each server address, as on this computer: a second start replaces the first.
 */
export class McpHostSignIns {
  readonly #dependencies: McpHostSignInDependencies;
  readonly #signIns = new Map<string, HostSignIn>();
  readonly #scope = Scope.makeUnsafe();

  constructor(dependencies: McpHostSignInDependencies) {
    this.#dependencies = dependencies;
  }

  readonly start = Effect.fn("McpHostSignIns.start")(function* (this: McpHostSignIns, input: TestMcpServerInput) {
    const key = signInKey(input.config.url);
    const signIn: HostSignIn = { tabId: null, result: null };
    this.#signIns.set(key, signIn);
    const { service } = this.#dependencies;
    yield* Effect.forkIn(
      service
        .signInMcpServer(input, (url) => runCauseEffect(this.#show(key, signIn, url)))
        .pipe(
          Effect.catch((failure) => Effect.succeed({ toolCount: 0, error: failureText(failure.cause) })),
          Effect.flatMap((result) => this.#finish(key, signIn, result)),
        ),
      this.#scope,
      { startImmediately: true },
    );
  }).bind(this);

  status(url: string): McpSignInStatus {
    const signIn = this.#signIns.get(signInKey(url));
    if (!signIn)
      return { tabId: null, result: { toolCount: 0, error: sourceText("error.backend.mcpSignInAbandonedGeneric") } };
    return { tabId: signIn.tabId, result: signIn.result };
  }

  cancel(url: string): void {
    this.#dependencies.service.cancelMcpSignIn({ url });
  }

  signOut(input: SignOutMcpServerInput) {
    return this.#dependencies.service.signOutMcpServer(input);
  }

  list(): McpSignInState[] {
    return this.#dependencies.service.listMcpSignIns();
  }

  readonly close = Effect.fn("McpHostSignIns.close")(function* (this: McpHostSignIns) {
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);

  /** The page opens; a sign-in that a later one replaced or that already ended closes it again. */
  readonly #show = Effect.fn("McpHostSignIns.show")(function* (
    this: McpHostSignIns,
    key: string,
    signIn: HostSignIn,
    url: string,
  ) {
    const tab = yield* this.#dependencies.browser.openPrivate(url);
    if (this.#signIns.get(key) === signIn && signIn.result === null) {
      signIn.tabId = tab.id;
      return;
    }
    yield* this.#closeTab(tab.id);
  });

  readonly #finish = Effect.fn("McpHostSignIns.finish")(function* (
    this: McpHostSignIns,
    key: string,
    signIn: HostSignIn,
    result: McpTestResult,
  ) {
    signIn.result = result;
    const tabId = signIn.tabId;
    signIn.tabId = null;
    if (tabId) yield* this.#closeTab(tabId);
    yield* Effect.sleep(Duration.millis(RESULT_KEPT_MS));
    if (this.#signIns.get(key) === signIn) this.#signIns.delete(key);
  });

  #closeTab(tabId: string) {
    return this.#dependencies.browser
      .closePrivate(tabId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("Unable to close an MCP sign-in tab", { error: toLogValue(error) })),
        ),
      );
  }
}

function signInKey(url: string): string {
  return normalizeResource(url) ?? url;
}

function failureText(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : sourceText("error.backend.mcpSignInAbandonedGeneric");
  return text.slice(0, ERROR_LIMIT);
}
