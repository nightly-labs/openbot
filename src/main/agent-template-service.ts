import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  agentTemplateShareOrigin,
  createAgentTemplateShareUrl,
  isAgentTemplateId,
} from "@openbot/contracts/agent-template-links";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_TEMPLATE_LIMITS,
  type AgentSummary,
  type AgentTemplateDetail,
  type AgentTemplatePreview,
  type AgentTemplatePublication,
  type AgentTemplateSkill,
  type AgentTemplateSnapshot,
  type AgentTemplateSnapshotProblem,
  type AvatarImageInput,
  agentTemplateSnapshotProblem,
  decodeAgentTemplateDetail,
  type InstallAgentTemplateInput,
  type InstallAgentTemplateResult,
  isAgentTemplateCardPng,
  isAgentTemplateSnapshot,
  isReleasedRoutineSchedule,
  type MarketplaceSkillDetail,
  type PublishAgentTemplateInput,
  type RoutineSchedule,
  toAgentTemplateSnapshot,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { containsSecret } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { causeHelpers } from "../backend/effect-boundary";
import { imageMimeType, localSchedule, toArrayBuffer, validTimezone } from "./agent-marketplace-service";
import type { CentralAuthOperationError } from "./central-auth-effects";
import type { LocalSkillLibrary } from "./local-skill-library";
import { MANAGED_SKILL_SLUGS } from "./managed-skill-service";
import type { SkillMarketplaceFailure } from "./skill-marketplace-service";
import { inspectSkillMarkdown, normalizedFiles, renameSkill } from "./skill-package";

function snapshotProblemText(problem: AgentTemplateSnapshotProblem): string {
  switch (problem.kind) {
    case "name":
      return sourceText("error.marketplace.templateName", { count: INPUT_LIMITS.agentName });
    case "title":
      return sourceText("error.marketplace.templateRole", { count: INPUT_LIMITS.agentTitle });
    case "noInstructions":
      return sourceText("error.marketplace.templateNoInstructions");
    case "instructions":
      return sourceText("error.marketplace.templateInstructions", { count: INPUT_LIMITS.agentDescription });
    case "avatar":
      return sourceText("error.marketplace.templateAvatar");
    case "skills":
      return sourceText("error.marketplace.templateSkills", { count: AGENT_TEMPLATE_LIMITS.skills });
    case "localSkills":
      return sourceText("error.marketplace.templateLocalSkills", { count: AGENT_TEMPLATE_LIMITS.embeddedSkills });
    case "skill":
      return sourceText("error.marketplace.templateSkill", { name: problem.name });
    case "routines":
      return sourceText("error.marketplace.templateRoutines", { count: INPUT_LIMITS.agentRoutines });
    case "routine":
      return sourceText("error.marketplace.templateRoutine", {
        name: problem.name || sourceText("error.marketplace.templateRoutineNoName"),
        count: INPUT_LIMITS.routineName,
      });
    case "tooLarge":
      return sourceText("error.marketplace.templateTooLarge");
  }
}

const SKILL_STAGING = ".openbot/template-skills";

interface AgentTemplateAuth {
  requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Effect.Effect<T, CentralAuthOperationError>;
  downloadAuthorized(path: string): Effect.Effect<Uint8Array, CentralAuthOperationError>;
  resolveApiUrl(path: string): string;
}

type AgentTemplateCatalog = Pick<AgentTemplateAuth, "requestAuthorized" | "downloadAuthorized">;

