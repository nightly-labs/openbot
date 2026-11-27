import type { TeamMemberSummary, TeamRole } from "@openbot/contracts/ipc";
import type { WatchPushEnvironment } from "@openbot/contracts/watch-protocol";
import { toLogValue } from "@openbot/logging";
import { Effect, Exit, Schema, Scope } from "effect";
import type { TeamApiAgents } from "./team-api/dependencies";
import { WATCH_READ_OPTIONS, type WatchRelayMember } from "./watch-relay-commands";

const EVENT_DELAY_MS = 2_000;
const WAIT_INTERVAL_MS = 10_000;
const CHANGE_INTERVAL_MS = 60_000;
const TOKEN_LIFETIME_MS = 12 * 60 * 60_000;
const TOKENS_PER_MEMBER = 5;

export interface WatchWidgetPush {
  token: string;
  environment: WatchPushEnvironment;
}

type WatchWidgetPushAgents = Pick<
  TeamApiAgents,
  "on" | "off" | "listAgents" | "getRuntimeSnapshot" | "pendingPrompts" | "listConversationReads"
>;

export interface WatchWidgetPushOptions {
  agents: WatchWidgetPushAgents;
  hiddenAgentIds(member: { id: string; role: TeamRole }): ReadonlySet<string>;
  member(memberId: string): TeamMemberSummary | null;
  send(push: WatchWidgetPush): Effect.Effect<"sent" | "gone", WatchWidgetPushFailure>;
  now?: () => number;
  logger?: { warn(message: string, ...values: unknown[]): void };
}

interface AgentView {
  state: "waiting" | "working" | "idle";
  waits: string[];
  reply: string | null;
  updatedAt: string | null;
  unread: number;
}

interface WidgetToken {
  push: WatchWidgetPush;
  registeredAt: number;
  sentAt: number | null;
  timer: { handle: ReturnType<typeof setTimeout>; at: number } | null;
  urgent: boolean;
  sending: boolean;
  again: boolean;
}

interface WatchMember {
  id: string;
  role: TeamRole;
  known: boolean;
  view: Map<string, AgentView>;
  tokens: Map<string, WidgetToken>;
}

export class WatchWidgetPushService {
  readonly #options: WatchWidgetPushOptions;
  readonly #now: () => number;
  readonly #members = new Map<string, WatchMember>();
  readonly #listener = () => this.#scheduleFlush();
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #expiryTimer: { handle: ReturnType<typeof setTimeout>; at: number } | null = null;
  #scope = Scope.makeUnsafe();
  #listening = false;

  constructor(options: WatchWidgetPushOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  register(relayMember: WatchRelayMember, push: WatchWidgetPush): void {
    const now = this.#now();
    const existing = this.#members.get(relayMember.id);
    const member: WatchMember = existing ?? {
      id: relayMember.id,
      role: relayMember.role,
      known: this.#options.member(relayMember.id) !== null,
      view: new Map(),
      tokens: new Map(),
    };
    member.role = relayMember.role;
    if (!existing) {
      member.view = this.#view(member);
      this.#members.set(member.id, member);
    }
    const token = member.tokens.get(push.token) ?? {
      push,
      registeredAt: now,
      sentAt: null,
      timer: null,
      urgent: false,
      sending: false,
      again: false,
    };
    token.push = push;
    token.registeredAt = now;
    member.tokens.delete(push.token);
    member.tokens.set(push.token, token);
    for (const [token, entry] of member.tokens) {
      if (member.tokens.size <= TOKENS_PER_MEMBER) break;
      this.#clearTimer(entry);
      member.tokens.delete(token);
    }
    this.#listen();
    this.#scheduleExpiry();
  }

  tokenCount(memberId: string): number {
    return this.#members.get(memberId)?.tokens.size ?? 0;
  }

  readonly dispose = Effect.fn("WatchWidgetPush.dispose")(function* (this: WatchWidgetPushService) {
    for (const member of [...this.#members.values()]) this.#forgetMember(member);
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
  }, Effect.uninterruptible);

  #scheduleFlush(): void {
    if (this.#flushTimer || this.#members.size === 0) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flush();
    }, EVENT_DELAY_MS);
    this.#flushTimer.unref?.();
  }

  #flush(): void {
    this.#forgetExpired();
    for (const member of [...this.#members.values()]) {
      if (!this.#memberActive(member)) {
        this.#forgetMember(member);
        continue;
      }
      const view = this.#view(member);
      const change = viewChange(member.view, view);
      member.view = view;
      if (change === "none") continue;
      for (const token of member.tokens.values()) this.#request(member, token, change === "wait");
    }
  }

  #memberActive(member: WatchMember): boolean {
    const stored = this.#options.member(member.id);
    if (stored) {
      member.known = true;
      return !stored.disabled;
    }
    return !member.known;
  }

