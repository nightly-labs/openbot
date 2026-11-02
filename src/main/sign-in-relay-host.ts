// The host half of `sign-in-relay-v1`: sign-ins that an administrator starts on this host and finishes
// in the browser of their own computer.

import { randomBytes } from "node:crypto";
import {
  type ConversationMessage,
  loopbackCallback,
  type McpTestResult,
  relayableSignInLink,
  type SignInRelayStatus,
  type TestMcpServerInput,
} from "@openbot/contracts/ipc";
import type { ProviderAccountRelayProvider } from "@openbot/contracts/team-protocol/provider-account-relays";
import type { SIGN_IN_RELAY_PROVIDERS } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Duration, Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { McpHostSignIns } from "./mcp-host-sign-ins";
import type { ProviderAccountsHost } from "./provider-accounts-host";
import type { ProviderHostSignIns } from "./provider-host-sign-ins";
import { HttpError } from "./team-api/http-error";

export type SignInRelayProvider = (typeof SIGN_IN_RELAY_PROVIDERS)[number];

/** How long a flow can complete. The sign-in on this host has its own, equal deadline. */
const SIGN_IN_RELAY_TTL_MS = 10 * 60_000;
/** Flows kept at one time. A new flow above this ends the oldest. */
const FLOW_LIMIT = 16;
/** How long the listener of a sign-in on this host can take to answer its callback. */
const REPLAY_TIMEOUT = Duration.seconds(10);
/**
 * How long the success page that a callback redirects to can take. The client waits 15 s for
 * `complete`, and cancels the sign-in after it: the callback and this page stay under that.
 */
const SUCCESS_PAGE_TIMEOUT = Duration.seconds(3);
/** How long after its message an agent's sign-in link can start a flow. A CLI's own page ends sooner. */
const PRINTED_LINK_AGE_MS = 60 * 60_000;
/** What `status` and `complete` answer, as `sign-in-relay-v1` sends it. */
export type SignInRelayView = SignInRelayStatus;

/** A sign-in on this host that a flow relays to: its page address, how it ended, and how to stop it. */
export interface RelaySignIn {
  /** One sign-in runs for each key; a new flow for the same key replaces the old one. */
  key: string;
  status: () => { pageUrl: string | null; result: McpTestResult | null };
  /** Ends when the sign-in has stopped, so a client that reads the host after `cancel` sees it gone. */
  cancel: () => Effect.Effect<void>;
}

/** The part of a flow that differs by kind of sign-in. */
interface RelayTarget extends RelaySignIn {
  /** Gives the callback to the sign-in that waits for it, and answers whether one took it. */
  deliver: (query: URLSearchParams, pageUrl: string) => Effect.Effect<boolean>;
  /** Tells a sign-in that this host does not own that the user refused, as the browser here would. */
  refuse?: (query: URLSearchParams, pageUrl: string) => Effect.Effect<unknown>;
}

class SignInRelayRefused extends Schema.TaggedError<SignInRelayRefused>()("SignInRelayRefused", {
  cause: Schema.Defect(),
}) {}

const { sync: refusable } = causeHelpers(SignInRelayRefused);
const refuse = (status: number, key: "error.team.signInRelayUsed" | "error.team.signInRelayMismatch") =>
  Effect.fail(new SignInRelayRefused({ cause: new HttpError(status, sourceText(key)) }));

interface Flow {
  memberId: string;
  expiresAt: number;
  target: RelayTarget;
  completed: boolean;
}

export interface SignInRelayHostDependencies {
  mcp: Pick<McpHostSignIns, "startRelay" | "relayStatus" | "cancel">;
  providers: Pick<ProviderHostSignIns, "startRelay" | "relayStatus" | "cancel">;
  accounts: Pick<ProviderAccountsHost, "startRelay" | "relayStatus" | "cancelSignIn">;
  /** Gives an MCP grant to the sign-in on this host that waits for `state`, as the loopback listener does. */
  receiveMcpGrant: (state: string, code: string) => boolean;
  /** Answers whether an agent message of `agentId` holds this exact address. */
  printedLink: (agentId: string, url: string) => boolean;
  now?: () => number;
}