interface AgentTemplateAgents {
  listAgents(): AgentSummary[];
  listRoutines(agentId: string): Array<{
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
    avatarHue: AgentTemplateSnapshot["avatarHue"];
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
  deleteAgent(agentId: string): Effect.Effect<void, AgentLifecycleFailed>;
}

interface AgentTemplateSkills {
  listTemplateSkills(agentId: string): Effect.Effect<AgentTemplateSkill[], SkillMarketplaceFailure>;
  installVersion(input: {
    agentId: string;
    skillId: string;
    versionId: string;
  }): Effect.Effect<unknown, SkillMarketplaceFailure>;
  library(): Pick<
    LocalSkillLibrary,
    "list" | "create" | "revise" | "bundle" | "withdraw" | "templateOrigin" | "recordTemplateOrigin"
  >;
  installLocal(input: {
    agentId: string;
    skillId: string;
    revision: number;
  }): Effect.Effect<unknown, SkillMarketplaceFailure>;
}

interface OwnedTemplate {
  id: string;
  sourceAgentId: string;
  updatedAt: string;
}

export class AgentTemplateService {
  constructor(
    private readonly auth: AgentTemplateAuth,
    private readonly agents: AgentTemplateAgents,
    private readonly skills: AgentTemplateSkills,
    private readonly catalog: AgentTemplateCatalog = auth,
  ) {}

