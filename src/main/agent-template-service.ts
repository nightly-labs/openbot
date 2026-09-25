// Link-only agent templates on the account Worker.
//
// Publishing sends the agent's instructions, routines and skills - never workspace files or
// memories - and one template exists per local agent, so a second publish updates it. Installing
// creates a new local agent through the same services the marketplace install and the agent
// import use; a failure removes that agent again.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  agentTemplateShareOrigin,
  createAgentTemplateShareUrl,
  isAgentTemplateId,
} from "@openbot/contracts/agent-template-links";
import {
  type AgentSummary,
  type AgentTemplateDetail,
  type AgentTemplatePreview,
  type AgentTemplatePublication,
  type AgentTemplateSkill,
  type AgentTemplateSnapshot,
  type AvatarImageInput,
  agentTemplateSnapshotProblem,
  type InstallAgentTemplateInput,
  type InstallAgentTemplateResult,
  isAgentTemplateCardPng,
  isAgentTemplateDetail,
  isAgentTemplateSnapshot,
  type PublishAgentTemplateInput,
  type RoutineSchedule,
  toAgentTemplateSnapshot,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { imageMimeType, localSchedule, toArrayBuffer, validTimezone } from "./agent-marketplace-service";
import type { LocalSkillLibrary } from "./local-skill-library";
import { inspectSkillMarkdown, normalizedFiles } from "./skill-package";

/** Embedded skills are written here in the new agent's workspace, added to the library, and removed. */
const SKILL_STAGING = ".openbot/template-skills";

interface AgentTemplateAuth {
  requestAuthorized<T>(path: string, init: RequestInit, decoder: (value: unknown) => T, timeoutMs?: number): Promise<T>;
  downloadAuthorized(path: string): Promise<Uint8Array>;
  resolveApiUrl(path: string): string;
}

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
  }): Promise<AgentSummary>;
  setAvatar(agentId: string, image: AvatarImageInput | null): Promise<AgentSummary>;
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
  deleteAgent(agentId: string): Promise<void>;
}

interface AgentTemplateSkills {
  listTemplateSkills(agentId: string): Promise<AgentTemplateSkill[]>;
  installVersion(input: { agentId: string; skillId: string; versionId: string }): Promise<unknown>;
  library(): Pick<LocalSkillLibrary, "list" | "create" | "bundle" | "withdraw">;
  installLocal(input: { agentId: string; skillId: string; revision: number }): Promise<unknown>;
}

