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
import type { ProviderSignInRelayProvider } from "@openbot/contracts/team-protocol/provider-sign-in-relays";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Duration, Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import type { McpHostSignIns } from "./mcp-host-sign-ins";
import type { ProviderAccountsHost } from "./provider-accounts-host";
import type { ProviderHostSignIns } from "./provider-host-sign-ins";
import { HttpError } from "./team-api/http-error";

export type SignInRelayProvider = ProviderSignInRelayProvider;

const SIGN_IN_RELAY_TTL_MS = 10 * 60_000;
const FLOW_LIMIT = 16;
const REPLAY_TIMEOUT = Duration.seconds(10);
const SUCCESS_PAGE_TIMEOUT = Duration.seconds(3);
const PRINTED_LINK_AGE_MS = 60 * 60_000;
export type SignInRelayView = SignInRelayStatus;

export interface RelaySignIn {
  key: string;
  status: () => { pageUrl: string | null; result: McpTestResult | null };
  cancel: () => Effect.Effect<void>;
}

interface RelayTarget extends RelaySignIn {
  keepsEarlier?: true;
  deliver: (query: URLSearchParams, pageUrl: string) => Effect.Effect<boolean>;
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
  mcp: Pick<McpHostSignIns, "startRelay">;
  providers: Pick<ProviderHostSignIns, "startRelay" | "relayStatus" | "cancel">;
  accounts: Pick<ProviderAccountsHost, "startRelay" | "relayStatus" | "cancelSignIn">;
  receiveMcpGrant: (state: string, code: string) => boolean;
  receiveMcpRefusal: (state: string) => boolean;
  printedLink: (agentId: string, url: string) => boolean;
  atHost?: (sessionId: string) => boolean;
  now?: () => number;
}

export class SignInRelayHost {
  readonly #dependencies: SignInRelayHostDependencies;
  readonly #now: () => number;
  readonly #flows = new Map<string, Flow>();

  constructor(dependencies: SignInRelayHostDependencies) {
    this.#dependencies = dependencies;
    this.#now = dependencies.now ?? Date.now;
  }

  #atHost(sessionId: string | undefined): boolean {
    return sessionId !== undefined && (this.#dependencies.atHost?.(sessionId) ?? false);
  }

  startMcp(memberId: string, input: TestMcpServerInput, deepLinkRedirectUrl?: string) {
    return this.#startMcp(memberId, input, deepLinkRedirectUrl);
  }