  preview(agentId: string): Effect.Effect<AgentTemplatePreview, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplatePreview, AgentTemplateFailure> {
      const agent = yield* templateSync(() => this.requireAgent(agentId));
      const [owned, skills, avatarImage] = yield* Effect.all(
        [
          this.owned(agentId).pipe(Effect.catch(() => Effect.succeed(null))),
          this.skills
            .listTemplateSkills(agentId)
            .pipe(toAgentTemplateFailure)
            .pipe(
              Effect.map((value) => ({ value, error: null })),
              Effect.catch((error) => Effect.succeed({ value: [], error: message(error.cause) })),
            ),
          this.readAvatar(agentId).pipe(Effect.catch(() => Effect.succeed(null))),
        ],
        { concurrency: "unbounded" },
      );
      const skillsError = skills.error;
      return {
        ...this.profile(agent, skills.value),
        agentId,
        avatarUrl: agent.avatarUrl,
        avatarImage,
        updatedAt: agent.updatedAt,
        publication: owned ? this.publication(owned) : null,
        skillsError,
      };
    });
  }

  publish({ agentId, card }: PublishAgentTemplateInput): Effect.Effect<AgentTemplatePublication, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplatePublication, AgentTemplateFailure> {
      if (card && !isAgentTemplateCardPng(card))
        return yield* new AgentTemplateFailure({ cause: new Error(sourceText("error.marketplace.shareCardInvalid")) });
      const agent = yield* templateSync(() => this.requireAgent(agentId));
      const snapshot = yield* this.snapshot(agent);
      const problem = agentTemplateSnapshotProblem(snapshot);
      if (problem) return yield* new AgentTemplateFailure({ cause: new Error(snapshotProblemText(problem)) });
      if (!isAgentTemplateSnapshot(snapshot))
        return yield* new AgentTemplateFailure({ cause: new Error(sourceText("error.marketplace.cannotPublish")) });
      yield* templateSync(() => assertNoSecrets(snapshot));
      const form = new FormData();
      form.set("snapshot", JSON.stringify(snapshot));
      form.set("sourceAgentId", agentId);
      const avatar = yield* this.readAvatar(agentId);
      if (avatar) form.set("avatar", new Blob([toArrayBuffer(avatar.bytes)], { type: avatar.mimeType }), "avatar");
      if (card) form.set("card", new Blob([toArrayBuffer(card)], { type: "image/png" }), "card.png");
      const owned = yield* this.auth
        .requestAuthorized("/v1/agent-templates/", { method: "POST", body: form }, decodeOwnedTemplate, 30_000)
        .pipe(toAgentTemplateFailure);
      return this.publication(owned);
    });
  }

  unpublish(agentId: string): Effect.Effect<void, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, AgentTemplateFailure> {
      const owned = yield* this.owned(agentId);
      if (!owned) return;
      yield* this.auth
        .requestAuthorized(`/v1/agent-templates/${encodeURIComponent(owned.id)}`, { method: "DELETE" }, decodeDeleted)
        .pipe(toAgentTemplateFailure);
    });
  }

  get(templateId: string): Effect.Effect<AgentTemplateDetail, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplateDetail, AgentTemplateFailure> {
      if (!isAgentTemplateId(templateId))
        return yield* new AgentTemplateFailure({ cause: new Error(sourceText("error.marketplace.linkInvalid")) });
      const detail = yield* this.catalog
        .requestAuthorized(
          `/v1/agent-templates/${encodeURIComponent(templateId)}`,
          { method: "GET" },
          decodeAgentTemplateDetail,
        )
        .pipe(toAgentTemplateFailure);
      return {
        ...detail,
        skills: detail.skills.filter((skill) => skill.kind !== "embedded" || !MANAGED_SKILL_SLUGS.has(skill.slug)),
        avatarUrl: detail.avatarUrl ? this.auth.resolveApiUrl(detail.avatarUrl) : null,
      };
    });
  }

  install(input: InstallAgentTemplateInput): Effect.Effect<InstallAgentTemplateResult, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstallAgentTemplateResult, AgentTemplateFailure> {
      if (!validTimezone(input.timezone))
        return yield* new AgentTemplateFailure({ cause: new Error(sourceText("error.marketplace.timezoneInvalid")) });
      const detail = yield* this.get(input.templateId);
      if (detail.updatedAt !== input.expectedUpdatedAt)
        return yield* new AgentTemplateFailure({
          cause: new Error(sourceText("error.marketplace.changedSinceOpened")),
        });
      const library = yield* templateSync(() => this.skills.library());
      const localSkills = yield* library.list().pipe(toAgentTemplateFailure);
      const latestText = (skill: MarketplaceSkillDetail) =>
        library.bundle(skill.id, skill.version).pipe(
          Effect.map((bytes) => new TextDecoder().decode(normalizedFiles(bytes)["SKILL.md"])),
          toAgentTemplateFailure,
        );
      const fromOtherOrigin = (skill: MarketplaceSkillDetail) =>
        library.templateOrigin(skill.id).pipe(
          Effect.map((origin) => origin !== input.templateId),
          toAgentTemplateFailure,
        );
      const templateSlugs = new Set<string>();
      for (const skill of detail.skills)
        if (skill.kind === "embedded")
          templateSlugs.add((yield* templateSync(() => inspectSkillMarkdown(skill.markdown))).slug);
      let otherOrigins: Set<string> | undefined;
      const skills: AgentTemplateSkill[] = [];
      const existingSkills = new Map<string, { id: string; revision: number; sameText: boolean }>();
      for (const skill of detail.skills) {
        if (skill.kind !== "embedded") {
          skills.push(skill);
          continue;
        }
        let { name, markdown } = skill;
        let slug = inspectSkillMarkdown(markdown).slug;
        let current = localSkills.find((candidate) => candidate.slug === slug);
        let sameText = current !== undefined && (yield* latestText(current)) === markdown;
        if (current && !sameText && (yield* fromOtherOrigin(current))) {
          if (!otherOrigins) {
            otherOrigins = new Set();
            for (const local of localSkills) if (yield* fromOtherOrigin(local)) otherOrigins.add(local.slug);
          }
          const taken = otherOrigins;
          const renamed = yield* templateSync(() =>
            renameSkill(
              [["SKILL.md", new TextEncoder().encode(markdown)]],
              (candidate) => templateSlugs.has(candidate) || taken.has(candidate),
              templateSlugs.size + localSkills.length + 2,
            ),
          );
          ({ slug, name } = renamed);
          markdown = new TextDecoder().decode(renamed.files[0]?.[1]);
          templateSlugs.add(slug);
          current = localSkills.find((candidate) => candidate.slug === slug);
          sameText = current !== undefined && (yield* latestText(current)) === markdown;
        }
        skills.push({ kind: "embedded", slug, name, markdown });
        if (current) existingSkills.set(slug, { id: current.id, revision: current.version, sameText });
      }
      let avatar: AvatarImageInput | null = null;
      if (detail.avatarUrl) {
        const avatarUrl = detail.avatarUrl;
        const bytes = yield* this.catalog.downloadAuthorized(avatarUrl).pipe(toAgentTemplateFailure);
        const mimeType = imageMimeType(bytes);
        if (!mimeType)
          return yield* new AgentTemplateFailure({ cause: new Error(sourceText("error.marketplace.avatarInvalid")) });
        avatar = { mimeType, bytes };
      }

      let agent = yield* this.agents
        .createAgentProfile({
          name: detail.name,
          ...(detail.title ? { title: detail.title } : {}),
          description: detail.description,
          avatarSeed: detail.avatarSeed,
          avatarHue: detail.avatarHue,
        })
        .pipe(toAgentTemplateFailure);
      const published: Array<{ id: string; revision: number }> = [];
      {
        const outcome = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            for (const skill of skills) {
              if (skill.kind === "marketplace") {
                yield* this.skills
                  .installVersion({ agentId: agent.id, skillId: skill.skillId, versionId: skill.versionId })
                  .pipe(toAgentTemplateFailure);
                continue;
              }
              const existing = existingSkills.get(inspectSkillMarkdown(skill.markdown).slug);
              if (existing?.sameText) {
                yield* this.skills
                  .installLocal({ agentId: agent.id, skillId: existing.id, revision: existing.revision })
                  .pipe(toAgentTemplateFailure);
                continue;
              }
              const folder = `${SKILL_STAGING}/${skill.slug}`;
              const target = join(agent.workspacePath, ...folder.split("/"));
              yield* Effect.gen({ self: this }, function* () {
                yield* templateIO(() => mkdir(target, { recursive: true }));
                yield* templateIO(() => writeFile(join(target, "SKILL.md"), skill.markdown, { flag: "wx" }));
                const revision = yield* Effect.gen(function* () {
                  const revision = yield* (
                    existing
                      ? library.revise(agent.id, existing.id, existing.revision, folder)
                      : library.create(agent.id, folder)
                  ).pipe(toAgentTemplateFailure);
                  published.push({ id: revision.id, revision: revision.version });
                  if (!existing)
                    yield* library.recordTemplateOrigin(revision.id, input.templateId).pipe(toAgentTemplateFailure);
                  return revision;
                }).pipe(Effect.uninterruptible);
                yield* this.skills
                  .installLocal({ agentId: agent.id, skillId: revision.id, revision: revision.version })
                  .pipe(toAgentTemplateFailure);
              }).pipe(
                Effect.ensuring(
                  Effect.gen({ self: this }, function* () {
                    yield* templateIO(() => rm(target, { recursive: true, force: true }));
                  }).pipe(Effect.orDie),
                ),
              );
            }
            for (const routine of detail.routines)
              yield* templateSync(() =>
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
            if (avatar) agent = yield* this.agents.setAvatar(agent.id, avatar).pipe(toAgentTemplateFailure);
          }),
        );
        if (Result.isFailure(outcome)) {
          const error = outcome.failure.cause;
          yield* this.agents.deleteAgent(agent.id).pipe(Effect.catch(() => Effect.void));
          for (const skill of published.reverse())
            yield* library.withdraw(skill.id, skill.revision).pipe(Effect.catch(() => Effect.void));
          return yield* new AgentTemplateFailure({ cause: error });
        }
      }
      return { agent };
    });
  }

  snapshot(agent: AgentSummary): Effect.Effect<AgentTemplateSnapshot, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplateSnapshot, AgentTemplateFailure> {
      return this.profile(agent, yield* this.skills.listTemplateSkills(agent.id).pipe(toAgentTemplateFailure));
    });
  }

  private profile(agent: AgentSummary, skills: AgentTemplateSkill[]): AgentTemplateSnapshot {
    return toAgentTemplateSnapshot({
      name: agent.name,
      title: agent.title,
      description: agent.description,
      avatarSeed: agent.avatarSeed,
      avatarHue: agent.avatarHue,
      skills,
      routines: this.agents
        .listRoutines(agent.id)
        .flatMap(({ name, instruction, active, trigger }) =>
          isReleasedRoutineSchedule(trigger.schedule)
            ? [{ name, instruction, active, schedule: trigger.schedule }]
            : [],
        ),
    });
  }

  readAvatar(agentId: string): Effect.Effect<AvatarImageInput | null, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AvatarImageInput | null, AgentTemplateFailure> {
      const avatar = this.agents.resolveAvatar(agentId);
      if (!avatar) return null;
      return { mimeType: avatar.mimeType, bytes: new Uint8Array(yield* templateIO(() => readFile(avatar.path))) };
    });
  }

  owned(agentId: string): Effect.Effect<OwnedTemplate | null, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<OwnedTemplate | null, AgentTemplateFailure> {
      const mine = yield* this.auth
        .requestAuthorized("/v1/agent-templates/mine", { method: "GET" }, decodeOwnedTemplates)
        .pipe(toAgentTemplateFailure);
      return mine.find((template) => template.sourceAgentId === agentId) ?? null;
    });
  }

  private publication(owned: OwnedTemplate): AgentTemplatePublication {
    const origin = agentTemplateShareOrigin(new URL(this.auth.resolveApiUrl("/")).origin);
    return {
      templateId: owned.id,
      shareUrl: createAgentTemplateShareUrl(owned.id, origin),
      publishedAt: owned.updatedAt,
    };
  }

  private requireAgent(agentId: string): AgentSummary {
    const agent = this.agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.skill.chooseLocalAgent"));
    return agent;
  }
}

