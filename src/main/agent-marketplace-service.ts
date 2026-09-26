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

interface AgentMarketplaceAuth {
  requestAuthorized<T>(path: string, init: RequestInit, decoder: (value: unknown) => T, timeoutMs?: number): Promise<T>;
  downloadAuthorized(path: string): Promise<Uint8Array>;
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
  }): Promise<AgentSummary>;
  updateAgent(input: {
    agentId: string;
    name: string;
    title: string;
    description: string;
    avatarSeed: string;
    avatarHue: MarketplaceAgentDetail["avatarHue"];
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
  deleteRoutine(
    input: { agentId: string; routineId: string },
    options?: { recordConversationEvent?: boolean },
  ): Promise<void>;
  setMarketplaceSource(agentId: string, source: NonNullable<AgentSummary["marketplaceSource"]>): AgentSummary;
  deleteAgent(agentId: string): Promise<void>;
}

interface AgentMarketplaceSkills {
  listPublishable(agentId: string): Promise<MarketplaceAgentSkill[]>;
  installVersion(input: { agentId: string; skillId: string; versionId: string }): Promise<unknown>;
  uninstall(input: { agentId: string; skillId: string }): Promise<void>;
}

export class AgentMarketplaceService {
  constructor(
    private readonly auth: AgentMarketplaceAuth,
    private readonly agents: AgentMarketplaceAgents,
    private readonly skills: AgentMarketplaceSkills,
  ) {}

  async list(query: MarketplaceAgentQuery = {}): Promise<MarketplaceAgentPage> {
    const params = marketplaceQueryParams(query);
    const page = await this.auth.requestAuthorized(
      `/v1/marketplace/agents/?${params}`,
      { method: "GET" },
      decodeMarketplaceAgentPage,
    );
    return { ...page, agents: page.agents.map((agent) => this.withAbsoluteAvatar(agent)) };
  }

  async get(listingId: string): Promise<MarketplaceAgentDetail> {
    const detail = await this.auth.requestAuthorized(
      `/v1/marketplace/agents/${encodeURIComponent(listingId)}`,
      { method: "GET" },
      decodeMarketplaceAgentDetail,
    );
    return this.withAbsoluteAvatar(detail);
  }

  async listMine(): Promise<AgentSubmission[]> {
    const values = await this.auth.requestAuthorized(
      "/v1/marketplace/agents/mine",
      { method: "GET" },
      decodeAgentSubmissions,
    );
    return values.map((value) => this.withAbsoluteAvatar(value));
  }

  async preview(agentId: string): Promise<AgentPublicationPreview> {
    const agent = this.agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.skill.chooseLocalAgent"));
    const skills = await this.skills.listPublishable(agentId);
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
  }

  async submit(input: SubmitMarketplaceAgentInput): Promise<AgentSubmission> {
    const snapshot = await this.preview(input.agentId);
    const form = new FormData();
    if (input.category) form.set("category", input.category);
    if (input.showCreatorAvatar !== undefined) form.set("showCreatorAvatar", String(input.showCreatorAvatar));
    form.set("snapshot", JSON.stringify(toMarketplaceSnapshotWire(snapshot)));
    // The multipart field names the marketplace listing being updated, and is the deployed spelling.
    if (input.listingId) form.set("agentId", input.listingId);
    const avatar = this.agents.resolveAvatar(input.agentId);
    if (avatar) {
      const bytes = new Uint8Array(await readFile(avatar.path));
      form.set("avatar", new Blob([toArrayBuffer(bytes)], { type: avatar.mimeType }), "avatar");
    }
    const submission = await this.auth.requestAuthorized(
      "/v1/marketplace/agents/",
      { method: "POST", body: form },
      decodeAgentSubmission,
      30_000,
    );
    return this.withAbsoluteAvatar(submission);
  }

  async install(input: InstallMarketplaceAgentInput): Promise<InstallMarketplaceAgentResult> {
    if (!validTimezone(input.timezone)) throw new Error(sourceText("error.marketplace.timezoneInvalid"));
    const detail = await this.get(input.listingId);
    const existing = input.agentId
      ? this.agents.listAgents().find((candidate) => candidate.id === input.agentId)
      : undefined;
    if (input.agentId && !existing) throw new Error(sourceText("error.marketplace.installedAgentMissing"));
    if (existing?.marketplaceSource?.listingId !== detail.id) {
      if (existing) throw new Error(sourceText("error.marketplace.differentListing"));
    }
    if (existing?.marketplaceSource?.versionId === detail.versionId) return { agent: existing };

    let avatar: AvatarImageInput | null = null;
    if (detail.avatarUrl) {
      const bytes = await this.auth.downloadAuthorized(detail.avatarUrl);
      const mimeType = imageMimeType(bytes);
      if (!mimeType) throw new Error(sourceText("error.marketplace.marketplaceAvatarInvalid"));
      avatar = { mimeType, bytes };
    }
    let agent =
      existing ??
      (await this.agents.createAgentProfile({
        name: detail.name,
        title: detail.title,
        description: detail.description,
        avatarSeed: detail.avatarSeed,
        avatarHue: detail.avatarHue,
      }));
    const createdRoutineIds: string[] = [];
    try {
      for (const skill of detail.skills) {
        await this.skills.installVersion({ agentId: agent.id, skillId: skill.skillId, versionId: skill.versionId });
      }
      for (const routine of detail.routines) {
        const created = this.agents.createRoutine(
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
        createdRoutineIds.push(created.id);
      }
      if (existing) {
        agent = await this.agents.updateAgent({
          agentId: agent.id,
          name: detail.name,
          title: detail.title,
          description: detail.description,
          avatarSeed: detail.avatarSeed,
          avatarHue: detail.avatarHue,
        });
      }
      agent = await this.agents.setAvatar(agent.id, avatar);
      const nextSkillIds = new Set(detail.skills.map((skill) => skill.skillId));
      for (const skillId of existing?.marketplaceSource?.skillIds ?? []) {
        if (!nextSkillIds.has(skillId)) await this.skills.uninstall({ agentId: agent.id, skillId });
      }
      agent = this.agents.setMarketplaceSource(agent.id, {
        listingId: detail.id,
        versionId: detail.versionId,
        version: detail.version,
        skillIds: [...nextSkillIds],
        routineIds: createdRoutineIds,
      });
      for (const routineId of existing?.marketplaceSource?.routineIds ?? []) {
        await this.agents
          .deleteRoutine({ agentId: agent.id, routineId }, { recordConversationEvent: false })
          .catch(() => undefined);
      }
    } catch (error) {
      if (existing) {
        await Promise.all(
          createdRoutineIds.map((routineId) =>
            this.agents
              .deleteRoutine({ agentId: agent.id, routineId }, { recordConversationEvent: false })
              .catch(() => undefined),
          ),
        );
      } else {
        await this.agents.deleteAgent(agent.id).catch(() => undefined);
      }
      throw error;
    }
    if (!existing) {
      await this.auth.requestAuthorized(
        `/v1/marketplace/agents/${encodeURIComponent(detail.id)}/install`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiptId: input.receiptId }),
        },
        decodeInstallReceipt,
      );
    }
    return { agent: agent };
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
