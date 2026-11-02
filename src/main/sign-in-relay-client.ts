// The client half of `sign-in-relay-v1`: this computer opens the sign-in page of a joined server's
// sign-in in the user's own browser, takes the callback, and sends its query to the host.

import {
  decodeSignInRelayStatus,
  loopbackCallback,
  type McpSignInRelayPage,
  relayCallbackQuery,
  type SignInRelayStatus,
} from "@openbot/contracts/ipc";
import { SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Duration, Effect } from "effect";
import type { LanguageService } from "./language-service";
import { type LoopbackCallbackServer, startLoopbackCallbackServer } from "./loopback-callback-server";

const logger = createOpenBotLogger("sign-in-relay-client");

/** How often a relayed sign-in asks the host how it is. */
const POLL = Duration.seconds(1);

type SignInRelayCallback = NonNullable<SignInRelayStatus["callback"]>;

/** The routes of one relayed sign-in on its host, so this file does not know the transport. */
export interface SignInRelayRemote<E> {
  start: Effect.Effect<{ flowId: string }, E>;
  status: (flowId: string) => Effect.Effect<SignInRelayStatus, E>;
  complete: (flowId: string, query: string) => Effect.Effect<SignInRelayStatus, E>;
  cancel: (flowId: string) => Effect.Effect<void, E>;
}

/** A `POST` to one route of a joined server, decoded. */
type RelayPost<E> = <T>(path: string, decoder: (value: unknown) => T, body: unknown) => Effect.Effect<T, E>;

/** The `status`, `complete` and `cancel` routes of a joined server, after the `start` that the kind of sign-in has. */
export function signInRelayRemote<E>(
  post: RelayPost<E>,
  start: Effect.Effect<{ flowId: string }, E>,
): SignInRelayRemote<E> {
  return {
    start,
    status: (flowId) => post(SIGN_IN_RELAY_ROUTES.status, decodeSignInRelayStatus, { flowId }),
    complete: (flowId, query) => post(SIGN_IN_RELAY_ROUTES.complete, decodeSignInRelayStatus, { flowId, query }),
    cancel: (flowId) => post(SIGN_IN_RELAY_ROUTES.cancel, () => undefined, { flowId }),
  };
}

export interface SignInRelayClientDependencies {
  openExternal: (url: string) => Promise<void>;
  language: Pick<LanguageService, "locale" | "translate">;
  /** The MCP grant listener of this computer, which takes the callbacks on its port by `state`. */
  ownListener: () => { port: number; path: string } | null;
}

interface Waiting {
  page: McpSignInRelayPage;
  /** The address the browser opens. It goes nowhere until the user, who sees its host name, asks. */
  url: string;
  /** `null` for a page that returns nowhere: no callback is its own. */
  state: string | null;
  receive: (query: string) => void;
  /** Whether a callback came back. The host then completes the sign-in, and nothing waits for a paste. */
  accepted: () => boolean;
}

/** A page that the user already chose, as with a link in a conversation. */
export interface ChosenSignInPage {
  page: string;
  /** Called once, when the sign-in waits for its callback, with what the renderer can show. */
  onWaiting: (page: McpSignInRelayPage) => void;
}

/**
 * The relayed sign-ins that wait on this computer, by a key that the caller chooses.
 *
 * The callback comes back to the loopback port that the host's sign-in named. When that is the port of
 * this computer's own MCP grant listener, the listener hands on a `state` that is not its own; when it
 * is another port, this binds that exact port for the time of the sign-in. When neither works, the
 * user pastes the address the browser shows. The query of the callback holds a grant: it goes only to
 * the host, and it is never logged.
 *
 * The host chooses the page, so a host that is not honest could ask for a grant of another account in
 * this browser. The page therefore opens only when the user, who sees its host name, asks; the port is
 * read from the page and not from the host's answer; and a page with no `state` is refused, so the
 * listener hands on only the callback of this sign-in. A page with no `state` that returns nowhere has
 * no callback to take, so the user can only open it.
 */
