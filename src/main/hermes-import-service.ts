// Hermes Agent import into the local host: the profiles of a Hermes folder on this computer.
//
// `stage` reads the profiles once and keeps them under a token; the preview lists what each one holds,
// item by item, and why an item needs approval or stays in Hermes. `apply` makes one agent per profile,
// through the same services the user reaches by hand. A profile imported before updates the agent it
// made: same agent and chats, new instructions, and only the memories, skills and routines it does
// not have yet. A failure on a new agent removes it; on an agent that existed, it keeps what is done.
// MCP servers are on every agent, so an allowed one is added once and turned off, as Transfer does.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_IMPORT_LIMITS,
  type AgentImportResult,
  type AgentImportSkipped,
  type AgentSummary,
  type ApplyHermesImportInput,
  type CreateRoutineInput,
  HERMES_IMPORT_LIMITS,
  type HermesImportItem,
  type HermesImportPreview,
  type HermesImportProfile,
  type McpServerConfig,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { parseStoredJson, writeJsonFileAtomically } from "../backend/atomic-json-file";
import { writeTreeEffect } from "./agent-archive";
import type { AgentImportAgents, AgentImportSkills } from "./agent-import-service";
import { type ArchiveOperationError, archiveCall, archiveFailure } from "./archive-effects";
import {
  displayPath,
  type HermesProfileData,
  hasSkillCode,
  readHermesProfiles,
  readSkillFiles,
  routineSchedule,
} from "./hermes-import-reader";

/** Skill folders are copied here, published to the local library, and removed again. */
const SKILL_STAGING = ".openbot/import-skills";
/** A persona longer than the instructions keeps its full text here, in the agent's workspace. */
const SOUL_COPY = ["imported", "hermes", "SOUL.md"] as const;
const SOUL_POINTER = "\n\nThe full persona is in imported/hermes/SOUL.md. Read it before your first task.";
const LINKS_VERSION = 1;

export interface HermesImportAgents
  extends Pick<
    AgentImportAgents,
    | "listAgents"
    | "createAgentProfile"
    | "createRoutine"
    | "createMemory"
    | "memoryLimit"
    | "initializeMemorySelection"
    | "deleteAgent"
  > {
  updateAgent(input: UpdateAgentInput): Effect.Effect<AgentSummary, { cause: unknown }>;
  listMemories(agentId: string): ReadonlyArray<{ text: string }>;
  listRoutines(agentId: string): ReadonlyArray<{ name: string }>;
  listMcpServers(): McpServerConfig[];
  saveMcpServer(config: McpServerConfig): Effect.Effect<unknown, { cause: unknown }>;
}

interface Staged {
  token: string;
  root: string;
  profiles: HermesProfileData[];
}

/** Which agent each profile folder made, kept beside the other app files. */
interface StoredLinks {
  version: number;
  links: Record<string, string>;
}

export class HermesImportService {
  #staged: Staged | null = null;

