import { readFile } from "node:fs/promises";
import type {
  AgentPublicationPreview,
  AgentSubmission,
  AgentSummary,
  AvatarImageInput,
  InstallMarketplaceAgentInput,
  InstallMarketplaceAgentResult,
  MarketplaceAgentDetail,
  MarketplaceAgentPage,
  MarketplaceAgentQuery,
  MarketplaceAgentSkill,
  RoutineSchedule,
  SubmitMarketplaceAgentInput,
} from "@openbot/contracts/ipc";
import {
  decodeMarketplaceAgentDetail,
  decodeMarketplaceAgentPage,
  isAvatarHue,
  isAvatarSeed,
  isSkillCategory,
  marketplaceQueryParams,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { causeHelpers } from "../backend/effect-boundary";
import type { CentralAuthOperationError } from "./central-auth-effects";
import type { SkillMarketplaceFailure } from "./skill-marketplace-service";

interface AgentMarketplaceAuth {
  requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Effect.Effect<T, CentralAuthOperationError>;
  downloadAuthorized(path: string): Effect.Effect<Uint8Array, CentralAuthOperationError>;
  resolveApiUrl(path: string): string;
}

interface AgentMarketplaceAgents {
  listAgents(): AgentSummary[];
  listRoutines(agentId: string): Array<{
    id: string;
    name: string;
    instruction: string;
    active: boolean;
    trigger: { schedule: RoutineSchedule };
  }>;
  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"] } | null;
  createAgentProfile(input: {
    name: string;
    title?: string;
    description: string;
    avatarSeed: string;
    avatarHue: MarketplaceAgentDetail["avatarHue"];
  }): Effect.Effect<AgentSummary, AgentLifecycleFailed>;
  updateAgent(input: {
    agentId: string;
    name: string;
    title: string;
    description: string;
    avatarSeed: string;
    avatarHue: MarketplaceAgentDetail["avatarHue"];
  }): Effect.Effect<AgentSummary, AgentLifecycleFailed>;
  setAvatar(agentId: string, image: AvatarImageInput | null): Effect.Effect<AgentSummary, AgentLifecycleFailed>;
  createRoutine(
    input: {
      agentId: string;
      name: string;
      instruction: string;
      active: boolean;
      timezone: string;
      schedule: RoutineSchedule;
    },
    options?: { recordConversationEvent?: boolean },
  ): { id: string };
  deleteRoutine(
    input: { agentId: string; routineId: string },
    options?: { recordConversationEvent?: boolean },
  ): Effect.Effect<void, AgentLifecycleFailed>;
  setMarketplaceSource(agentId: string, source: NonNullable<AgentSummary["marketplaceSource"]>): AgentSummary;
  deleteAgent(agentId: string): Effect.Effect<void, AgentLifecycleFailed>;
}

interface AgentMarketplaceSkills {
  listPublishable(agentId: string): Effect.Effect<MarketplaceAgentSkill[], SkillMarketplaceFailure>;
  installVersion(input: {
    agentId: string;
    skillId: string;
    versionId: string;
  }): Effect.Effect<unknown, SkillMarketplaceFailure>;
  uninstall(input: { agentId: string; skillId: string }): Effect.Effect<void, SkillMarketplaceFailure>;
}

export class AgentMarketplaceService {
  constructor(
    private readonly auth: AgentMarketplaceAuth,
    private readonly agents: AgentMarketplaceAgents,
    private readonly skills: AgentMarketplaceSkills,
  ) {}

  list(query: MarketplaceAgentQuery = {}): Effect.Effect<MarketplaceAgentPage, AgentMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceAgentPage, AgentMarketplaceFailure> {
      const params = marketplaceQueryParams(query);
      const page = yield* this.auth
        .requestAuthorized(`/v1/marketplace/agents/?${params}`, { method: "GET" }, decodeMarketplaceAgentPage)
        .pipe(toAgentMarketplaceFailure);
      return { ...page, agents: page.agents.map((agent) => this.withAbsoluteAvatar(agent)) };
    });
  }

  get(listingId: string): Effect.Effect<MarketplaceAgentDetail, AgentMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceAgentDetail, AgentMarketplaceFailure> {
      const detail = yield* this.auth
        .requestAuthorized(
          `/v1/marketplace/agents/${encodeURIComponent(listingId)}`,
          { method: "GET" },
          decodeMarketplaceAgentDetail,
        )
        .pipe(toAgentMarketplaceFailure);
      return this.withAbsoluteAvatar(detail);
    });
  }

  listMine(): Effect.Effect<AgentSubmission[], AgentMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentSubmission[], AgentMarketplaceFailure> {
      const values = yield* this.auth
        .requestAuthorized("/v1/marketplace/agents/mine", { method: "GET" }, decodeAgentSubmissions)
        .pipe(toAgentMarketplaceFailure);
      return values.map((value) => this.withAbsoluteAvatar(value));
    });
  }

  preview(agentId: string): Effect.Effect<AgentPublicationPreview, AgentMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentPublicationPreview, AgentMarketplaceFailure> {
      const agent = this.agents.listAgents().find((candidate) => candidate.id === agentId);
      if (!agent)
        return yield* new AgentMarketplaceFailure({ cause: new Error(sourceText("error.skill.chooseLocalAgent")) });
      const skills = yield* this.skills.listPublishable(agentId).pipe(toAgentMarketplaceFailure);
      const routines = this.agents.listRoutines(agentId).map(({ name, instruction, active, trigger }) => ({
        name,
        instruction,
        active,
        schedule: trigger.schedule,
      }));
      return {
        agentId: agentId,
        name: agent.name,
        title: agent.title,
        description: agent.description,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        avatarUrl: agent.avatarUrl,
        skills,
        routines,
      };
    });
  }

  submit(input: SubmitMarketplaceAgentInput): Effect.Effect<AgentSubmission, AgentMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentSubmission, AgentMarketplaceFailure> {
      const snapshot = yield* this.preview(input.agentId);
      const form = new FormData();
      if (input.category) form.set("category", input.category);
      if (input.showCreatorAvatar !== undefined) form.set("showCreatorAvatar", String(input.showCreatorAvatar));
      form.set("snapshot", JSON.stringify(toMarketplaceSnapshotWire(snapshot)));
      // The multipart field names the marketplace listing being updated, and is the deployed spelling.
      if (input.listingId) form.set("agentId", input.listingId);
      const avatar = this.agents.resolveAvatar(input.agentId);
      if (avatar) {
        const bytes = new Uint8Array(yield* marketplaceIO(() => readFile(avatar.path)));
        form.set("avatar", new Blob([toArrayBuffer(bytes)], { type: avatar.mimeType }), "avatar");
      }
      const submission = yield* this.auth
        .requestAuthorized("/v1/marketplace/agents/", { method: "POST", body: form }, decodeAgentSubmission, 30_000)
        .pipe(toAgentMarketplaceFailure);
      return this.withAbsoluteAvatar(submission);
    });
  }

  install(input: InstallMarketplaceAgentInput): Effect.Effect<InstallMarketplaceAgentResult, AgentMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      InstallMarketplaceAgentResult,
      AgentMarketplaceFailure
    > {
      if (!validTimezone(input.timezone))
        return yield* new AgentMarketplaceFailure({
          cause: new Error(sourceText("error.marketplace.timezoneInvalid")),
        });
      const detail = yield* this.get(input.listingId);
      const existing = input.agentId
        ? this.agents.listAgents().find((candidate) => candidate.id === input.agentId)
        : undefined;
      if (input.agentId && !existing)
        return yield* new AgentMarketplaceFailure({
          cause: new Error(sourceText("error.marketplace.installedAgentMissing")),
        });
      if (existing?.marketplaceSource?.listingId !== detail.id) {
        if (existing)
          return yield* new AgentMarketplaceFailure({
            cause: new Error(sourceText("error.marketplace.differentListing")),
          });
      }
      if (existing?.marketplaceSource?.versionId === detail.versionId) return { agent: existing };

      let avatar: AvatarImageInput | null = null;
      if (detail.avatarUrl) {
        const avatarUrl = detail.avatarUrl;
        const bytes = yield* this.auth.downloadAuthorized(avatarUrl).pipe(toAgentMarketplaceFailure);
        const mimeType = imageMimeType(bytes);
        if (!mimeType)
          return yield* new AgentMarketplaceFailure({
            cause: new Error(sourceText("error.marketplace.marketplaceAvatarInvalid")),
          });
        avatar = { mimeType, bytes };
      }
      let agent =
        existing ??
        (yield* this.agents
          .createAgentProfile({
            name: detail.name,
            title: detail.title,
            description: detail.description,
            avatarSeed: detail.avatarSeed,
            avatarHue: detail.avatarHue,
          })
          .pipe(toAgentMarketplaceFailure));
      const createdRoutineIds: string[] = [];
      {
        const outcome = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            for (const skill of detail.skills) {
              yield* this.skills
                .installVersion({ agentId: agent.id, skillId: skill.skillId, versionId: skill.versionId })
                .pipe(toAgentMarketplaceFailure);
            }
            for (const routine of detail.routines) {
              const created = yield* marketplaceSync(() =>
                this.agents.createRoutine(
                  {
                    agentId: agent.id,
                    name: routine.name,
                    instruction: routine.instruction,
                    active: routine.active,
                    timezone: input.timezone,
                    schedule: localSchedule(routine.schedule),
                  },
                  { recordConversationEvent: false },
                ),
              );
              createdRoutineIds.push(created.id);
            }
            if (existing) {
              agent = yield* this.agents
                .updateAgent({
                  agentId: agent.id,
                  name: detail.name,
                  title: detail.title,
                  description: detail.description,
                  avatarSeed: detail.avatarSeed,
                  avatarHue: detail.avatarHue,
                })
                .pipe(toAgentMarketplaceFailure);
            }
            agent = yield* this.agents.setAvatar(agent.id, avatar).pipe(toAgentMarketplaceFailure);
            const nextSkillIds = new Set(detail.skills.map((skill) => skill.skillId));
            for (const skillId of existing?.marketplaceSource?.skillIds ?? []) {
              if (!nextSkillIds.has(skillId))
                yield* this.skills.uninstall({ agentId: agent.id, skillId }).pipe(toAgentMarketplaceFailure);
            }
            agent = yield* marketplaceSync(() =>
              this.agents.setMarketplaceSource(agent.id, {
                listingId: detail.id,
                versionId: detail.versionId,
                version: detail.version,
                skillIds: [...nextSkillIds],
                routineIds: createdRoutineIds,
              }),
            );
            for (const routineId of existing?.marketplaceSource?.routineIds ?? []) {
              yield* this.agents
                .deleteRoutine({ agentId: agent.id, routineId }, { recordConversationEvent: false })
                .pipe(Effect.catch(() => Effect.void));
            }
          }),
        );
        if (Result.isFailure(outcome)) {
          const error = outcome.failure.cause;
          if (existing) {
            yield* Effect.forEach(
              createdRoutineIds,
              (routineId) =>
                this.agents
                  .deleteRoutine({ agentId: agent.id, routineId }, { recordConversationEvent: false })
                  .pipe(Effect.catch(() => Effect.void)),
              { concurrency: "unbounded" },
            );
          } else {
            yield* this.agents.deleteAgent(agent.id).pipe(Effect.catch(() => Effect.void));
          }
          return yield* new AgentMarketplaceFailure({ cause: error });
        }
      }
      if (!existing) {
        yield* this.auth
          .requestAuthorized(
            `/v1/marketplace/agents/${encodeURIComponent(detail.id)}/install`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ receiptId: input.receiptId }),
            },
            decodeInstallReceipt,
          )
          .pipe(toAgentMarketplaceFailure);
      }
      return { agent: agent };
    });
  }

  private withAbsoluteAvatar<T extends { avatarUrl: string | null; creatorAvatarUrl?: string | null }>(value: T): T {
    return {
      ...value,
      ...(value.creatorAvatarUrl ? { creatorAvatarUrl: this.auth.resolveApiUrl(value.creatorAvatarUrl) } : {}),
      avatarUrl: value.avatarUrl ? this.auth.resolveApiUrl(value.avatarUrl) : null,
    };
  }
}