export class SignInRelayClient {
  readonly #dependencies: SignInRelayClientDependencies;
  readonly #waiting = new Map<string, Waiting>();

  constructor(dependencies: SignInRelayClientDependencies) {
    this.#dependencies = dependencies;
  }

  /** What the renderer shows while the sign-in of `key` waits, or `null`. */
  page(key: string): McpSignInRelayPage | null {
    const waiting = this.#waiting.get(key);
    return waiting && !waiting.accepted() ? waiting.page : null;
  }

  /**
   * A callback that reached this computer's MCP grant listener or its `openbot://mcp-auth` link with
   * a `state` that no local sign-in started. Answers whether a relayed sign-in took it.
   */
  deliver(state: string, query: string): boolean {
    for (const waiting of this.#waiting.values()) {
      if (waiting.state === null || waiting.state !== state) continue;
      waiting.receive(query);
      return true;
    }
    return false;
  }

  /** Opens the page of the sign-in of `key` in the user's browser, after they checked its host name. */
  open(key: string): Promise<void> {
    const waiting = this.#waiting.get(key);
    if (!waiting) return Promise.reject(new Error(sourceText("error.mcp.relayEnded")));
    return this.#dependencies.openExternal(waiting.url);
  }

  /** The address that the user pasted from the browser, for the sign-in of `key`. */
  paste(key: string, address: string): void {
    const waiting = this.#waiting.get(key);
    if (!waiting) throw new Error(sourceText("error.mcp.relayEnded"));
    if (waiting.state === null) throw new Error(sourceText("error.mcp.relayAddressInvalid"));
    const query = relayCallbackQuery(address, waiting.state);
    if (query === null) throw new Error(sourceText("error.mcp.relayAddressInvalid"));
    // The sign-in already has its callback, and the host completes it: a second one would change nothing.
    if (waiting.accepted()) return;
    waiting.receive(query);
  }

  /**
   * Runs one relayed sign-in to its end. An interrupt or a failure cancels the flow on the host. With
   * `chosen`, the page that the user already chose opens as soon as the callback can come back. The
   * host names the page, so any other page ends the sign-in unopened.
   */
  run<E>(key: string, remote: SignInRelayRemote<E>, chosen: ChosenSignInPage | null = null) {
    return this.#run(key, remote, chosen);
  }