function assertNoSecrets(snapshot: AgentTemplateSnapshot): void {
  const fields: Array<[string, string]> = [
    [sourceText("error.marketplace.secretInName"), snapshot.name],
    [sourceText("error.marketplace.secretInTitle"), snapshot.title],
    [sourceText("error.marketplace.secretInInstructions"), snapshot.description],
    ...snapshot.routines.flatMap((routine): Array<[string, string]> => {
      const message = sourceText("error.marketplace.secretInRoutine", { name: routine.name });
      return [
        [message, routine.name],
        [message, routine.instruction],
      ];
    }),
    ...snapshot.skills.flatMap(
      (skill): Array<[string, string]> =>
        skill.kind === "embedded"
          ? [[sourceText("error.marketplace.secretInSkill", { name: skill.name }), skill.markdown]]
          : [],
    ),
  ];
  for (const [message, text] of fields) if (containsSecret(text)) throw new Error(message);
}

function isOwnedTemplate(value: unknown): value is OwnedTemplate {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isAgentTemplateId(value.id) &&
    isString(value.sourceAgentId) &&
    isString(value.updatedAt)
  );
}

function decodeOwnedTemplate(value: unknown): OwnedTemplate {
  if (!isOwnedTemplate(value)) throw new Error("Invalid agent template response.");
  return { id: value.id, sourceAgentId: value.sourceAgentId, updatedAt: value.updatedAt };
}

function decodeOwnedTemplates(value: unknown): OwnedTemplate[] {
  if (!Array.isArray(value)) throw new Error("Invalid agent template list.");
  return value.map(decodeOwnedTemplate);
}

function decodeDeleted(value: unknown): { deleted: true } {
  if (!isDynamicRecord(value) || value.deleted !== true) throw new Error("Invalid agent template response.");
  return { deleted: true };
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The skills could not be read.";
}

export class AgentTemplateFailure extends Schema.TaggedError<AgentTemplateFailure>()("AgentTemplateFailure", {
  cause: Schema.Defect(),
}) {}

const { io: templateIO, sync: templateSync, rewrap: toAgentTemplateFailure } = causeHelpers(AgentTemplateFailure);