/** What the Worker keeps about one template the signed-in user published. */
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
  ) {}

  async preview(agentId: string): Promise<AgentTemplatePreview> {
    const agent = this.requireAgent(agentId);
    // Signed out or offline, the agent still previews; it reads as not published.
    // A skill that cannot be published must not hide the dialog: it is where a published agent is
    // unpublished. The preview shows the error, and publishing refuses with it. The three reads do
    // not depend on each other, so they run together.
    const [owned, skills, avatarImage] = await Promise.all([
      this.owned(agentId).catch(() => null),
      this.skills.listTemplateSkills(agentId).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: [], error: message(error) }),
      ),
      // An avatar file that cannot be read is shown as no avatar: it must not hide the dialog.
      this.readAvatar(agentId).catch(() => null),
    ]);
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
  }

  async publish({ agentId, card }: PublishAgentTemplateInput): Promise<AgentTemplatePublication> {
    if (card && !isAgentTemplateCardPng(card)) throw new Error("The share card is invalid.");
    const agent = this.requireAgent(agentId);
    const snapshot = await this.snapshot(agent);
    // The first real cause, so the owner knows what to change.
    const problem = agentTemplateSnapshotProblem(snapshot);
    if (problem) throw new Error(problem);
    if (!isAgentTemplateSnapshot(snapshot)) throw new Error("This agent cannot be published.");
    assertNoSecrets(snapshot);
    const form = new FormData();
    form.set("snapshot", JSON.stringify(snapshot));
    form.set("sourceAgentId", agentId);
    const avatar = await this.readAvatar(agentId);
    if (avatar) form.set("avatar", new Blob([toArrayBuffer(avatar.bytes)], { type: avatar.mimeType }), "avatar");
    if (card) form.set("card", new Blob([toArrayBuffer(card)], { type: "image/png" }), "card.png");
    const owned = await this.auth.requestAuthorized(
      "/v1/agent-templates/",
      { method: "POST", body: form },
      decodeOwnedTemplate,
      30_000,
    );
    return this.publication(owned);
  }

  async unpublish(agentId: string): Promise<void> {
    const owned = await this.owned(agentId);
    if (!owned) return;
    await this.auth.requestAuthorized(
      `/v1/agent-templates/${encodeURIComponent(owned.id)}`,
      { method: "DELETE" },
      decodeDeleted,
    );
  }

  async get(templateId: string): Promise<AgentTemplateDetail> {
    if (!isAgentTemplateId(templateId)) throw new Error("The agent link is invalid.");
    const detail = await this.auth.requestAuthorized(
      `/v1/agent-templates/${encodeURIComponent(templateId)}`,
      { method: "GET" },
      decodeTemplateDetail,
    );
    return {
      ...toAgentTemplateSnapshot(detail),
      id: detail.id,
      creatorName: detail.creatorName,
      updatedAt: detail.updatedAt,
      avatarUrl: detail.avatarUrl ? this.auth.resolveApiUrl(detail.avatarUrl) : null,
    };
  }

  async install(input: InstallAgentTemplateInput): Promise<InstallAgentTemplateResult> {
    if (!validTimezone(input.timezone)) throw new Error("The local timezone is invalid.");
    const detail = await this.get(input.templateId);
    // The owner can republish while the dialog is open; only the version the user read is installed.
    if (detail.updatedAt !== input.expectedUpdatedAt)
      throw new Error("This agent changed after you opened it. Open the link again to review the new version.");
    // Every embedded skill is checked before the agent exists, so a bad one creates nothing. A local
    // skill with the same name is reused only when its text is the same: a template never revises a
    // skill the user already has.
    const library = this.skills.library();
    const localSkills = await library.list();
    const reused = new Map<string, { id: string; revision: number }>();
    for (const skill of detail.skills) {
      if (skill.kind !== "embedded") continue;
      const { slug } = inspectSkillMarkdown(skill.markdown);
      const current = localSkills.find((candidate) => candidate.slug === slug);
      if (!current) continue;
      const text = new TextDecoder().decode(
        normalizedFiles(await library.bundle(current.id, current.version))["SKILL.md"],
      );
      if (text !== skill.markdown)
        throw new Error(
          `You already have a different local skill named "${current.name}". Rename or remove it, then add this agent again.`,
        );
      reused.set(slug, { id: current.id, revision: current.version });
    }
    let avatar: AvatarImageInput | null = null;
    if (detail.avatarUrl) {
      const bytes = await this.auth.downloadAuthorized(detail.avatarUrl);
      const mimeType = imageMimeType(bytes);
      if (!mimeType) throw new Error("The agent avatar is invalid.");
      avatar = { mimeType, bytes };
    }

    let agent = await this.agents.createAgentProfile({
      name: detail.name,
      ...(detail.title ? { title: detail.title } : {}),
      description: detail.description,
      avatarSeed: detail.avatarSeed,
      avatarHue: detail.avatarHue,
    });
    const published: Array<{ id: string; revision: number }> = [];
    try {
      for (const skill of detail.skills) {
        if (skill.kind === "marketplace") {
          await this.skills.installVersion({ agentId: agent.id, skillId: skill.skillId, versionId: skill.versionId });
          continue;
        }
        const existing = reused.get(inspectSkillMarkdown(skill.markdown).slug);
        if (existing) {
          await this.skills.installLocal({ agentId: agent.id, skillId: existing.id, revision: existing.revision });
          continue;
        }
        const folder = `${SKILL_STAGING}/${skill.slug}`;
        const target = join(agent.workspacePath, ...folder.split("/"));
        try {
          await mkdir(target, { recursive: true });
          await writeFile(join(target, "SKILL.md"), skill.markdown, { flag: "wx" });
          const revision = await library.create(agent.id, folder);
          published.push({ id: revision.id, revision: revision.version });
          await this.skills.installLocal({ agentId: agent.id, skillId: revision.id, revision: revision.version });
        } finally {
          await rm(target, { recursive: true, force: true });
        }
      }
      for (const routine of detail.routines)
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
        );
      if (avatar) agent = await this.agents.setAvatar(agent.id, avatar);
    } catch (error) {
      await this.agents.deleteAgent(agent.id).catch(() => undefined);
      // A failed install leaves the shared library as it was.
      for (const skill of published.reverse()) await library.withdraw(skill.id, skill.revision).catch(() => undefined);
      throw error;
    }
    return { agent };
  }

  private async snapshot(agent: AgentSummary): Promise<AgentTemplateSnapshot> {
    return this.profile(agent, await this.skills.listTemplateSkills(agent.id));
  }

  private profile(agent: AgentSummary, skills: AgentTemplateSkill[]): AgentTemplateSnapshot {
    return toAgentTemplateSnapshot({
      name: agent.name,
      title: agent.title,
      description: agent.description,
      avatarSeed: agent.avatarSeed,
      avatarHue: agent.avatarHue,
      skills,
      routines: this.agents.listRoutines(agent.id).map(({ name, instruction, active, trigger }) => ({
        name,
        instruction,
        active,
        schedule: trigger.schedule,
      })),
    });
  }

  private async readAvatar(agentId: string): Promise<AvatarImageInput | null> {
    const avatar = this.agents.resolveAvatar(agentId);
    if (!avatar) return null;
    return { mimeType: avatar.mimeType, bytes: new Uint8Array(await readFile(avatar.path)) };
  }

  private async owned(agentId: string): Promise<OwnedTemplate | null> {
    const mine = await this.auth.requestAuthorized("/v1/agent-templates/mine", { method: "GET" }, decodeOwnedTemplates);
    return mine.find((template) => template.sourceAgentId === agentId) ?? null;
  }

  /** A share link on the Worker this app uses, so a development publish opens the local page. */
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
    if (!agent) throw new Error("Choose a local agent first.");
    return agent;
  }
}