  constructor(
    private readonly agents: HermesImportAgents,
    private readonly skills: AgentImportSkills,
    private readonly linksPath: string,
    private readonly timezone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {}

  /** Reads the Hermes folder. A new read replaces the previous one. Null: the folder has no profiles. */
  readonly stage = Effect.fn("HermesImportService.stage")(function* (
    this: HermesImportService,
    root: string,
  ): Effect.fn.Return<HermesImportPreview | null, ArchiveOperationError> {
    this.#staged = null;
    const real = yield* archiveCall(() => realpath(root).catch(() => root));
    const read = yield* readHermesProfiles(real, this.timezone());
    if (!read) return null;
    const profiles: HermesProfileData[] = [];
    for (const profile of read)
      profiles.push({ ...profile, directory: yield* archiveCall(() => realpath(profile.directory)) });
    const staged: Staged = { token: randomUUID(), root: real, profiles };
    this.#staged = staged;
    const links = yield* this.#readLinks();
    const agents = new Map(this.agents.listAgents().map((agent) => [agent.id, agent]));
    const mcpNames = new Set(this.agents.listMcpServers().map((server) => server.name.toLowerCase()));
    return {
      token: staged.token,
      home: displayPath(real),
      profiles: profiles.map((profile) => {
        const linked = agents.get(links[profile.directory] ?? "");
        return previewProfile(profile, linked ?? null, mcpNames);
      }),
    };
  }).bind(this);

  discard(token: string): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.#staged?.token === token) this.#staged = null;
    });
  }

  readonly apply = Effect.fn("HermesImportService.apply")(function* (
    this: HermesImportService,
    input: ApplyHermesImportInput,
  ): Effect.fn.Return<AgentImportResult, ArchiveOperationError> {
    const staged = this.#staged;
    if (!staged || staged.token !== input.token)
      return yield* archiveFailure(new Error(sourceText("error.import.hermesClosed")));
    // Until the checks below pass, nothing changes, so a failed check keeps the profiles open.
    const byKey = new Map(staged.profiles.map((profile) => [profile.key, profile]));
    const selected = input.profiles.flatMap((entry) => {
      const profile = byKey.get(entry.key);
      return profile ? [{ profile, allow: new Set(entry.allow) }] : [];
    });
    if (selected.length !== input.profiles.length)
      return yield* archiveFailure(new Error(sourceText("error.import.hermesProfileMissing")));

    const links = yield* this.#readLinks();
    const existing = new Map(this.agents.listAgents().map((agent) => [agent.id, agent]));
    const creates = selected.filter(({ profile }) => !existing.has(links[profile.directory] ?? "")).length;
    if (existing.size + creates > INPUT_LIMITS.agents)
      return yield* archiveFailure(
        new Error(sourceText("error.import.serverAgentLimit", { limit: INPUT_LIMITS.agents })),
      );
    this.#staged = null;

    const agents: AgentSummary[] = [];
    const skipped: AgentImportSkipped[] = [];
    const warnings: string[] = [];
    const done: typeof selected = [];
    for (const entry of selected) {
      const { profile, allow } = entry;
      const target = existing.get(links[profile.directory] ?? "") ?? null;
      const imported = yield* Effect.result(this.#importProfile(profile, allow, target, warnings));
      if (Result.isFailure(imported)) {
        skipped.push({ key: profile.key, name: profile.name, reason: message(imported.failure.cause) });
        continue;
      }
      agents.push(imported.success);
      done.push(entry);
      links[profile.directory] = imported.success.id;
      // The agent is made either way. Without its link, the next import adds it again, so the user is told.
      const saved = yield* Effect.result(this.#writeLinks(links));
      if (Result.isFailure(saved)) warnings.push(sourceText("error.import.hermesLinkNotSaved", { name: profile.name }));
    }
    // A profile that did not import brings no MCP server with it.
    yield* this.#addMcpServers(done, warnings);
    // The result shows each agent as it is now, after its routines and skills.
    const now = new Map(this.agents.listAgents().map((agent) => [agent.id, agent]));
    return {
      agents: agents.map((agent) => now.get(agent.id) ?? agent),
      skipped,
      channels: [],
      skippedChannels: [],
      warnings: warnings
        .slice(0, AGENT_IMPORT_LIMITS.warnings)
        .map((text) => text.slice(0, AGENT_IMPORT_LIMITS.message)),
    };
  }).bind(this);

  readonly #importProfile = Effect.fn("HermesImportService.importProfile")(function* (
    this: HermesImportService,
    profile: HermesProfileData,
    allow: ReadonlySet<string>,
    target: AgentSummary | null,
    warnings: string[],
  ): Effect.fn.Return<AgentSummary, ArchiveOperationError> {
    const instructions = profile.soul ? personaInstructions(profile.soul) : null;
    const published: Array<{ id: string; revision: number }> = [];
    let completed = false;
    return yield* Effect.acquireUseRelease(
      target
        ? (instructions
            ? this.agents.updateAgent({ agentId: target.id, description: instructions.description })
            : Effect.succeed(target)
          ).pipe(Effect.mapError((error) => archiveFailure(error.cause)))
        : this.agents
            .createAgentProfile({
              name: profile.name,
              description: instructions?.description ?? "",
              avatarSeed: `hermes-${profile.key}-${randomUUID()}`,
              avatarHue: null,
            })
            .pipe(Effect.mapError((error) => archiveFailure(error.cause))),
      (agent) =>
        Effect.gen({ self: this }, function* () {
          try {
            if (instructions?.long && profile.soul) {
              const soul = profile.soul;
              const path = join(agent.workspacePath, ...SOUL_COPY);
              yield* archiveCall(async () => {
                await mkdir(join(agent.workspacePath, ...SOUL_COPY.slice(0, -1)), { recursive: true });
                await writeFile(path, soul);
              });
              warnings.push(
                sourceText("error.import.hermesSoulLong", {
                  name: profile.name,
                  limit: INPUT_LIMITS.agentDescription,
                }),
              );
            }
            for (const skill of profile.skills) {
              const allowed = allow.has(`skill:${skill.slug}`);
              if (skill.scripts && !allowed) continue;
              const installed = yield* Effect.result(this.#installSkill(agent, skill, allowed, published));
              if (Result.isFailure(installed))
                warnings.push(
                  sourceText("error.import.hermesSkillSkipped", {
                    name: profile.name,
                    skill: skill.slug,
                    reason: message(installed.failure.cause),
                  }),
                );
            }
            const routineNames = new Set(this.agents.listRoutines(agent.id).map((routine) => routine.name));
            for (const routine of profile.routines) {
              if (routineNames.has(routine.name)) continue;
              const timezone = this.timezone();
              const schedule = routineSchedule(routine.source, timezone);
              if (!schedule) {
                warnings.push(sourceText("error.import.routineInvalid", { name: profile.name, routine: routine.name }));
                continue;
              }
              const input: CreateRoutineInput = {
                agentId: agent.id,
                name: routine.name,
                instruction: routine.instruction,
                active: routine.active,
                timezone,
                schedule,
              };
              try {
                this.agents.createRoutine(input, { recordConversationEvent: false });
              } catch (error) {
                warnings.push(
                  sourceText("error.import.routineSkipped", {
                    name: profile.name,
                    routine: routine.name,
                    reason: message(error),
                  }),
                );
              }
            }
            this.#addMemories(agent, profile, warnings);
            completed = true;
            return agent;
          } catch (error) {
            return yield* archiveFailure(error);
          }
        }),
      (agent) =>
        completed || target
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              yield* this.agents.deleteAgent(agent.id).pipe(Effect.ignore);
              for (const skill of published.reverse())
                yield* this.skills.library().withdraw(skill.id, skill.revision).pipe(Effect.ignore);
            }).pipe(Effect.orDie),
    );
  });

  /** Publishes the skill to the local library, as a new revision when the library has its name, and installs it. */
  readonly #installSkill = Effect.fn("HermesImportService.installSkill")(function* (
    this: HermesImportService,
    agent: AgentSummary,
    skill: HermesProfileData["skills"][number],
    allowed: boolean,
    published: Array<{ id: string; revision: number }>,
  ): Effect.fn.Return<void, ArchiveOperationError> {
    // The folder is read again here. A skill that got code after the preview needs the user's approval.
    const files = yield* readSkillFiles(skill.directory);
    if (!allowed && hasSkillCode(files.map(([path]) => path)))
      return yield* archiveFailure(new Error(sourceText("error.import.hermesSkillCodeAdded")));
    const library = this.skills.library();
    const current = (yield* library.list().pipe(Effect.mapError((error) => archiveFailure(error.cause)))).find(
      (candidate) => candidate.slug === skill.slug,
    );
    const folder = `${SKILL_STAGING}/${skill.slug}`;
    const target = join(agent.workspacePath, ...folder.split("/"));
    yield* Effect.acquireUseRelease(
      archiveCall(() => rm(target, { recursive: true, force: true })),
      () =>
        Effect.gen({ self: this }, function* () {
          yield* writeTreeEffect(target, files);
          const revision = yield* Effect.gen(function* () {
            const revision = yield* (
              current ? library.revise(agent.id, current.id, current.version, folder) : library.create(agent.id, folder)
            ).pipe(Effect.mapError((error) => archiveFailure(error.cause)));
            published.push({ id: revision.id, revision: revision.version });
            return revision;
          }).pipe(Effect.uninterruptible);
          yield* this.skills
            .installLocal({ agentId: agent.id, skillId: revision.id, revision: revision.version })
            .pipe(Effect.mapError((error) => archiveFailure(error.cause)))
            .pipe(Effect.uninterruptible);
        }),
      () => archiveCall(() => rm(target, { recursive: true, force: true })),
    );
  });

  /** Adds the entries the agent does not have, up to the memory limit. */
  #addMemories(agent: AgentSummary, profile: HermesProfileData, warnings: string[]): void {
    const memories = this.agents.listMemories(agent.id);
    const known = new Set(memories.map((memory) => memory.text));
    const fresh = profile.memories.filter((text) => !known.has(text));
    const fitting = fresh.filter((text) => text.length <= INPUT_LIMITS.agentMemoryText);
    if (fitting.length < fresh.length)
      warnings.push(
        sourceText("error.import.memoriesSkipped", {
          name: profile.name,
          skipped: fresh.length - fitting.length,
          limit: INPUT_LIMITS.agentMemoryText,
        }),
      );
    const room = Math.max(0, this.agents.memoryLimit() - memories.length);
    if (fitting.length > room)
      warnings.push(sourceText("error.import.memoryLimit", { name: profile.name, limit: this.agents.memoryLimit() }));
    for (const text of fitting.slice(0, room)) this.agents.createMemory({ agentId: agent.id, text });
    if (memories.length === 0) this.agents.initializeMemorySelection(agent.id);
  }

  /** Each allowed server once, turned off, unless a server with its name is already here. */
  readonly #addMcpServers = Effect.fn("HermesImportService.addMcpServers")(function* (
    this: HermesImportService,
    selected: ReadonlyArray<{ profile: HermesProfileData; allow: ReadonlySet<string> }>,
    warnings: string[],
  ) {
    const names = new Set(this.agents.listMcpServers().map((server) => server.name.toLowerCase()));
    for (const { profile, allow } of selected)
      for (const server of profile.mcpServers) {
        if (!allow.has(`mcp:${server.name}`) || names.has(server.name.toLowerCase())) continue;
        const saved = yield* Effect.result(this.agents.saveMcpServer(server));
        if (Result.isFailure(saved)) {
          warnings.push(
            sourceText("error.import.transferSettingSkipped", {
              name: server.name,
              reason: message(saved.failure.cause),
            }),
          );
          continue;
        }
        names.add(server.name.toLowerCase());
        warnings.push(sourceText("error.import.transferMcpValues", { name: server.name }));
      }
  });

  readonly #readLinks = Effect.fn("HermesImportService.readLinks")(function* (this: HermesImportService) {
    const path = this.linksPath;
    const empty: StoredLinks["links"] = {};
    const text = yield* archiveCall(() => readFile(path, "utf8").catch(() => null));
    if (!text) return empty;
    // A damaged file only loses the links: the next import adds the profiles as new agents.
    const parsed = yield* Effect.result(
      Effect.try({ try: () => parseStoredJson(path, text, decodeLinks), catch: archiveFailure }),
    );
    return Result.isSuccess(parsed) ? parsed.success : empty;
  });

  readonly #writeLinks = Effect.fn("HermesImportService.writeLinks")(function* (
    this: HermesImportService,
    links: StoredLinks["links"],
  ) {
    yield* writeJsonFileAtomically<StoredLinks>(this.linksPath, { version: LINKS_VERSION, links }).pipe(
      Effect.mapError((error) => archiveFailure(error.cause)),
    );
  });
}

