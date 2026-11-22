import {
  decodeSignInRelayStatus,
  loopbackCallback,
  type McpSignInRelayPage,
  relayCallbackQuery,
  relayPageUrl,
  type SignInRelayStatus,
} from "@openbot/contracts/ipc";
import { SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Duration, Effect } from "effect";
import type { LanguageService } from "./language-service";
import { type LoopbackCallbackServer, startLoopbackCallbackServer } from "./loopback-callback-server";

const logger = createOpenBotLogger("sign-in-relay-client");

const POLL = Duration.seconds(1);

type SignInRelayCallback = NonNullable<SignInRelayStatus["callback"]>;

export interface SignInRelayRemote<E> {
  start: Effect.Effect<{ flowId: string }, E>;
  status: (flowId: string) => Effect.Effect<SignInRelayStatus, E>;
  complete: (flowId: string, query: string) => Effect.Effect<SignInRelayStatus, E>;
  cancel: (flowId: string) => Effect.Effect<void, E>;
}

type RelayPost<E> = <T>(path: string, decoder: (value: unknown) => T, body: unknown) => Effect.Effect<T, E>;

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
  ownListener: () => { port: number; paths: readonly string[] } | null;
  deepLinkRedirectUrl: () => string | undefined;
}

interface Waiting {
  page: McpSignInRelayPage;
  url: string;
  state: string | null;
  receive: (query: string) => void;
  accepted: () => boolean;
}

interface SharedListener {
  id: string;
  users: number;
  server: Promise<LoopbackCallbackServer | null>;
}

export interface ChosenSignInPage {
  page: string;
  onWaiting: (page: McpSignInRelayPage) => void;
}

export class SignInRelayClient {
  readonly #dependencies: SignInRelayClientDependencies;
  readonly #waiting = new Map<string, Waiting[]>();
  readonly #listeners = new Map<string, SharedListener>();

  constructor(dependencies: SignInRelayClientDependencies) {
    this.#dependencies = dependencies;
  }

