// Links in a joined server's conversation that an agent printed. A sign-in page of the agent's CLI
// returns to a loopback address on the host, so this computer relays its callback (`sign-in-relay-v1`).

import {
  decodeSignInRelayFlow,
  type McpSignInRelayPage,
  type McpTestResult,
  relayableSignInLink,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { SIGN_IN_RELAY_CAPABILITY, SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Cause, Effect, Fiber } from "effect";
import type { ResponseDecoder } from "./remote-host-decoding";
import type { RemoteRequestInit } from "./remote-server-client";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";
import { type SignInRelayClient, signInRelayRemote } from "./sign-in-relay-client";

const logger = createOpenBotLogger("message-link-relay");

/** Opens an http or https link in the user's browser. Any other scheme is refused. */
export function openHttpLink(url: string, openExternal: (url: string) => Promise<void>): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(sourceText("error.app.externalLinkProtocol"));
  return openExternal(parsed.toString());
}

export interface MessageLinkRelayDependencies {
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
  relay: Pick<SignInRelayClient, "run" | "paste">;
  /** Opens a link that is not a relayed sign-in, as `app.openUrl` does. */
  openUrl: (url: string) => Promise<void>;
}

export class MessageLinkRelay {
  readonly #dependencies: MessageLinkRelayDependencies;
  readonly #running = new Map<string, Fiber.Fiber<McpTestResult, RemoteWorkflowError>>();

  constructor(dependencies: MessageLinkRelayDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Opens a link of an agent of `serverId`. A sign-in page that the host relays opens once the host
   * accepted it, and its callback goes to the host. When this computer cannot take the callback, the
   * answer is the page that the renderer shows with a field for the address from the browser. A host
   * that cannot relay the link, such as for a member who is not an admin, gets the link opened as it is.
   */
  readonly open = Effect.fn("MessageLinkRelay.open")(function* (
    this: MessageLinkRelay,
    serverId: string,
    agentId: string,
    url: string,
  ): Effect.fn.Return<McpSignInRelayPage | null, RemoteWorkflowError> {
    const { remoteServers, relay, openUrl } = this.#dependencies;
    const page = relayableSignInLink(url);
    if (!page || !remoteServers.supportsCapability(serverId, SIGN_IN_RELAY_CAPABILITY)) {
      yield* remoteCall(() => openUrl(url));
      return null;
    }
    const key = linkKey(serverId, page);
    yield* this.#stop(key);
    const post = <T>(path: string, decoder: ResponseDecoder<T>, body: unknown) =>
      remoteServers.request(serverId, path, decoder, { method: "POST", body });
    const flow = yield* post(SIGN_IN_RELAY_ROUTES.linkStart, decodeSignInRelayFlow, { agentId, url }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("The host did not relay a sign-in link, so it opens as it is:", toLogValue(error.cause));
          return null;
        }),
      ),
    );
    if (!flow) {
      yield* remoteCall(() => openUrl(url));
      return null;
    }
    // The relay outlives this call: it waits for the callback until it ends, `paste` joins it or
    // `cancel` interrupts it.
    const shown = yield* Effect.callback<McpSignInRelayPage | null, RemoteWorkflowError>((resume) => {
      const fiber = Effect.runFork(
        relay.run(key, signInRelayRemote(post, Effect.succeed(flow)), {
          page,
          onWaiting: (waiting) => resume(Effect.succeed(waiting)),
        }),
      );
      this.#running.set(key, fiber);
      fiber.addObserver((exit) => {
        if (this.#running.get(key) === fiber) this.#running.delete(key);
        if (exit._tag === "Success")
          return resume(exit.value.error === null ? Effect.succeed(null) : relayFailure(exit.value.error));
        if (!Cause.hasInterruptsOnly(exit.cause))
          logger.warn("A relayed sign-in link did not finish:", toLogValue(Cause.squash(exit.cause)));
        resume(Effect.succeed(null));
      });
    });
    return shown?.pasteable && !shown.listening ? shown : null;
  });

  /** The address that the user pasted from the browser. Succeeds when the sign-in ended well. */
  readonly paste = Effect.fn("MessageLinkRelay.paste")(function* (
    this: MessageLinkRelay,
    serverId: string,
    url: string,
    address: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const page = relayableSignInLink(url);
    const key = page && linkKey(serverId, page);
    const fiber = key ? this.#running.get(key) : undefined;
    if (!key || !fiber) return yield* relayFailure(sourceText("error.mcp.relayEnded"));
    yield* remoteDecode(() => this.#dependencies.relay.paste(key, address));
    const result = yield* Fiber.join(fiber);
    if (result.error !== null) return yield* relayFailure(result.error);
  });

  /** Ends the relayed sign-in of a link, and cancels it on the host. */
  readonly cancel = Effect.fn("MessageLinkRelay.cancel")(function* (
    this: MessageLinkRelay,
    serverId: string,
    url: string,
  ): Effect.fn.Return<void> {
    const page = relayableSignInLink(url);
    if (page) yield* this.#stop(linkKey(serverId, page));
  });

  readonly #stop = Effect.fn("MessageLinkRelay.stop")(function* (this: MessageLinkRelay, key: string) {
    const fiber = this.#running.get(key);
    this.#running.delete(key);
    if (fiber) yield* Fiber.interrupt(fiber);
  });
}

/** A failure whose message the renderer shows as it is: a host answer or a `sourceText` key. */
function relayFailure(message: string): Effect.Effect<never, RemoteWorkflowError> {
  return Effect.fail(new RemoteWorkflowError({ cause: new Error(message) }));
}

function linkKey(serverId: string, page: string): string {
  return `link\n${serverId}\n${page}`;
}