  readonly #run = Effect.fn("SignInRelayClient.run")(function* <E>(
    this: SignInRelayClient,
    key: string,
    remote: SignInRelayRemote<E>,
    chosen: ChosenSignInPage | null,
  ) {
    const { flowId } = yield* remote.start;
    const self = this;
    // A new sign-in of the same key can start before this one ends, so this run removes only its own entry.
    let own: Waiting | null = null;
    const wait = (waiting: Waiting) => {
      own = waiting;
      self.#waiting.set(key, waiting);
    };
    const forget = () => {
      if (own !== null && self.#waiting.get(key) === own) self.#waiting.delete(key);
    };
    return yield* Effect.gen(function* () {
      const first = yield* awaitPage(remote, flowId);
      if (first.result) return first.result;
      const authorizeUrl = first.authorizeUrl ?? "";
      const page = safePage(authorizeUrl);
      if (!page) return { toolCount: 0, error: sourceText("error.backend.mcpSignInNotWebPage") };
      if (chosen !== null && page.toString() !== safePage(chosen.page)?.toString())
        return { toolCount: 0, error: sourceText("error.team.signInRelayLinkUnknown") };

      const callback = loopbackCallback(page.toString());
      const state = page.searchParams.get("state");
      // A page with no `state` that returns nowhere, such as a device page, has nothing to relay: the
      // user only opens it, and the host's sign-in finishes by itself.
      if (!state && !callback) {
        wait({
          page: { authorizeHost: page.host, listening: false, pasteable: false },
          url: page.toString(),
          state: null,
          receive: () => undefined,
          accepted: () => false,
        });
        yield* self.#openChosen(key, chosen);
        return yield* awaitResult(remote, flowId);
      }
      if (!state) return { toolCount: 0, error: sourceText("error.mcp.relayNoState") };

      const query = yield* Deferred.make<string>();
      const listener = yield* Effect.acquireRelease(
        Effect.promise(() =>
          self.#listen(callback, state, (value) => Deferred.doneUnsafe(query, Effect.succeed(value))),
        ),
        (server) => Effect.promise(() => server?.close() ?? Promise.resolve()),
      );
      const own = self.#dependencies.ownListener();
      const routed =
        callback !== null && (listener !== null || (own?.port === callback.port && own.path === callback.path));
      wait({
        page: { authorizeHost: page.host, listening: routed, pasteable: true },
        url: page.toString(),
        state,
        receive: (value) => Deferred.doneUnsafe(query, Effect.succeed(value)),
        accepted: () => Deferred.isDoneUnsafe(query),
      });
      yield* self.#openChosen(key, chosen);

      // The host can end the sign-in first: its deadline passed, or another start replaced it.
      const ended = yield* Effect.raceFirst(
        Deferred.await(query).pipe(Effect.map((value) => ({ query: value }))),
        awaitResult(remote, flowId).pipe(Effect.map((result) => ({ result }))),
      );
      if ("result" in ended) return ended.result;
      const completed = yield* remote.complete(flowId, ended.query);
      return completed.result ?? (yield* awaitResult(remote, flowId));
    }).pipe(
      Effect.scoped,
      Effect.onError(() => remote.cancel(flowId).pipe(Effect.ignore)),
      Effect.ensuring(Effect.sync(forget)),
    );
  });

  /** Opens the chosen page of the sign-in of `key`, which now waits, and tells the caller what it shows. */
  #openChosen(key: string, chosen: ChosenSignInPage | null) {
    const waiting = this.#waiting.get(key);
    if (chosen === null || !waiting) return Effect.void;
    chosen.onWaiting(waiting.page);
    return Effect.promise(() => this.#dependencies.openExternal(waiting.url));
  }

  /**
   * Binds the exact callback port for a sign-in whose callback is not on this computer's own listener.
   * `null` when there is nothing to bind or the port is busy: the user can still paste the address.
   */
  async #listen(
    callback: SignInRelayCallback | null,
    state: string,
    receive: (query: string) => void,
  ): Promise<LoopbackCallbackServer | null> {
    const own = this.#dependencies.ownListener();
    if (!callback || (own?.port === callback.port && own.path === callback.path)) return null;
    return startLoopbackCallbackServer({
      path: callback.path,
      port: { exact: callback.port },
      language: this.#dependencies.language,
      noPort: () => new Error("The sign-in relay listener was given no port."),
      receive: (url) => {
        if (url.searchParams.get("state") !== state) return { status: 400, message: "error.mcp.redirectNoSignIn" };
        receive(url.search.slice(1));
        return { status: 200, message: "error.mcp.redirectRelayed" };
      },
    }).catch((error: unknown) => {
      logger.warn("OpenBot could not listen for a relayed sign-in, so only a pasted address works:", toLogValue(error));
      return null;
    });
  }
}

/** Reads `status` until the host has the page address, or the sign-in ended first. */
function awaitPage<E>(remote: SignInRelayRemote<E>, flowId: string) {
  return Effect.gen(function* () {
    while (true) {
      const status = yield* remote.status(flowId);
      if (status.result || status.authorizeUrl) return status;
      yield* Effect.sleep(POLL);
    }
  });
}

/** Reads `status` until the sign-in ended. */
function awaitResult<E>(remote: SignInRelayRemote<E>, flowId: string) {
  return Effect.gen(function* () {
    while (true) {
      const status = yield* remote.status(flowId);
      if (status.result) return status.result;
      yield* Effect.sleep(POLL);
    }
  });
}

/** The page address, when it is a web page. The host chose it, so this computer opens nothing else. */
function safePage(address: string): URL | null {
  try {
    const url = new URL(address);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