/**
 * The flows of relayed sign-ins.
 *
 * The client sends only the query of the callback. This host takes the rest of the callback from the
 * page address that its own sign-in made, so a client cannot choose a port or a path here. A flow
 * completes once, only for the member who started it, and ends at `expiresAt`. An unknown flow, an
 * expired flow and the flow of another member get the same answer, so the answer tells nothing about
 * the flows of other members.
 */
export class SignInRelayHost {
  readonly #dependencies: SignInRelayHostDependencies;
  readonly #now: () => number;
  readonly #flows = new Map<string, Flow>();

  constructor(dependencies: SignInRelayHostDependencies) {
    this.#dependencies = dependencies;
    this.#now = dependencies.now ?? Date.now;
  }

  /** Starts the MCP sign-in of `input` with no tab, and returns its flow at once. */
  startMcp(memberId: string, input: TestMcpServerInput) {
    return this.#startMcp(memberId, input);
  }

  readonly #startMcp = Effect.fn("SignInRelayHost.startMcp")(function* (
    this: SignInRelayHost,
    memberId: string,
    input: TestMcpServerInput,
  ) {
    const { mcp, receiveMcpGrant } = this.#dependencies;
    yield* mcp.startRelay(input);
    const url = input.config.url;
    return this.#open(memberId, {
      key: `mcp\n${url}`,
      status: () => mcp.relayStatus(url),
      deliver: (query) =>
        Effect.sync(() => {
          const state = query.get("state");
          const code = query.get("code");
          if (!state || !code) return false;
          registerSecretValue(code);
          return receiveMcpGrant(state, code);
        }),
      cancel: () => Effect.sync(() => mcp.cancel(url)),
    });
  });

  /** Starts the sign-in of a provider's CLI with no tab, and returns its flow at once. */
  startProvider(memberId: string, provider: SignInRelayProvider) {
    return this.#startProvider(memberId, provider);
  }

  readonly #startProvider = Effect.fn("SignInRelayHost.startProvider")(function* (
    this: SignInRelayHost,
    memberId: string,
    provider: SignInRelayProvider,
  ) {
    const { providers } = this.#dependencies;
    yield* providers.startRelay(provider);
    return this.startReplay(memberId, {
      key: `provider\n${provider}`,
      status: () => {
        const { pageUrl, result } = providers.relayStatus(provider);
        return { pageUrl, result: result && { toolCount: 0, error: result.error } };
      },
      cancel: () => providers.cancel(provider).pipe(Effect.ignore),
    });
  });

  /**
   * Starts the sign-in of a provider account after the first with no tab, and returns its flow at once
   * (`provider-account-relay-v1` and `-v2`). A null `accountId` signs in a new account.
   */
  startProviderAccount(memberId: string, provider: ProviderAccountRelayProvider, accountId: string | null) {
    return this.#startProviderAccount(memberId, provider, accountId);
  }

  readonly #startProviderAccount = Effect.fn("SignInRelayHost.startProviderAccount")(function* (
    this: SignInRelayHost,
    memberId: string,
    provider: ProviderAccountRelayProvider,
    accountId: string | null,
  ) {
    const { accounts } = this.#dependencies;
    yield* accounts.startRelay(provider, accountId);
    // One account sign-in runs for each provider, so a new flow replaces the one of any account.
    return this.startReplay(memberId, {
      key: `account\n${provider}`,
      status: () => {
        const { pageUrl, result } = accounts.relayStatus(provider);
        return { pageUrl, result: result && { toolCount: 0, error: result.error } };
      },
      cancel: () => accounts.cancelSignIn(provider).pipe(Effect.ignore),
    });
  });

  /**
   * Relays to a sign-in that already runs on this host and listens on the loopback address its page
   * names, such as the sign-in of a provider's command-line tool. The callback goes to that address as
   * the browser on this host would send it.
   */
  startReplay(memberId: string, signIn: RelaySignIn): { flowId: string; expiresAt: number } {
    return this.#open(memberId, { ...signIn, deliver: replay, refuse: replay });
  }

  /**
   * Relays a sign-in page that an agent of this host printed, such as the page of an MCP server that
   * the agent's CLI signs in to. The CLI listens on the loopback address of the page. Only a page that
   * an agent message holds can start a flow, so a client cannot choose the address that gets the query.
   */
  startLink(memberId: string, agentId: string, url: string): { flowId: string; expiresAt: number } {
    if (!relayableSignInLink(url) || !this.#dependencies.printedLink(agentId, url))
      throw new HttpError(404, sourceText("error.team.signInRelayLinkUnknown"));
    let result: McpTestResult | null = null;
    return this.#open(memberId, {
      key: `link\n${url}`,
      status: () => ({ pageUrl: url, result }),
      // The CLI owns the sign-in, so this host knows only that the callback reached it.
      deliver: (query, pageUrl) =>
        replay(query, pageUrl).pipe(
          Effect.map((delivered) => {
            if (delivered) result = { toolCount: 0, error: null };
            return delivered;
          }),
        ),
      refuse: replay,
      // The CLI keeps its own sign-in, so a refusal or a cancel only ends what this host relays.
      cancel: () =>
        Effect.sync(() => {
          result ??= { toolCount: 0, error: sourceText("error.mcp.relayEnded") };
        }),
    });
  }

  status(memberId: string, flowId: string): SignInRelayView {
    return view(this.#flow(memberId, flowId));
  }

  /** Delivers the callback query of a flow. The client then reads `status` until the sign-in ends. */
  complete(memberId: string, flowId: string, query: string) {
    return this.#complete(memberId, flowId, query);
  }

  readonly #complete = Effect.fn("SignInRelayHost.complete")(function* (
    this: SignInRelayHost,
    memberId: string,
    flowId: string,
    query: string,
  ) {
    const flow = yield* refusable(() => this.#flow(memberId, flowId));
    if (flow.completed) return yield* refuse(409, "error.team.signInRelayUsed");
    const current = view(flow);
    if (current.result) return current;
    const params = new URLSearchParams(query);
    // A callback for another sign-in, or for a page this flow has not shown yet, is not this one.
    const page = current.authorizeUrl;
    const state = page ? new URL(page).searchParams.get("state") : null;
    if (!page || !state || params.get("state") !== state) return yield* refuse(400, "error.team.signInRelayMismatch");
    flow.completed = true;
    // The user refused on the sign-in page. Nothing comes after it, so the sign-in ends here. A CLI that
    // waits for the callback gets the refusal too, so it stops now and not at its own deadline.
    if (params.has("error")) {
      if (flow.target.refuse) yield* flow.target.refuse(params, page);
      yield* flow.target.cancel();
      return view(flow);
    }
    if (!(yield* flow.target.deliver(params, page))) return yield* refuse(400, "error.team.signInRelayMismatch");
    return view(flow);
  });

  /** Ends when the sign-in on this host has stopped. */
  cancel(memberId: string, flowId: string) {
    return this.#cancel(memberId, flowId);
  }

  readonly #cancel = Effect.fn("SignInRelayHost.cancel")(function* (
    this: SignInRelayHost,
    memberId: string,
    flowId: string,
  ) {
    const flow = yield* refusable(() => this.#flow(memberId, flowId));
    this.#flows.delete(flowId);
    if (!flow.target.status().result) yield* flow.target.cancel();
  });

  #open(memberId: string, target: RelayTarget): { flowId: string; expiresAt: number } {
    this.#expire();
    // The new sign-in replaced the old one of the same key, so the old flow has nothing left to relay.
    for (const [id, flow] of this.#flows) if (flow.target.key === target.key) this.#flows.delete(id);
    for (const [id, flow] of this.#flows) {
      if (this.#flows.size < FLOW_LIMIT) break;
      this.#flows.delete(id);
      Effect.runFork(flow.target.cancel());
    }
    const flowId = randomBytes(16).toString("hex");
    const expiresAt = this.#now() + SIGN_IN_RELAY_TTL_MS;
    this.#flows.set(flowId, { memberId, expiresAt, target, completed: false });
    return { flowId, expiresAt };
  }

  #flow(memberId: string, flowId: string): Flow {
    this.#expire();
    const flow = this.#flows.get(flowId);
    if (!flow || flow.memberId !== memberId) throw new HttpError(404, sourceText("error.team.signInRelayUnknown"));
    return flow;
  }

  #expire(): void {
    const now = this.#now();
    for (const [id, flow] of this.#flows) {
      if (flow.expiresAt > now) continue;
      this.#flows.delete(id);
      if (!flow.target.status().result) Effect.runFork(flow.target.cancel());
    }
  }
}