  #newest(key: string): Waiting | undefined {
    return this.#waiting.get(key)?.at(-1);
  }

  page(key: string): McpSignInRelayPage | null {
    const waiting = this.#newest(key);
    return waiting && !waiting.accepted() ? waiting.page : null;
  }

  deliver(state: string, query: string): boolean {
    for (const waiting of [...this.#waiting.values()].flat()) {
      if (waiting.state === null || waiting.state !== state) continue;
      waiting.receive(query);
      return true;
    }
    return false;
  }

  receivesDeepLink(): boolean {
    return this.#dependencies.deepLinkRedirectUrl() !== undefined;
  }

  open(key: string): Promise<void> {
    const waiting = this.#newest(key);
    if (!waiting) return Promise.reject(new Error(sourceText("error.mcp.relayEnded")));
    return this.#dependencies.openExternal(waiting.url);
  }

  paste(key: string, address: string): void {
    const waiting = this.#waiting.get(key) ?? [];
    if (waiting.length === 0) throw new Error(sourceText("error.mcp.relayEnded"));
    for (const candidate of waiting.toReversed()) {
      const query = candidate.state === null ? null : relayCallbackQuery(address, candidate.state);
      if (query === null) continue;
      if (!candidate.accepted()) candidate.receive(query);
      return;
    }
    throw new Error(sourceText("error.mcp.relayAddressInvalid"));
  }

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
    let own: Waiting | null = null;
    const wait = (waiting: Waiting) => {
      own = waiting;
      self.#waiting.set(key, [...(self.#waiting.get(key) ?? []), waiting]);
    };
    const forget = () => {
      const rest = (self.#waiting.get(key) ?? []).filter((waiting) => waiting !== own);
      if (rest.length > 0) self.#waiting.set(key, rest);
      else self.#waiting.delete(key);
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
      if (!state && !callback) {
        wait({
          page: { authorizeHost: page.host, url: relayPageUrl(page), listening: false, pasteable: false },
          url: page.toString(),
          state: null,
          receive: () => undefined,
          accepted: () => false,
        });
        yield* self.#openPage(key, chosen);
        return yield* awaitResult(remote, flowId);
      }
      if (!state) return { toolCount: 0, error: sourceText("error.mcp.relayNoState") };

      const query = yield* Deferred.make<string>();
      const listener = yield* Effect.acquireRelease(
        Effect.promise(() => self.#acquireListener(callback)),
        (shared) => Effect.promise(() => self.#releaseListener(shared)),
      );
      const own = self.#dependencies.ownListener();
      const deepLink =
        callback === null && page.searchParams.get("redirect_uri") === self.#dependencies.deepLinkRedirectUrl();
      const routed =
        deepLink ||
        (callback !== null &&
          (listener !== null || (own?.port === callback.port && own.paths.includes(callback.path))));
      wait({
        page: { authorizeHost: page.host, url: relayPageUrl(page), listening: routed, pasteable: true },
        url: page.toString(),
        state,
        receive: (value) => Deferred.doneUnsafe(query, Effect.succeed(value)),
        accepted: () => Deferred.isDoneUnsafe(query),
      });
      yield* self.#openPage(key, chosen);

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

  #openPage(key: string, chosen: ChosenSignInPage | null) {
    const waiting = this.#newest(key);
    if (!waiting) return Effect.void;
    return Effect.tryPromise(() => this.#dependencies.openExternal(waiting.url)).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("OpenBot could not open a relayed sign-in page:", toLogValue(error.cause));
          return false;
        }),
      ),
      Effect.flatMap((opened) =>
        Effect.sync(() => chosen?.onWaiting({ ...waiting.page, listening: waiting.page.listening && opened })),
      ),
    );
  }

  async #acquireListener(callback: SignInRelayCallback | null): Promise<SharedListener | null> {
    const own = this.#dependencies.ownListener();
    if (!callback || (own?.port === callback.port && own.paths.includes(callback.path))) return null;
    const id = `${callback.port}${callback.path}`;
    const shared = this.#listeners.get(id) ?? this.#startListener(id, callback);
    shared.users += 1;
    if ((await shared.server) !== null) return shared;
    await this.#releaseListener(shared);
    return null;
  }

  #startListener(id: string, callback: SignInRelayCallback): SharedListener {
    const server = startLoopbackCallbackServer({
      paths: [callback.path],
      port: { exact: callback.port },
      language: this.#dependencies.language,
      noPort: () => new Error("The sign-in relay listener was given no port."),
      receive: (url) => {
        const state = url.searchParams.get("state");
        return state !== null && this.deliver(state, url.search.slice(1))
          ? { status: 200, message: "error.mcp.redirectRelayed" }
          : { status: 400, message: "error.mcp.redirectNoSignIn" };
      },
    }).catch((error: unknown) => {
      logger.warn("OpenBot could not listen for a relayed sign-in, so only a pasted address works:", toLogValue(error));
      return null;
    });
    const shared: SharedListener = { id, users: 0, server };
    this.#listeners.set(id, shared);
    return shared;
  }

  async #releaseListener(shared: SharedListener | null): Promise<void> {
    if (shared === null) return;
    shared.users -= 1;
    if (shared.users > 0) return;
    if (this.#listeners.get(shared.id) === shared) this.#listeners.delete(shared.id);
    await (await shared.server)?.close();
  }
}

function awaitPage<E>(remote: SignInRelayRemote<E>, flowId: string) {
  return Effect.gen(function* () {
    while (true) {
      const status = yield* remote.status(flowId);
      if (status.result || status.authorizeUrl) return status;
      yield* Effect.sleep(POLL);
    }
  });
}

function awaitResult<E>(remote: SignInRelayRemote<E>, flowId: string) {
  return Effect.gen(function* () {
    while (true) {
      const status = yield* remote.status(flowId);
      if (status.result) return status.result;
      yield* Effect.sleep(POLL);
    }
  });
}

function safePage(address: string): URL | null {
  try {
    const url = new URL(address);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