  readonly #startMcp = Effect.fn("SignInRelayHost.startMcp")(function* (
    this: SignInRelayHost,
    memberId: string,
    input: TestMcpServerInput,
    deepLinkRedirectUrl?: string,
  ) {
    const { mcp, receiveMcpGrant, receiveMcpRefusal } = this.#dependencies;
    const signIn = yield* mcp.startRelay(input, deepLinkRedirectUrl);
    const url = input.config.url;
    return this.#open(memberId, {
      key: `mcp\n${url}`,
      keepsEarlier: true,
      status: signIn.status,
      deliver: (query) =>
        Effect.sync(() => {
          const state = query.get("state");
          const code = query.get("code");
          if (!state || !code) return false;
          registerSecretValue(code);
          return receiveMcpGrant(state, code);
        }),
      refuse: (query) =>
        Effect.sync(() => {
          const state = query.get("state");
          return state ? receiveMcpRefusal(state) : false;
        }),
      cancel: () => signIn.cancel,
    });
  });

  startProvider(memberId: string, provider: SignInRelayProvider, sessionId?: string) {
    return this.#startProvider(memberId, provider, sessionId);
  }

  readonly #startProvider = Effect.fn("SignInRelayHost.startProvider")(function* (
    this: SignInRelayHost,
    memberId: string,
    provider: SignInRelayProvider,
    sessionId?: string,
  ) {
    const { providers } = this.#dependencies;
    yield* providers.startRelay(provider, this.#atHost(sessionId));
    return this.startReplay(memberId, {
      key: `provider\n${provider}`,
      status: () => {
        const { pageUrl, result } = providers.relayStatus(provider);
        return { pageUrl, result: result && { toolCount: 0, error: result.error } };
      },
      cancel: () => providers.cancel(provider).pipe(Effect.ignore),
    });
  });

  startProviderAccount(
    memberId: string,
    provider: ProviderAccountRelayProvider,
    accountId: string | null,
    sessionId?: string,
  ) {
    return this.#startProviderAccount(memberId, provider, accountId, sessionId);
  }

  readonly #startProviderAccount = Effect.fn("SignInRelayHost.startProviderAccount")(function* (
    this: SignInRelayHost,
    memberId: string,
    provider: ProviderAccountRelayProvider,
    accountId: string | null,
    sessionId?: string,
  ) {
    const { accounts } = this.#dependencies;
    yield* accounts.startRelay(provider, accountId, this.#atHost(sessionId));
    return this.startReplay(memberId, {
      key: `account\n${provider}`,
      status: () => {
        const { pageUrl, result } = accounts.relayStatus(provider);
        return { pageUrl, result: result && { toolCount: 0, error: result.error } };
      },
      cancel: () => accounts.cancelSignIn(provider).pipe(Effect.ignore),
    });
  });

  startReplay(memberId: string, signIn: RelaySignIn): { flowId: string; expiresAt: number } {
    return this.#open(memberId, { ...signIn, deliver: replay, refuse: replay });
  }

  startLink(memberId: string, agentId: string, url: string): { flowId: string; expiresAt: number } {
    if (!relayableSignInLink(url) || !this.#dependencies.printedLink(agentId, url))
      throw new HttpError(404, sourceText("error.team.signInRelayLinkUnknown"));
    let result: McpTestResult | null = null;
    return this.#open(memberId, {
      key: `link\n${url}`,
      status: () => ({ pageUrl: url, result }),
      deliver: (query, pageUrl) =>
        replay(query, pageUrl).pipe(
          Effect.map((delivered) => {
            if (delivered) result = { toolCount: 0, error: null };
            return delivered;
          }),
        ),
      refuse: replay,
      cancel: () =>
        Effect.sync(() => {
          result ??= { toolCount: 0, error: sourceText("error.mcp.relayEnded") };
        }),
    });
  }

  status(memberId: string, flowId: string): SignInRelayView {
    return view(this.#flow(memberId, flowId));
  }

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
    const page = current.authorizeUrl;
    const state = page ? new URL(page).searchParams.get("state") : null;
    if (!page || !state || params.get("state") !== state) return yield* refuse(400, "error.team.signInRelayMismatch");
    flow.completed = true;
    if (params.has("error")) {
      if (flow.target.refuse) yield* flow.target.refuse(params, page);
      yield* flow.target.cancel();
      return view(flow);
    }
    if (!(yield* flow.target.deliver(params, page))) return yield* refuse(400, "error.team.signInRelayMismatch");
    return view(flow);
  });

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
    if (!target.keepsEarlier)
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

export function agentPrintedLink(messages: readonly ConversationMessage[], url: string, now: number): boolean {
  return messages.some((message) => {
    if (message.author !== "agent" && message.author !== "assistant") return false;
    if (!(now - Date.parse(message.createdAt) <= PRINTED_LINK_AGE_MS)) return false;
    for (let at = message.text.indexOf(url); at >= 0; at = message.text.indexOf(url, at + 1))
      if (linkEndsAt(message.text, at + url.length)) return true;
    return false;
  });
}

function linkEndsAt(text: string, end: number): boolean {
  const next = text.charAt(end);
  if (next === "" || /[\s<>"'`)\]]/.test(next)) return true;
  return /[.,;:!?]/.test(next) && (end + 1 === text.length || /[\s<>"'`)\]]/.test(text.charAt(end + 1)));
}

function view(flow: Flow): SignInRelayView {
  const { pageUrl, result } = flow.target.status();
  return { authorizeUrl: pageUrl, callback: pageUrl ? loopbackCallback(pageUrl) : null, result };
}

const replay = Effect.fn("SignInRelayHost.replay")(function* (query: URLSearchParams, pageUrl: string) {
  if (!loopbackCallback(pageUrl)) return false;
  const code = query.get("code");
  if (code) registerSecretValue(code);
  const address = new URL(new URL(pageUrl).searchParams.get("redirect_uri") ?? "");
  address.search = query.toString();
  address.hash = "";
  const answer = yield* load(address, REPLAY_TIMEOUT);
  if (!answer?.delivered) return false;
  if (answer.next?.origin === address.origin) {
    const token = answer.next.searchParams.get("id_token");
    if (token) registerSecretValue(token);
    yield* load(answer.next, SUCCESS_PAGE_TIMEOUT);
  }
  return true;
});

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