/**
 * A template is public to anyone with its link, so a secret in it is refused rather than redacted:
 * a silently changed instruction would publish an agent that does not do what its owner wrote.
 */
function assertNoSecrets(snapshot: AgentTemplateSnapshot): void {
  const fields: Array<[string, string]> = [
    ["the name", snapshot.name],
    ["the title", snapshot.title],
    ["the instructions", snapshot.description],
    ...snapshot.routines.flatMap(
      (routine): Array<[string, string]> => [
        [`the routine "${routine.name}"`, routine.name],
        [`the routine "${routine.name}"`, routine.instruction],
      ],
    ),
    ...snapshot.skills.flatMap(
      (skill): Array<[string, string]> =>
        skill.kind === "embedded" ? [[`the skill "${skill.name}"`, skill.markdown]] : [],
    ),
  ];
  for (const [field, text] of fields)
    if (redactText(text) !== text)
      throw new Error(`Remove the secret or email address from ${field} before publishing.`);
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

function decodeTemplateDetail(value: unknown): AgentTemplateDetail {
  if (!isAgentTemplateDetail(value) || !isAgentTemplateId(value.id)) throw new Error("Invalid agent template.");
  return value;
}

function decodeDeleted(value: unknown): { deleted: true } {
  if (!isDynamicRecord(value) || value.deleted !== true) throw new Error("Invalid agent template response.");
  return { deleted: true };
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The skills could not be read.";
}