  #view(member: WatchMember): Map<string, AgentView> {
    const { agents } = this.#options;
    const hidden = this.#options.hiddenAgentIds({ id: member.id, role: member.role });
    const runtime = agents.getRuntimeSnapshot();
    const prompts = agents.pendingPrompts();
    const reads = agents.listConversationReads(member.id, WATCH_READ_OPTIONS);
    const view = new Map<string, AgentView>();
    for (const agent of agents.listAgents()) {
      if (hidden.has(agent.id)) continue;
      const waits = [...runtime.pendingApprovals, ...prompts, ...runtime.pendingBrowserTakeovers]
        .filter((item) => item.agentId === agent.id)
        .map((item) => String(item.requestId));
      const working =
        runtime.activeTurns.some((item) => item.agentId === agent.id) ||
        runtime.work.some((item) => item.agentId === agent.id && item.status !== "failed");
      view.set(agent.id, {
        state: waits.length > 0 ? "waiting" : working ? "working" : "idle",
        waits,
        reply: runtime.latestMessages.find((item) => item.agentId === agent.id)?.id ?? null,
        updatedAt: agent.updatedAt,
        unread: reads[agent.id]?.unreadCount ?? 0,
      });
    }
    return view;
  }

  #request(member: WatchMember, token: WidgetToken, urgent: boolean): void {
    token.urgent ||= urgent;
    if (token.sending) {
      token.again = true;
      return;
    }
    const now = this.#now();
    const interval = token.urgent ? WAIT_INTERVAL_MS : CHANGE_INTERVAL_MS;
    const at = token.sentAt === null ? now : Math.max(now, token.sentAt + interval);
    if (token.timer && token.timer.at <= at) return;
    this.#clearTimer(token);
    const handle = setTimeout(() => {
      token.timer = null;
      Effect.runFork(
        this.#send(member, token).pipe(Effect.uninterruptible, Effect.forkIn(this.#scope, { startImmediately: true })),
      );
    }, at - now);
    handle.unref?.();
    token.timer = { handle, at };
  }

  readonly #send = Effect.fn("WatchWidgetPush.send")(function* (
    this: WatchWidgetPushService,
    member: WatchMember,
    token: WidgetToken,
  ) {
    if (this.#members.get(member.id) !== member || member.tokens.get(token.push.token) !== token) return;
    token.sending = true;
    token.urgent = false;
    token.again = false;
    token.sentAt = this.#now();
    yield* this.#options.send(token.push).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result === "gone") this.#forgetToken(member, token);
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => this.#options.logger?.warn("Watch widget push was not sent:", toLogValue(error.cause))),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          token.sending = false;
          if (token.again && member.tokens.get(token.push.token) === token) this.#request(member, token, false);
        }),
      ),
    );
  });

  #forgetExpired(): void {
    const oldest = this.#now() - TOKEN_LIFETIME_MS;
    for (const member of [...this.#members.values()]) {
      for (const token of [...member.tokens.values()]) {
        if (token.registeredAt <= oldest) this.#forgetToken(member, token);
      }
    }
  }

  #scheduleExpiry(): void {
    let first = Number.POSITIVE_INFINITY;
    for (const member of this.#members.values()) {
      for (const token of member.tokens.values()) first = Math.min(first, token.registeredAt + TOKEN_LIFETIME_MS);
    }
    if (this.#expiryTimer && this.#expiryTimer.at === first) return;
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer.handle);
    this.#expiryTimer = null;
    if (!Number.isFinite(first)) return;
    const handle = setTimeout(
      () => {
        this.#expiryTimer = null;
        this.#forgetExpired();
        for (const member of [...this.#members.values()]) {
          if (!this.#memberActive(member)) this.#forgetMember(member);
        }
        this.#scheduleExpiry();
      },
      Math.max(0, first - this.#now()),
    );
    handle.unref?.();
    this.#expiryTimer = { handle, at: first };
  }

  #forgetToken(member: WatchMember, token: WidgetToken): void {
    this.#clearTimer(token);
    if (member.tokens.get(token.push.token) === token) member.tokens.delete(token.push.token);
    if (member.tokens.size === 0) this.#forgetMember(member);
  }

  #forgetMember(member: WatchMember): void {
    for (const token of member.tokens.values()) this.#clearTimer(token);
    member.tokens.clear();
    if (this.#members.get(member.id) === member) this.#members.delete(member.id);
    if (this.#members.size > 0) return;
    if (this.#listening) {
      this.#options.agents.off("event", this.#listener);
      this.#listening = false;
    }
    if (this.#expiryTimer) clearTimeout(this.#expiryTimer.handle);
    this.#expiryTimer = null;
  }

  #clearTimer(token: WidgetToken): void {
    if (token.timer) clearTimeout(token.timer.handle);
    token.timer = null;
  }

  #listen(): void {
    if (this.#listening) return;
    this.#options.agents.on("event", this.#listener);
    this.#listening = true;
  }
}

function viewChange(before: Map<string, AgentView>, after: Map<string, AgentView>): "none" | "change" | "wait" {
  let change: "none" | "change" = before.size === after.size ? "none" : "change";
  for (const [agentId, now] of after) {
    const was = before.get(agentId);
    if (now.waits.some((wait) => !was?.waits.includes(wait))) return "wait";
    if (
      !was ||
      was.state !== now.state ||
      was.waits.length !== now.waits.length ||
      was.reply !== now.reply ||
      was.updatedAt !== now.updatedAt ||
      now.unread > was.unread
    )
      change = "change";
  }
  return change;
}

export class WatchWidgetPushFailure extends Schema.TaggedError<WatchWidgetPushFailure>()("WatchWidgetPushFailure", {
  cause: Schema.Defect(),
}) {}