export function localSchedule(schedule: RoutineSchedule): RoutineSchedule {
  return schedule.kind === "interval" ? { ...schedule, anchorAt: new Date().toISOString() } : structuredClone(schedule);
}

export function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function imageMimeType(bytes: Uint8Array): AvatarImageInput["mimeType"] | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
    return "image/webp";
  return null;
}

function decodeAgentSubmissions(value: unknown): AgentSubmission[] {
  if (!Array.isArray(value) || !value.every(isAgentSubmissionWire)) throw new Error("Invalid agent submissions.");
  return value.map(toCurrentSubmission);
}

function decodeAgentSubmission(value: unknown): AgentSubmission {
  if (!isAgentSubmissionWire(value)) throw new Error("Invalid agent submission.");
  return toCurrentSubmission(value);
}

function toCurrentSubmission({ agentId, ...rest }: AgentSubmissionWire): AgentSubmission {
  return { ...rest, listingId: agentId };
}

function decodeInstallReceipt(value: unknown): { installed: true } {
  if (!isDynamicRecord(value) || value.installed !== true) throw new Error("Invalid agent install receipt.");
  return { installed: true };
}

/**
 * The published snapshot and the submission the account Worker returns still spell the two ids the way
 * the deployed Worker does: `agentId` for the local agent inside a snapshot, `agentId` for the
 * marketplace listing. A Worker deploy can land either side of a desktop release, so the two
 * converters here are the only place the desktop's `agentId`/`listingId` vocabulary meets that wire.
 */