function decodeLinks(value: unknown): StoredLinks["links"] {
  if (!isDynamicRecord(value) || value.version !== LINKS_VERSION || !isDynamicRecord(value.links)) return {};
  const links: StoredLinks["links"] = {};
  for (const [directory, agentId] of Object.entries(value.links))
    if (isString(agentId) && agentId.length > 0 && agentId.length <= INPUT_LIMITS.identifier)
      links[directory] = agentId;
  return links;
}

/** The persona as the agent's instructions. A long one keeps its start and points to the full copy. */
function personaInstructions(soul: string): { description: string; long: boolean } {
  const limit = INPUT_LIMITS.agentDescription;
  if (soul.length <= limit) return { description: soul, long: false };
  const room = limit - SOUL_POINTER.length;
  const start = soul.slice(0, room);
  const paragraph = start.lastIndexOf("\n\n");
  return {
    description: `${(paragraph > room / 2 ? start.slice(0, paragraph) : start).trimEnd()}${SOUL_POINTER}`,
    long: true,
  };
}

function previewProfile(
  profile: HermesProfileData,
  agent: AgentSummary | null,
  mcpNames: ReadonlySet<string>,
): HermesImportProfile {
  const items: HermesImportItem[] = [];
  const item = (entry: Omit<HermesImportItem, "names" | "count" | "reason"> & Partial<HermesImportItem>) =>
    items.push({ names: [], count: 0, reason: null, ...entry });
  if (profile.soul) item({ id: "instructions", kind: "instructions", status: "ready", count: profile.soul.length });
  else if (profile.soulDefault)
    item({ id: "instructions", kind: "instructions", status: "skipped", reason: "defaultSoul" });
  if (profile.memories.length > 0)
    item({ id: "memories", kind: "memories", status: "ready", count: profile.memories.length });
  const plain = profile.skills.filter((skill) => !skill.scripts);
  if (plain.length > 0)
    item({
      id: "skills",
      kind: "skills",
      status: "ready",
      count: plain.length,
      names: names(plain.map((skill) => skill.slug)),
    });
  for (const skill of profile.skills.filter((entry) => entry.scripts))
    item({
      id: `skill:${skill.slug}`,
      kind: "skill",
      status: "approve",
      count: 1,
      names: [skill.slug],
      reason: "scripts",
    });
  for (const skill of profile.skippedSkills)
    item({
      id: `skipped-skill:${skill.name}`,
      kind: "skill",
      status: "skipped",
      count: 1,
      names: [skill.name],
      reason: skill.reason,
    });
  if (profile.builtInSkills > 0)
    item({
      id: "builtInSkills",
      kind: "builtInSkills",
      status: "skipped",
      count: profile.builtInSkills,
      reason: "builtIn",
    });
  for (const server of profile.mcpServers) {
    const taken = mcpNames.has(server.name.toLowerCase()) || !server.name;
    item({
      id: `mcp:${server.name}`,
      kind: "mcpServer",
      status: taken ? "skipped" : "approve",
      count: 1,
      names: [server.name],
      reason: taken ? "mcpNameTaken" : "mcpOff",
    });
  }
  if (profile.routines.length > 0)
    item({
      id: "routines",
      kind: "routines",
      status: "ready",
      count: profile.routines.length,
      names: names(profile.routines.map((routine) => routine.name)),
    });
  for (const [index, routine] of profile.skippedRoutines.entries())
    item({
      id: `routine:${index}`,
      kind: "routine",
      status: "skipped",
      count: 1,
      names: [routine.name],
      reason: routine.reason,
    });
  if (profile.terminalBackend)
    item({
      id: "terminal",
      kind: "terminal",
      status: "skipped",
      names: [profile.terminalBackend],
      reason: "terminalBackend",
    });
  if (profile.gateways.length > 0)
    item({ id: "gateway", kind: "gateway", status: "skipped", names: names(profile.gateways), reason: "gateway" });
  if (profile.secretNames.length > 0)
    item({
      id: "secrets",
      kind: "secrets",
      status: "skipped",
      count: profile.secretNames.length,
      names: names(profile.secretNames),
      reason: "secrets",
    });
  if (profile.hasHistory) item({ id: "history", kind: "history", status: "skipped", reason: "history" });
  return {
    key: profile.key,
    name: profile.name,
    path: displayPath(profile.directory),
    model: profile.model,
    agent: agent ? { id: agent.id, name: agent.name } : null,
    items: items
      .slice(0, HERMES_IMPORT_LIMITS.items)
      .map((entry) => ({ ...entry, id: entry.id.slice(0, HERMES_IMPORT_LIMITS.name + 16) })),
  };
}

function names(values: readonly string[]): string[] {
  return values.slice(0, HERMES_IMPORT_LIMITS.names).map((value) => value.slice(0, HERMES_IMPORT_LIMITS.name));
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : "The import failed.";
  return text.slice(0, AGENT_IMPORT_LIMITS.message);
}
