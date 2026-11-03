import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  GoogleConnectionAssignInput,
  GoogleConnectionsSnapshot,
  SignInRelayStatus,
  TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import type { AgentService } from "../backend/agent-service";
import { type AgentAccessStore, agentAccessLevel } from "./agent-access-store";
import type { ConnectorAccessStore } from "./connector-access-store";
import {
  type GoogleAuthAttempt,
  googleConfigFromTemplate,
  readGoogleCredential,
  startGoogleAuth,
} from "./google-auth-process";
import {
  GoogleConnectionsFailure,
  type GoogleConnectionsStore,
  type GoogleOwnedProfile,
  googleEffects,
} from "./google-connections-store";
import type { SignInRelayHost } from "./sign-in-relay-host";
import { HttpError } from "./team-api/http-error";

type Member = Pick<TeamMemberSummary, "id" | "role">;
interface Actor {
  member: Member;
  serverId: string;
}
interface Dependencies {
  store: GoogleConnectionsStore;
  agents: Pick<
    AgentService,
    "listAgents" | "listMcpServers" | "saveMcpServer" | "setMcpServerEnabled" | "revokeConnectorSessions"
  >;
  roles: AgentAccessStore;
  connectors: ConnectorAccessStore;
  relay: SignInRelayHost;
  launch?: typeof startGoogleAuth;
  credential?: typeof readGoogleCredential;
  configure?: typeof googleConfigFromTemplate;
}
interface Flow {
  owner: string;
  profileId: string;
  attempt: GoogleAuthAttempt;
  page: string;
  outcome: { ok: boolean; timedOut: boolean } | null;
  result: SignInRelayStatus["result"];
  expiresAt: number;
}
function refused(status = 400): never {
  throw new HttpError(status, sourceText("error.team.googleConnectionUnavailable"));
}
/** Member-owned enrollment. No member request can select a command, credential path, owner or role. */
export class GoogleConnectionsService {
  readonly #writes = Semaphore.makeUnsafe(1);
  readonly #flows = new Map<string, Flow>();
  #stopping = false;
  constructor(readonly deps: Dependencies) {}
  #owned(actor: Actor, id: string): GoogleOwnedProfile {
    if (this.#stopping || this.deps.store.closed) refused();
    const profile = this.deps.store.read().profiles.find((p) => p.id === id && p.ownerMemberId === actor.member.id);
    if (!profile) refused(404);
    return profile;
  }
  #flow(actor: Actor, id: string): Flow {
    const flow = this.#flows.get(id);
    // This registry deliberately excludes the administrator/provider relay flows.
    if (!flow || flow.owner !== actor.member.id || flow.expiresAt <= Date.now()) refused(404);
    return flow;
  }
  #eligible(actor: Actor, agentId: string, profile?: GoogleOwnedProfile): boolean {
    const { agents, roles, connectors } = this.deps;
    const audience = connectors.audience(agentId);
    if (profile && !roles.personalConnectorRoleAvailable(actor.serverId, actor.member, profile.roleId)) return false;
    try {
      connectors.validate({
        revision: 0,
        rules: [
          {
            mcpServerId: profile?.mcpServerId ?? "google-enrollment",
            agentIds: [agentId],
            roleIds: [],
            everyoneUse: false,
          },
        ],
      });
    } catch {
      return false;
    }
    return (
      agents.listAgents().some((a) => a.id === agentId) &&
      agentAccessLevel(roles.levels(actor.serverId), actor.member, agentId) === "manage" &&
      connectors.memberMaySeeAgent(actor.member, agentId, roles.levels(actor.serverId)) &&
      audience.every((id) => id === profile?.mcpServerId) &&
      !this.deps.store.read().profiles.some((p) => p.id !== profile?.id && p.agentId === agentId)
    );
  }
  snapshot(actor: Actor): GoogleConnectionsSnapshot {
    const state = this.deps.store.read();
    const admin = actor.member.role !== "member";
    if (this.deps.store.closed)
      return { configured: false, canConfigure: false, profiles: [], eligibleAgents: [], templates: [] };
    const mine = state.profiles.filter((p) => p.ownerMemberId === actor.member.id);
    const agents = this.deps.agents.listAgents();
    return {
      configured: state.config !== null,
      canConfigure: admin,
      profiles: mine.map((p) => {
        const visible =
          p.agentId &&
          this.deps.connectors.memberMaySeeAgent(actor.member, p.agentId, this.deps.roles.levels(actor.serverId)) &&
          agentAccessLevel(this.deps.roles.levels(actor.serverId), actor.member, p.agentId) !== "none";
        const flow = [...this.#flows.values()].find((f) => f.profileId === p.id && f.expiresAt > Date.now());
        return {
          id: p.id,
          email: p.email,
          connected: p.connected,
          agentId: visible ? p.agentId : null,
          agentName: visible ? (agents.find((a) => a.id === p.agentId)?.name ?? null) : null,
          eligibleAgentIds: agents.filter((a) => this.#eligible(actor, a.id, p)).map((a) => a.id),
          signingIn: !!flow && !flow.result,
          error: flow?.result?.error ?? null,
        };
      }),
      eligibleAgents: agents
        .filter((a) => this.#eligible(actor, a.id) || mine.some((p) => this.#eligible(actor, a.id, p)))
        .map(({ id, name }) => ({ id, name })),
      templates: admin
        ? this.deps.agents
            .listMcpServers()
            .filter((m) => m.transport === "stdio" && m.args[1] === "serve" && m.args[2] === "--profile")
            .map(({ id, name }) => ({ id, name }))
        : [],
    };
  }
  readonly configure = Effect.fn("GoogleConnections.configure")(function* (
    this: GoogleConnectionsService,
    actor: Actor,
    mcpServerId: string,
  ) {
    return yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        if (actor.member.role === "member") return yield* googleEffects.sync(() => refused(403));
        if (this.deps.store.read().config) return this.snapshot(actor);
        const template = yield* googleEffects.sync(
          () => this.deps.agents.listMcpServers().find((m) => m.id === mcpServerId) ?? refused(404),
        );
        const config = yield* googleEffects.io(() => (this.deps.configure ?? googleConfigFromTemplate)(template));
        // Adopt the selected private installation without changing its account or audience.
        const credential = yield* googleEffects.io(() =>
          (this.deps.credential ?? readGoogleCredential)(config.home, template.args[3] ?? ""),
        );
        const rule = this.deps.connectors.snapshot([]).rules.find((r) => r.mcpServerId === template.id);
        if (!rule || rule.everyoneUse || rule.agentIds.length !== 1 || rule.roleIds.length !== 1)
          return yield* googleEffects.sync(() => refused());
        const imported: GoogleOwnedProfile = {
          id: template.args[3] ?? refused(),
          ownerMemberId: actor.member.id,
          email: credential.email,
          mcpServerId: template.id,
          roleId: rule.roleIds[0] ?? refused(),
          agentId: rule.agentIds[0] ?? refused(),
          connected: true,
        };
        yield* this.deps.roles.registerPersonalConnectorRole(actor.serverId, imported.roleId);
        yield* this.deps.store.update((s) => ({ ...s, config, profiles: [...s.profiles, imported] }));
        return this.snapshot(actor);
      }),
    );
  }).bind(this);
  readonly start = Effect.fn("GoogleConnections.start")(function* (
    this: GoogleConnectionsService,
    actor: Actor,
    profileId: string | null,
  ) {
    return yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          const state = this.deps.store.read();
          if (this.#stopping || this.deps.store.closed || !state.config)
            return yield* googleEffects.sync(() => refused());
          // Expired attempts are stopped before another can consume a process slot.
          for (const [id, f] of this.#flows)
            if (f.expiresAt <= Date.now()) {
              yield* googleEffects.io(() => f.attempt.cancel());
              this.#flows.delete(id);
            }
          if (
            [...this.#flows.values()].some((f) => f.owner === actor.member.id && !f.result) ||
            [...this.#flows.values()].filter((f) => !f.result).length >= 12
          )
            return yield* googleEffects.sync(() => refused(409));
          const profile = profileId
            ? yield* googleEffects.sync(() => this.#owned(actor, profileId))
            : {
                id: `google-${randomUUID()}`,
                ownerMemberId: actor.member.id,
                email: null,
                mcpServerId: null,
                roleId: `google-role-${randomUUID()}`,
                agentId: null,
                connected: false,
              };
          // Reconnect must not overwrite a credential still in use by an agent.
          if (profile.connected) return yield* googleEffects.sync(() => refused(409));
          if (!profileId) {
            if (
              state.profiles.length >= 100 ||
              state.profiles.filter((p) => p.ownerMemberId === actor.member.id).length >= 5
            )
              return yield* googleEffects.sync(() => refused(409));
            yield* this.deps.store.update((s) => ({ ...s, profiles: [...s.profiles, profile] }));
          }
          for (const [id, previous] of this.#flows) if (previous.profileId === profile.id) this.#flows.delete(id);
          const config = state.config;
          const attempt = yield* googleEffects.io(() => (this.deps.launch ?? startGoogleAuth)(config, profile.id));
          const page = yield* googleEffects
            .io(() => attempt.ready)
            .pipe(Effect.onError(() => googleEffects.io(() => attempt.cancel()).pipe(Effect.ignore)));
          const flow: Flow = {
            owner: actor.member.id,
            profileId: profile.id,
            attempt,
            page,
            outcome: null,
            result: null,
            expiresAt: Date.now() + 6 * 60_000,
          };
          const opened = this.deps.relay.startReplay(actor.member.id, {
            key: `google\n${profile.id}`,
            status: () => ({ pageUrl: page, result: flow.result }),
            cancel: () =>
              googleEffects
                .io(() => attempt.cancel())
                .pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      flow.result = { toolCount: 0, error: sourceText("error.team.googleSignInEnded") };
                    }),
                  ),
                  Effect.ignore,
                ),
          });
          this.#flows.set(opened.flowId, flow);
          void attempt.done.then((outcome) => {
            flow.outcome = outcome;
          });
          return { profileId: profile.id, flowId: opened.flowId };
        }),
      ),
    );
  }).bind(this);
  readonly status = Effect.fn("GoogleConnections.status")(function* (
    this: GoogleConnectionsService,
    actor: Actor,
    flowId: string,
  ) {
    return yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const f = yield* googleEffects.sync(() => this.#flow(actor, flowId));
        if (f.outcome && !f.result) {
          const profile = yield* googleEffects.sync(() => this.#owned(actor, f.profileId));
          const config = this.deps.store.read().config;
          const credential =
            f.outcome.ok && config
              ? yield* Effect.result(
                  googleEffects.io(() => (this.deps.credential ?? readGoogleCredential)(config.home, profile.id)),
                )
              : null;
          const c = credential && Result.isSuccess(credential) ? credential.success : null;
          const same =
            c &&
            config &&
            c.clientId === config.clientId &&
            (!profile.email || profile.email.toLowerCase() === c.email.toLowerCase()) &&
            !this.deps.store
              .read()
              .profiles.some((p) => p.id !== profile.id && p.email?.toLowerCase() === c.email.toLowerCase());
          if (same) {
            yield* this.deps.store.update((s) => ({
              ...s,
              profiles: s.profiles.map((p) => (p.id === profile.id ? { ...p, email: c.email, connected: true } : p)),
            }));
            f.result = { toolCount: 0, error: null };
          } else {
            if (config)
              yield* googleEffects.io(() => rm(join(config.home, profile.id, "credentials.json"), { force: true }));
            f.result = { toolCount: 0, error: sourceText("error.team.googleSignInEnded") };
          }
        }
        return yield* googleEffects.sync(() => this.deps.relay.status(actor.member.id, flowId));
      }),
    );
  }).bind(this);
  readonly complete = Effect.fn("GoogleConnections.complete")(function* (
    this: GoogleConnectionsService,
    actor: Actor,
    flowId: string,
    query: string,
  ) {
    yield* googleEffects.sync(() => this.#flow(actor, flowId));
    yield* this.deps.relay
      .complete(actor.member.id, flowId, query)
      .pipe(Effect.mapError((e) => new GoogleConnectionsFailure({ cause: e.cause })));
    return yield* this.status(actor, flowId);
  }).bind(this);
  #discardUnconnected(profileId: string) {
    const state = this.deps.store.read();
    const profile = state.profiles.find((p) => p.id === profileId);
    if (!state.config || !profile || profile.connected) return Effect.void;
    const home = state.config.home;
    return googleEffects.io(() => rm(join(home, profile.id, "credentials.json"), { force: true }));
  }
  readonly cancel = Effect.fn("GoogleConnections.cancel")(function* (
    this: GoogleConnectionsService,
    actor: Actor,
    flowId: string,
  ) {
    yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const flow = yield* googleEffects.sync(() => this.#flow(actor, flowId));
        yield* this.deps.relay.cancel(actor.member.id, flowId).pipe(Effect.ignore);
        yield* this.#discardUnconnected(flow.profileId);
      }),
    );
  }).bind(this);
  readonly assign = Effect.fn("GoogleConnections.assign")(function* (
    this: GoogleConnectionsService,
    actor: Actor,
    input: GoogleConnectionAssignInput,
  ) {
    return yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          const profile = yield* googleEffects.sync(() => this.#owned(actor, input.profileId));
          const config = this.deps.store.read().config;
          if (!profile.connected || !config) return yield* googleEffects.sync(() => refused());
          if (!this.deps.roles.personalConnectorRoleAvailable(actor.serverId, actor.member, profile.roleId))
            return yield* googleEffects.sync(() => refused(403));
          if (input.agentId && !this.#eligible(actor, input.agentId, profile))
            return yield* googleEffects.sync(() => refused(403));
          if (profile.mcpServerId)
            yield* this.deps.agents.setMcpServerEnabled({ mcpServerId: profile.mcpServerId, enabled: false });
          let mcpServerId = profile.mcpServerId;
          if (!mcpServerId) {
            const name = `Google ${profile.id}`;
            const saved = yield* this.deps.agents.saveMcpServer({
              config: {
                id: "",
                name,
                transport: "stdio",
                enabled: false,
                command: config.command,
                args: [config.cliPath, "serve", "--profile", profile.id],
                env: [{ key: "OPENBOT_GOOGLE_HOME", value: config.home }],
                envPassthrough: [],
                workingDirectory: "",
                url: "",
                headers: [],
              },
            });
            mcpServerId = yield* googleEffects.sync(() => saved.find((row) => row.name === name)?.id ?? refused());
          }
          const connectorId = mcpServerId;
          yield* this.deps.store.update((s) => ({
            ...s,
            profiles: s.profiles.map((p) =>
              p.id === profile.id ? { ...p, mcpServerId: connectorId, agentId: null } : p,
            ),
          }));
          // The configuration is disabled until policy, role membership and assignment are durable.
          const snapshot = this.deps.connectors.snapshot([]);
          if (snapshot.closed) return yield* googleEffects.sync(() => refused());
          yield* this.deps.connectors.set(
            {
              revision: snapshot.revision,
              rules: [
                { mcpServerId: connectorId, agentIds: [input.agentId], roleIds: [profile.roleId], everyoneUse: false },
              ],
            },
            () => this.deps.agents.revokeConnectorSessions(),
          );
          yield* this.deps.roles.grantPersonalConnector(actor.serverId, actor.member, profile.roleId, input.agentId);
          yield* this.deps.store.update((s) => ({
            ...s,
            profiles: s.profiles.map((p) =>
              p.id === profile.id ? { ...p, mcpServerId: connectorId, agentId: input.agentId } : p,
            ),
          }));
          yield* this.deps.agents.setMcpServerEnabled({ mcpServerId: connectorId, enabled: true });
          return this.snapshot(actor);
        }),
      ),
    );
  }).bind(this);
  readonly disconnect = Effect.fn("GoogleConnections.disconnect")(function* (
    this: GoogleConnectionsService,
    actor: Actor,
    profileId: string,
  ) {
    return yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          const p = yield* googleEffects.sync(() => this.#owned(actor, profileId));
          for (const f of this.#flows.values())
            if (f.profileId === p.id && !f.result) {
              yield* googleEffects.io(() => f.attempt.cancel());
              f.result = { toolCount: 0, error: sourceText("error.team.googleSignInEnded") };
            }
          if (p.mcpServerId)
            yield* this.deps.agents.setMcpServerEnabled({ mcpServerId: p.mcpServerId, enabled: false });
          yield* this.deps.agents.revokeConnectorSessions();
          yield* this.deps.store.update((s) => ({
            ...s,
            profiles: s.profiles.map((item) =>
              item.id === p.id ? { ...item, connected: false, agentId: null } : item,
            ),
          }));
          const config = this.deps.store.read().config;
          if (config) yield* googleEffects.io(() => rm(join(config.home, p.id, "credentials.json"), { force: true }));
          // Role and sticky connector audiences deliberately survive disconnect.
          return this.snapshot(actor);
        }),
      ),
    );
  }).bind(this);
  readonly close = Effect.fn("GoogleConnections.close")(function* (this: GoogleConnectionsService) {
    this.#stopping = true;
    yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* Effect.all(
          [...this.#flows.values()].map((f) => googleEffects.io(() => f.attempt.cancel()).pipe(Effect.ignore)),
          { concurrency: 2 },
        );
        for (const flow of this.#flows.values()) yield* this.#discardUnconnected(flow.profileId).pipe(Effect.ignore);
        this.#flows.clear();
      }),
    );
  }).bind(this);
}