type AgentSubmissionWire = Omit<AgentSubmission, "listingId"> & { agentId: string };

type MarketplaceSnapshotWire = Omit<AgentPublicationPreview, "agentId"> & { botId: string };

function toMarketplaceSnapshotWire({ agentId, ...rest }: AgentPublicationPreview): MarketplaceSnapshotWire {
  return { ...rest, botId: agentId, avatarUrl: null };
}

function isAgentSubmissionWire(value: unknown): value is AgentSubmissionWire {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.agentId) &&
    (value.category === undefined || isSkillCategory(value.category)) &&
    (value.showCreatorAvatar === undefined || isBoolean(value.showCreatorAvatar)) &&
    isString(value.name) &&
    isString(value.title) &&
    isString(value.description) &&
    isNumber(value.version) &&
    isOneOf(["pending", "approved", "rejected"], value.status) &&
    (value.rejectionNote === null || isString(value.rejectionNote)) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue)) &&
    (value.avatarUrl === null || isString(value.avatarUrl)) &&
    isNumber(value.skillCount) &&
    isNumber(value.routineCount) &&
    isNumber(value.activeRoutineCount) &&
    isString(value.createdAt)
  );
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export class AgentMarketplaceFailure extends Schema.TaggedError<AgentMarketplaceFailure>()("AgentMarketplaceFailure", {
  cause: Schema.Defect(),
}) {}

const {
  io: marketplaceIO,
  sync: marketplaceSync,
  rewrap: toAgentMarketplaceFailure,
} = causeHelpers(AgentMarketplaceFailure);