/**
 * Whether an agent message from the last `PRINTED_LINK_AGE_MS` holds `url` as a whole link. The link
 * must end where the message's link ends, so a client cannot drop the end of a printed link, and an
 * old message cannot start a flow. The replay sends only what a click on that link on this host would
 * send.
 */
export function agentPrintedLink(messages: readonly ConversationMessage[], url: string, now: number): boolean {
  return messages.some((message) => {
    if (message.author !== "agent" && message.author !== "assistant") return false;
    if (!(now - Date.parse(message.createdAt) <= PRINTED_LINK_AGE_MS)) return false;
    for (let at = message.text.indexOf(url); at >= 0; at = message.text.indexOf(url, at + 1))
      if (linkEndsAt(message.text, at + url.length)) return true;
    return false;
  });
}

/** Whether a link ends at `end`: at the end of the text, a space, a closing mark, or a final punctuation mark. */
function linkEndsAt(text: string, end: number): boolean {
  const next = text.charAt(end);
  if (next === "" || /[\s<>"'`)\]]/.test(next)) return true;
  return /[.,;:!?]/.test(next) && (end + 1 === text.length || /[\s<>"'`)\]]/.test(text.charAt(end + 1)));
}

function view(flow: Flow): SignInRelayView {
  const { pageUrl, result } = flow.target.status();
  return { authorizeUrl: pageUrl, callback: pageUrl ? loopbackCallback(pageUrl) : null, result };
}

/**
 * Sends the callback to the loopback address that the page of this host's own sign-in names. The
 * address comes only from that page, so a client cannot choose it. Only the status of the callback is
 * kept: the answer is a page for a browser. The query holds a grant, so nothing here logs the address.
 */
const replay = Effect.fn("SignInRelayHost.replay")(function* (query: URLSearchParams, pageUrl: string) {
  if (!loopbackCallback(pageUrl)) return false;
  const code = query.get("code");
  if (code) registerSecretValue(code);
  const address = new URL(new URL(pageUrl).searchParams.get("redirect_uri") ?? "");
  address.search = query.toString();
  address.hash = "";
  const answer = yield* load(address, REPLAY_TIMEOUT);
  if (!answer?.delivered) return false;
  // `codex login` answers its callback with a redirect to its own success page, and ends only when
  // that page loads, as in a browser on this host. Only that one redirect, to the same address and
  // port, is followed. The callback has its sign-in already, so this load does not change the result.
  if (answer.next?.origin === address.origin) {
    const token = answer.next.searchParams.get("id_token");
    if (token) registerSecretValue(token);
    yield* load(answer.next, SUCCESS_PAGE_TIMEOUT);
  }
  return true;
});

/** Loads `address` with no redirect. Null when it does not answer in time. */
const load = (address: URL, timeout: Duration.Duration) =>
  Effect.tryPromise(async (signal) => {
    const response = await fetch(address, { redirect: "manual", signal });
    await response.body?.cancel();
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    return { delivered: response.status < 400, next: location ? URL.parse(location, address) : null };
  }).pipe(
    Effect.timeout(timeout),
    Effect.orElseSucceed(() => null),
  );
