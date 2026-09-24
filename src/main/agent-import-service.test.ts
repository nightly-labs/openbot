import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary, AvatarImageInput, CreateRoutineInput } from "@openbot/contracts/ipc";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { AgentImportService } from "./agent-import-service";
import { LocalSkillLibrary } from "./local-skill-library";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SKILL = "---\nname: Web brief\ndescription: Write a short cited brief.\n---\nSearch, then cite.";
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

let root: string;
let agents: AgentSummary[];
let routines: CreateRoutineInput[];
let memories: Array<{ agentId: string; text: string }>;
let avatars: Map<string, AvatarImageInput | null>;
let installLocal: Mock<(input: { agentId: string; skillId: string; revision: number }) => Promise<void>>;
let library: LocalSkillLibrary;
let service: AgentImportService;

interface ManifestAgentFixture {
  name: string;
  avatar: string | null;
  skills: string[];
  routines: Array<{ name: string; instruction: string; active?: boolean; schedule: object }>;
  memories: string[];
  files: string | null;
}

function manifestAgent(key: string, overrides: Partial<ManifestAgentFixture> = {}) {
  return {
    key,
    name: key[0]?.toUpperCase() + key.slice(1),
    title: "Analyst",
    description: `You are ${key}.`,
    avatar: null,
    skills: [],
    routines: [],
    memories: [],
    files: null,
    ...overrides,
  };
}

async function exportFile(files: Record<string, Uint8Array>, name = "export.zip"): Promise<string> {
  const path = join(root, name);
  await writeFile(path, zipSync(files));
  return path;
}

