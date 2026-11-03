import {
  type ConnectorAccessBinding,
  type ConnectorAccessChange,
  type ConnectorAccessSnapshot,
  decodeConnectorAccessSnapshot,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { Effect, Result, Schema, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import type { AgentAccessState } from "./agent-access-store";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const CONNECTOR_ACCESS_FILE = "openbot-connector-access-v1.json";
export class ConnectorAccessStale extends Schema.TaggedError<ConnectorAccessStale>()("ConnectorAccessStale", {}) {}
export class ConnectorAccessRefused extends Schema.TaggedError<ConnectorAccessRefused>()("ConnectorAccessRefused", {
  reason: Schema.String,
}) {}
export type ConnectorAccessMember = Pick<TeamMemberSummary, "id" | "role">;
interface State {
  revision: number;
  rules: ConnectorAccessBinding[];
}
/** Owns host connector grants and permanent history audience bindings, not role membership. */
export class ConnectorAccessStore {
  #state: State = { revision: 0, rules: [] };
  #closed = false;
  #revoking = false;
  readonly #writes = Semaphore.makeUnsafe(1);
  readonly #listeners = new Set<() => void>();
  constructor(
    readonly path: string,
    readonly validate: (change: ConnectorAccessChange) => void = () => {},
    readonly recovery?: () => { agentIds: string[]; connectorIds: string[] },
  ) {}
  load(): Effect.Effect<boolean, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.path, (value) => {
          if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1) return null;
          return decodeConnectorAccessSnapshot({ ...value, closed: false, connectors: [] });
        }),
      );
      if (Result.isSuccess(loaded)) {
        this.#closed = loaded.success === null;
        if (loaded.success) this.#state = { revision: loaded.success.revision, rules: loaded.success.rules };
      } else if (!isMissingFileError(loaded.failure.cause)) this.#closed = true;
      return !this.#closed;
    });
  }
  snapshot(connectors: readonly { id: string; name: string }[]): ConnectorAccessSnapshot {
    return structuredClone({
      ...this.#state,
      closed: this.#closed || this.#revoking,
      connectors: connectors.map(({ id, name }) => ({ id, name })),
    });
  }
  protected(): boolean {
    return this.#closed || this.#revoking || this.#state.rules.length > 0;
  }
  allows(mcpServerId: string, agentId: string | null | undefined): boolean {
    if (this.#closed || this.#revoking) return false;
    const rule = this.#state.rules.find((item) => item.mcpServerId === mcpServerId);
    return !rule || (agentId !== null && agentId !== undefined && rule.agentIds.includes(agentId));
  }
  audience(agentId: string): string[] {
    if (this.#closed || this.#revoking) return ["connector-policy-unavailable"];
    return this.#state.rules
      .filter((rule) => rule.audienceAgentIds.includes(agentId))
      .map((rule) => rule.mcpServerId)
      .sort();
  }
  sameAudience(left: string, right: string): boolean {
    return (
      !this.#closed && !this.#revoking && JSON.stringify(this.audience(left)) === JSON.stringify(this.audience(right))
    );
  }
  memberMaySeeAgent(member: ConnectorAccessMember, agentId: string, roles: AgentAccessState | "closed"): boolean {
    if (member.role !== "member") return true;
    if (this.#closed || this.#revoking) return false;
    return this.#state.rules
      .filter((rule) => rule.audienceAgentIds.includes(agentId))
      .every(
        (rule) =>
          rule.everyoneUse ||
          (roles !== "closed" &&
            roles.roles.some((role) => rule.roleIds.includes(role.id) && role.memberIds.includes(member.id))),
      );
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  readonly set = Effect.fn("ConnectorAccessStore.set")(function* (
    this: ConnectorAccessStore,
    change: ConnectorAccessChange,
    revoke: () => Effect.Effect<void, unknown>,
  ) {
    return yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          if (this.#closed) {
            const recovery = this.recovery?.();
            if (!recovery)
              return yield* Effect.fail(new Error("Restore a verified connector policy before enabling access."));
            change = {
              revision: change.revision,
              rules: [...new Set([...recovery.connectorIds, "connector-policy-recovery"])].map((mcpServerId) => ({
                mcpServerId,
                agentIds: [],
                roleIds: [],
                everyoneUse: false,
              })),
            };
          }
          yield* Effect.try({
            try: () => this.validate(change),
            catch: (error) =>
              new ConnectorAccessRefused({
                reason: error instanceof Error ? error.message : "Invalid connector assignment.",
              }),
          });
          if (change.revision !== this.#state.revision) return yield* new ConnectorAccessStale();
          const byId = new Map(this.#state.rules.map((rule) => [rule.mcpServerId, rule]));
          for (const rule of change.rules) {
            const previous = byId.get(rule.mcpServerId);
            byId.set(rule.mcpServerId, {
              ...rule,
              audienceAgentIds: [
                ...new Set([
                  ...(previous?.audienceAgentIds ?? []),
                  ...rule.agentIds,
                  ...(this.#closed ? (this.recovery?.().agentIds ?? []) : []),
                ]),
              ],
            });
          }
          const next = { revision: this.#state.revision + 1, rules: [...byId.values()] };
          // Close native handoffs before the first asynchronous write. Validation and this barrier
          // share one synchronous step, so a copy/export cannot start between them.
          this.#revoking = true;
          for (const listener of this.#listeners) listener();
          yield* writePreferenceFile(this.path, { version: 1, ...next });
          this.#state = structuredClone(next);
          this.#closed = false;
          // Policy is visible before old provider processes stop. Saving completes only after revocation.
          for (const listener of this.#listeners) listener();
          yield* revoke();
          this.#revoking = false;
          for (const listener of this.#listeners) listener();
          return this.snapshot([]);
        }),
      ),
    );
  }).bind(this);
}