function manifest(agentList: ReturnType<typeof manifestAgent>[], extra: { version?: number } = {}): Uint8Array {
  return encode({
    format: "openbot-agent-import",
    version: 1,
    source: { app: "grok-bot", exportedAt: "2026-09-22T16:40:00.000Z" },
    agents: agentList,
    ...extra,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-agent-import-"));
  agents = [];
  routines = [];
  memories = [];
  avatars = new Map();
  installLocal = vi.fn(async () => undefined);
  library = new LocalSkillLibrary(join(root, "library"), () => agents);
  service = new AgentImportService(
    {
      listAgents: () => agents,
      createAgentProfile: async (input) => {
        const id = `agent-${agents.length + 1}`;
        const agent: AgentSummary = {
          id,
          name: input.name,
          title: input.title ?? "",
          description: input.description,
          provider: "codex",
          notifications: true,
          model: "gpt-5.6-luna",
          reasoningEffort: "medium",
          threadId: null,
          workspacePath: join(root, "workspaces", id),
          preview: "",
          updatedAt: null,
          avatarSeed: input.avatarSeed,
          avatarHue: null,
          avatarUrl: null,
        };
        await mkdir(agent.workspacePath, { recursive: true });
        agents.push(agent);
        return agent;
      },
      createRoutine: (input) => {
        routines.push(input);
        return { id: `routine-${routines.length}` };
      },
      createMemory: (input) => memories.push(input),
      setAvatar: async (agentId, image) => {
        avatars.set(agentId, image);
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Unknown agent.");
        return agent;
      },
      deleteAgent: async (agentId) => {
        agents = agents.filter((agent) => agent.id !== agentId);
      },
    },
    { library: () => library, installLocal },
    () => "Europe/Warsaw",
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("AgentImportService", () => {
  it("imports an agent with its skills, routines, memories, avatar and files", async () => {
    // A zip made by compressing a folder puts everything inside that folder.
    const path = await exportFile({
      "export/openbot-import.json": manifest([
        manifestAgent("research", {
          avatar: "agents/research/avatar.png",
          skills: ["agents/research/skills/web-brief"],
          routines: [
            {
              name: "Morning digest",
              instruction: "Summarize the news.",
              active: true,
              schedule: { kind: "weekdays", time: "08:30" },
            },
          ],
          memories: ["The user reports in EUR."],
          files: "agents/research/files",
        }),
      ]),
      "export/agents/research/avatar.png": PNG,
      "export/agents/research/skills/web-brief/SKILL.md": encode(SKILL),
      "export/agents/research/files/notes/plan.md": encode("# Plan"),
    });

    const preview = await service.stage(path);
    expect(preview.agents).toEqual([
      expect.objectContaining({
        key: "research",
        name: "Research",
        skillCount: 1,
        routineCount: 1,
        memoryCount: 1,
        fileCount: 1,
        fileBytes: 6,
        avatarUrl: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    ]);

    const result = await service.apply({ token: preview.token, keys: ["research"] });
    expect(result.skipped).toEqual([]);
    const [agent] = result.agents;
    expect(agent).toMatchObject({ name: "Research", title: "Analyst", description: "You are research." });
    const agentId = agent?.id ?? "";
    const workspace = agent?.workspacePath ?? "";
    expect(routines).toEqual([expect.objectContaining({ agentId, name: "Morning digest", timezone: "Europe/Warsaw" })]);
    expect(memories).toEqual([{ agentId, text: "The user reports in EUR." }]);
    expect(avatars.get(agentId)).toEqual({ mimeType: "image/png", bytes: PNG });
    expect(await readFile(join(workspace, "imported/notes/plan.md"), "utf8")).toBe("# Plan");
    const [skill] = await library.list();
    expect(skill).toMatchObject({ name: "Web brief", version: 1 });
    expect(installLocal).toHaveBeenCalledWith({ agentId, skillId: skill?.id, revision: 1 });
    // The copy that was published is not left in the workspace for the agent to find.
    expect(await readdir(join(workspace, ".openbot/import-skills"))).toEqual([]);
  });

  it("publishes a skill that an earlier import added as a new revision", async () => {
    const files = {
      "openbot-import.json": manifest([manifestAgent("research", { skills: ["agents/research/skills/web-brief"] })]),
      "agents/research/skills/web-brief/SKILL.md": encode(SKILL),
    };
    for (const name of ["first.zip", "second.zip"]) {
      const preview = await service.stage(await exportFile(files, name));
      expect((await service.apply({ token: preview.token, keys: ["research"] })).skipped).toEqual([]);
    }
    const skills = await library.list();
    expect(skills).toHaveLength(1);
    expect(skills[0]?.version).toBe(2);
  });

  it.each([
    [
      "an environment file",
      { "agents/research/files/.env": encode("KEY=1") },
      "unsafe file: agents/research/files/.env",
    ],
    ["a path out of the folder", { "../escape.txt": encode("x") }, "unsafe file: ../escape.txt"],
    ["a nested archive", { "agents/research/files/old.zip": encode("x") }, "unsafe file"],
    [
      "a path on another drive",
      { "agents/research/files/D:/escape.txt": encode("x") },
      "unsafe file: agents/research/files/D:/escape.txt",
    ],
  ])("rejects an export with %s", async (_label, extra, message) => {
    const path = await exportFile({ "openbot-import.json": manifest([manifestAgent("research")]), ...extra });
    await expect(service.stage(path)).rejects.toThrow(message);
  });

  it("imports an export that lists its folders as entries", async () => {
    const path = await exportFile({
      "openbot-import.json": manifest([manifestAgent("research", { files: "agents/research/files" })]),
      "agents/research/files/": new Uint8Array(),
      "agents/research/files/plan.md": encode("# Plan"),
    });
    const preview = await service.stage(path);
    const result = await service.apply({ token: preview.token, keys: ["research"] });
    expect(result.skipped).toEqual([]);
    expect(await readFile(join(result.agents[0]?.workspacePath ?? "", "imported/plan.md"), "utf8")).toBe("# Plan");
  });

  it("rejects an export that changed after the preview", async () => {
    const path = await exportFile({ "openbot-import.json": manifest([manifestAgent("research")]) });
    const preview = await service.stage(path);
    await exportFile({ "openbot-import.json": manifest([manifestAgent("research")]), "extra.txt": encode("x") });
    await expect(service.apply({ token: preview.token, keys: ["research"] })).rejects.toThrow("changed");
    expect(agents).toEqual([]);
  });

  it("rejects a manifest it cannot read", async () => {
    const newer = await exportFile({ "openbot-import.json": manifest([manifestAgent("a")], { version: 2 }) }, "v2.zip");
    await expect(service.stage(newer)).rejects.toThrow("newer export skill");
    const long = await exportFile(
      { "openbot-import.json": manifest([manifestAgent("a", { name: "x".repeat(81) })]) },
      "long.zip",
    );
    await expect(service.stage(long)).rejects.toThrow('Agent "a" has an invalid name.');
    const outside = await exportFile(
      { "openbot-import.json": manifest([manifestAgent("a", { files: "agents/b/files" })]) },
      "outside.zip",
    );
    await expect(service.stage(outside)).rejects.toThrow('Agent "a" has an invalid files path.');
    const missing = await exportFile({ "notes.txt": encode("x") }, "missing.zip");
    await expect(service.stage(missing)).rejects.toThrow("must contain openbot-import.json");
  });

  it("skips a routine with an invalid schedule and says so", async () => {
    const path = await exportFile({
      "openbot-import.json": manifest([
        manifestAgent("research", {
          routines: [
            { name: "Broken", instruction: "Run.", active: true, schedule: { kind: "daily", time: "25:00" } },
            {
              name: "Every half hour",
              instruction: "Check.",
              schedule: { kind: "interval", amount: 30, unit: "minutes" },
            },
          ],
        }),
      ]),
    });
    const preview = await service.stage(path);
    expect(preview.warnings).toEqual([expect.stringContaining('routine "Broken" is skipped')]);
    await service.apply({ token: preview.token, keys: ["research"] });
    expect(routines).toEqual([
      expect.objectContaining({
        name: "Every half hour",
        active: true,
        schedule: expect.objectContaining({ kind: "interval", anchorAt: expect.any(String) }),
      }),
    ]);
  });

  it("removes an agent whose skill fails and imports the others", async () => {
    const path = await exportFile({
      "openbot-import.json": manifest([
        manifestAgent("broken", { skills: ["agents/broken/skills/good", "agents/broken/skills/bad"] }),
        manifestAgent("research"),
      ]),
      "agents/broken/skills/good/SKILL.md": encode(SKILL),
      "agents/broken/skills/bad/SKILL.md": encode("No frontmatter."),
    });
    const preview = await service.stage(path);
    const result = await service.apply({ token: preview.token, keys: ["broken", "research"] });
    expect(result.agents.map((agent) => agent.name)).toEqual(["Research"]);
    expect(result.skipped).toEqual([
      { key: "broken", name: "Broken", reason: "SKILL.md must begin with YAML frontmatter." },
    ]);
    expect(agents.map((agent) => agent.name)).toEqual(["Research"]);
    expect(await library.list()).toEqual([]);
  });

  it("removes the skill revision a failed import published", async () => {
    const files = {
      "openbot-import.json": manifest([manifestAgent("research", { skills: ["agents/research/skills/web-brief"] })]),
      "agents/research/skills/web-brief/SKILL.md": encode(SKILL),
    };
    const first = await service.stage(await exportFile(files, "first.zip"));
    await service.apply({ token: first.token, keys: ["research"] });
    installLocal.mockRejectedValueOnce(new Error("Install failed."));
    const second = await service.stage(await exportFile(files, "second.zip"));
    expect((await service.apply({ token: second.token, keys: ["research"] })).skipped).toHaveLength(1);
    expect((await library.list()).map((skill) => skill.version)).toEqual([1]);
  });

  it("accepts a token once, and not after it is discarded", async () => {
    const path = await exportFile({ "openbot-import.json": manifest([manifestAgent("research")]) });
    const used = await service.stage(path);
    await service.apply({ token: used.token, keys: ["research"] });
    await expect(service.apply({ token: used.token, keys: ["research"] })).rejects.toThrow("no longer open");

    const discarded = await service.stage(path);
    service.discard(discarded.token);
    await expect(service.apply({ token: discarded.token, keys: ["research"] })).rejects.toThrow("no longer open");
  });
});
