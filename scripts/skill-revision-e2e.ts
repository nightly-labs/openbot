import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentSummary, AgentTemplateDetail, SkillConversationEvent } from "@openbot/contracts/ipc";
import { AGENT_INSTALL_CAPABILITY, AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { Effect, Exit, Schema } from "effect";
import { zipSync } from "fflate";
import { runLocalSkillTool } from "../src/backend/agent/skill-tools";
import { isMissingFileError } from "../src/backend/file-errors";
import { AgentTemplateService } from "../src/main/agent-template-service";
import { LocalSkillLibrary } from "../src/main/local-skill-library";
import { localSkillTools } from "../src/main/local-skill-tools";
import { SkillMarketplaceFailure, SkillMarketplaceService } from "../src/main/skill-marketplace-service";
import { HttpError } from "../src/main/team-api/http-error";
import { routeAgentInstall } from "../src/main/team-api/route-agent-install";

interface CaseReport {
  name: string;
  status: "pass" | "fail";
  reason?: string;
}

const report: {
  status: "running" | "pass" | "fail";
  cases: CaseReport[];
  events: SkillConversationEvent[];
} = { status: "running", cases: [], events: [] };

const decodeLock = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      skills: Schema.Record(
        Schema.String,
        Schema.Struct({ version: Schema.Number, files: Schema.Record(Schema.String, Schema.String) }),
      ),
    }),
  ),
);

const SLUG = "report-format";
const ROOTS = [".agents/skills", ".claude/skills"];
const skillFile = (body: string) =>
  `---\nname: ${SLUG}\ndescription: Write the weekly report in the user's format.\n---\n${body}\n`;
const V1 = skillFile("1. Collect the numbers.\n2. Write a long summary.");
const V2 = skillFile("1. Collect the numbers.\n2. Write three bullets, no summary.");
const V3 = skillFile("1. Collect the numbers from the CSV column `total_eur`.\n2. Write three bullets, no summary.");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

const HELPER = "helper";
const helperFile = (body: string) => `---\nname: ${HELPER}\ndescription: Help with the task.\n---\n${body}\n`;
const NOTES = "---\nname: notes\ndescription: Keep notes.\n---\nWrite short notes.\n";
const MINE = helperFile("My own steps.");
const TEMPLATE_ALPHA = "TemplateAlpha_00000000";
const TEMPLATE_BRAVO = "TemplateBravo_00000000";
const TEMPLATE_CHARLIE = "TemplateCharl_00000000";
const decodeInstalled = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ agentId: Schema.String, name: Schema.String })),
);

function templateDetail(id: string, updatedAt: string, markdown: string[]): AgentTemplateDetail {
  return {
    id,
    name: "Helper Agent",
    title: "",
    description: "Help with the task.",
    avatarSeed: "helper-agent",
    avatarHue: null,
    avatarUrl: null,
    creatorName: "Template author",
    updatedAt,
    routines: [],
    skills: markdown.map((text) => {
      const name = text.match(/^name: "?([^"\n]+)"?$/mu)?.[1] ?? "";
      return { kind: "embedded", slug: name, name, markdown: text };
    }),
  };
}

function agent(id: string, workspacePath: string): AgentSummary {
  return {
    id,
    name: id,
    title: "",
    description: "",
    notifications: false,
    provider: "codex",
    model: "gpt-5",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath,
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

async function writeSkill(workspace: string, folder: string, text: string): Promise<void> {
  const path = join(workspace, folder, "SKILL.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function installed(workspace: string): Promise<{ version: number; texts: string[] } | null> {
  const lock = decodeLock(await readFile(join(workspace, ".openbot/skills-lock.json"), "utf8"));
  const entry = Object.values(lock.skills)[0];
  if (!entry) return null;
  const texts = await Promise.all(ROOTS.map((root) => readFile(join(workspace, root, SLUG, "SKILL.md"), "utf8")));
  return { version: entry.version, texts };
}

async function templateScenarios(
  base: string,
  agents: AgentSummary[],
  library: LocalSkillLibrary,
  service: SkillMarketplaceService,
  scenario: (name: string, check: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const templates = new Map<string, AgentTemplateDetail>();
  let failInstall = false;
  const templateService = new AgentTemplateService(
    {
      requestAuthorized: (path, _init, decoder) =>
        Effect.sync(() => decoder(templates.get(decodeURIComponent(path.split("/").at(-1) ?? "")))),
      downloadAuthorized: () => Effect.die(new Error("A template in this test has no avatar.")),
      resolveApiUrl: (value) => value,
    },
    {
      listAgents: () => agents,
      listRoutines: () => [],
      resolveAvatar: () => null,
      createAgentProfile: (input) =>
        Effect.promise(async () => {
          const id = `template-agent-${agents.length}`;
          const workspace = join(base, id);
          await mkdir(workspace);
          const created = { ...agent(id, workspace), name: input.name };
          agents.push(created);
          return created;
        }),
      setAvatar: () => Effect.die(new Error("A template in this test has no avatar.")),
      createRoutine: () => ({ id: "routine" }),
      deleteAgent: (agentId) =>
        Effect.sync(() => {
          agents.splice(
            agents.findIndex((item) => item.id === agentId),
            1,
          );
        }),
    },
    {
      listTemplateSkills: () => Effect.succeed([]),
      installVersion: () => Effect.die(new Error("A template in this test has no marketplace skills.")),
      library: () => library,
      installLocal: (input) =>
        failInstall
          ? Effect.fail(new SkillMarketplaceFailure({ cause: new Error("The skill could not be installed.") }))
          : service.installLocal(input),
    },
  );
  const server = createServer((request, response) => {
    const json = (status: number, value: object | null) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
      return "handled" as const;
    };
    routeAgentInstall(
      {
        request,
        response,
        method: request.method ?? "",
        url: new URL(request.url ?? "/", "http://127.0.0.1"),
        protocol: 1,
        capabilities: new Set([AGENT_INSTALL_CAPABILITY]),
        member: {
          id: "owner",
          username: "owner",
          email: null,
          name: null,
          role: "owner",
          createdAt: "2026-11-25T00:00:00.000Z",
          disabled: false,
        },
        token: "",
        sessionId: "",
        sessionExpiresAt: "",
        fromChrome: false,
        agentLevel: () => "manage",
        json,
        empty: (status) => {
          response.writeHead(status);
          response.end();
          return "handled";
        },
      },
      {
        agentTemplates: templateService,
        marketplaceAgents: { install: () => Effect.die(new Error("This test adds only templates.")) },
      },
      new Set(),
      () => false,
    ).catch((error: unknown) => json(error instanceof HttpError ? error.status : 500, {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  const install = async (templateId: string) => {
    const detail = templates.get(templateId);
    const response = await fetch(`http://127.0.0.1:${port}${AGENT_INSTALL_ROUTES.template}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId, timezone: "UTC", expectedUpdatedAt: detail?.updatedAt }),
    });
    return { status: response.status, body: await response.text() };
  };
  const bySlug = async (slug: string) => (await Effect.runPromise(library.list())).find((skill) => skill.slug === slug);
  const installedSlugs = async (agentId: string) =>
    (await Effect.runPromise(service.listInstalled(agentId))).map((skill) => [skill.slug, skill.skillId, skill.state]);

  try {
    const mineWorkspace = join(base, "mine");
    await mkdir(mineWorkspace);
    agents.push(agent("mine", mineWorkspace));
    const bundle = (text: string) => zipSync({ "SKILL.md": new TextEncoder().encode(text) });
    const own = await Effect.runPromise(library.createFromBundle(bundle(MINE)));
    const notes = await Effect.runPromise(library.createFromBundle(bundle(NOTES)));
    await Effect.runPromise(service.installLocal({ agentId: "mine", skillId: own.id, revision: 1 }));
    let copyId = "";

    await scenario("a template keeps your own skill with the same name and adds its own copy", async () => {
      templates.set(
        TEMPLATE_ALPHA,
        templateDetail(TEMPLATE_ALPHA, "2026-11-25T00:00:00.000Z", [helperFile("The template's steps."), NOTES]),
      );
      const added = await install(TEMPLATE_ALPHA);
      assert.equal(added.status, 200);
      const { agentId } = decodeInstalled(added.body);
      assert.deepEqual(await Effect.runPromise(library.revisions(own.id)), [1]);
      assert.equal((await Effect.runPromise(library.get(own.id))).instructions, "My own steps.");
      assert.deepEqual(await installedSlugs("mine"), [[HELPER, own.id, "installed"]]);
      const copy = await bySlug(`${HELPER}-2`);
      assert.ok(copy);
      copyId = copy.id;
      assert.equal(copy.name, `${HELPER} 2`);
      assert.equal(copy.instructions, "The template's steps.");
      assert.equal(await Effect.runPromise(library.templateOrigin(copy.id)), TEMPLATE_ALPHA);
      assert.equal(await Effect.runPromise(library.templateOrigin(own.id)), null);
      assert.deepEqual((await installedSlugs(agentId)).toSorted(), [
        [`${HELPER}-2`, copy.id, "installed"],
        ["notes", notes.id, "installed"],
      ]);
    });

    await scenario("adding the same template again revises only its own copy", async () => {
      templates.set(
        TEMPLATE_ALPHA,
        templateDetail(TEMPLATE_ALPHA, "2026-11-25T01:00:00.000Z", [helperFile("The template's new steps.")]),
      );
      assert.equal((await install(TEMPLATE_ALPHA)).status, 200);
      assert.deepEqual((await Effect.runPromise(library.revisions(copyId))).toSorted(), [1, 2]);
      assert.deepEqual(await Effect.runPromise(library.revisions(own.id)), [1]);
      assert.equal(await bySlug(`${HELPER}-3`), undefined);
      assert.deepEqual(await installedSlugs("mine"), [[HELPER, own.id, "installed"]]);
    });

    await scenario("a different template with the same skill name adds a separate copy", async () => {
      templates.set(
        TEMPLATE_BRAVO,
        templateDetail(TEMPLATE_BRAVO, "2026-11-25T02:00:00.000Z", [
          helperFile("Another author's steps.").replace(`name: ${HELPER}`, `name: "${HELPER}"`),
        ]),
      );
      assert.equal((await install(TEMPLATE_BRAVO)).status, 200);
      const copy = await bySlug(`${HELPER}-3`);
      assert.ok(copy);
      assert.equal(copy.name, `${HELPER} 3`);
      assert.equal(copy.instructions, "Another author's steps.");
      assert.equal(await Effect.runPromise(library.templateOrigin(copy.id)), TEMPLATE_BRAVO);
      assert.deepEqual((await Effect.runPromise(library.revisions(copyId))).toSorted(), [1, 2]);
      assert.deepEqual(await Effect.runPromise(library.revisions(own.id)), [1]);
    });

    await scenario("a failed template add leaves no new skill", async () => {
      templates.set(
        TEMPLATE_CHARLIE,
        templateDetail(TEMPLATE_CHARLIE, "2026-11-25T03:00:00.000Z", [helperFile("Steps that do not install.")]),
      );
      const before = (await readdir(library.root)).toSorted();
      failInstall = true;
      const failed = await install(TEMPLATE_CHARLIE).finally(() => {
        failInstall = false;
      });
      assert.equal(failed.status, 409);
      assert.deepEqual((await readdir(library.root)).toSorted(), before);
      assert.equal(await bySlug(`${HELPER}-4`), undefined);
      assert.deepEqual(await Effect.runPromise(library.revisions(own.id)), [1]);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main(): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "openbot-skill-revision-"));
  const callerWorkspace = join(base, "caller");
  const otherWorkspace = join(base, "other");
  await mkdir(callerWorkspace);
  await mkdir(otherWorkspace);
  const agents = [agent("caller", callerWorkspace), agent("other", otherWorkspace)];
  const library = new LocalSkillLibrary(join(base, "library"), () => agents);
  const network = () => Effect.die(new Error("A local skill must not use the marketplace."));
  const service = new SkillMarketplaceService(
    { requestAuthorized: network, downloadAuthorized: network, resolveApiUrl: (value) => value },
    () => agents,
    () => Effect.void,
    library,
  );
  const tools = localSkillTools(service);
  const run = (agentId: string, tool: string, args: unknown) =>
    Effect.runPromiseExit(
      runLocalSkillTool(
        tools,
        agentId,
        tool,
        args,
        (target) => target ?? agentId,
        (event) => report.events.push(event),
      ),
    );
  let skillId = "";

  async function scenario(name: string, check: () => Promise<void>): Promise<void> {
    try {
      await check();
      report.cases.push({ name, status: "pass" });
    } catch (error) {
      const reason = error instanceof assert.AssertionError ? "Assertion failed." : "An operation failed.";
      report.cases.push({ name, status: "fail", reason });
    }
  }

  try {
    await scenario("create installs revision 1 for the caller", async () => {
      await writeSkill(callerWorkspace, "drafts/v1", V1);
      const created = await run("caller", "create_skill", { sourcePath: "drafts/v1" });
      assert.ok(Exit.isSuccess(created));
      skillId = report.events.at(-1)?.skillId ?? "";
      assert.match(skillId, /^local-skill-/u);
      assert.deepEqual(await installed(callerWorkspace), { version: 1, texts: [V1, V1] });
      assert.ok(Exit.isSuccess(await run("caller", "install_local_skill", { agentId: "other", skillId, revision: 1 })));
      assert.deepEqual(await installed(otherWorkspace), { version: 1, texts: [V1, V1] });
    });

    await scenario("revise installs the new revision for the caller only", async () => {
      await writeSkill(callerWorkspace, "drafts/v2", V2);
      const before = report.events.length;
      const revised = await run("caller", "revise_skill", { skillId, expectedRevision: 1, sourcePath: "drafts/v2" });
      assert.ok(Exit.isSuccess(revised));
      assert.deepEqual(
        report.events.slice(before).map((event) => [event.action, event.revision]),
        [["revised", 2]],
      );
      assert.deepEqual(await installed(callerWorkspace), { version: 2, texts: [V2, V2] });
      assert.deepEqual(await installed(otherWorkspace), { version: 1, texts: [V1, V1] });
    });

    await scenario("revise from the agent's edited installed copy", async () => {
      await writeFile(join(callerWorkspace, ".agents/skills", SLUG, "SKILL.md"), V3);
      const revised = await run("caller", "revise_skill", {
        skillId,
        expectedRevision: 2,
        sourcePath: `.agents/skills/${SLUG}`,
      });
      assert.ok(Exit.isSuccess(revised));
      assert.deepEqual(await installed(callerWorkspace), { version: 3, texts: [V3, V3] });
    });

    await scenario("a user's edit of the installed copy is kept", async () => {
      const edited = `${V3}\nMy own note.\n`;
      await writeFile(join(callerWorkspace, ".claude/skills", SLUG, "SKILL.md"), edited);
      await writeSkill(callerWorkspace, "drafts/v4", V2);
      const revised = await run("caller", "revise_skill", { skillId, expectedRevision: 3, sourcePath: "drafts/v4" });
      assert.ok(Exit.isFailure(revised));
      assert.ok(String(revised.cause).includes("was saved as revision 4"));
      assert.equal((await Effect.runPromise(library.get(skillId))).version, 4);
      assert.equal(await readFile(join(callerWorkspace, ".claude/skills", SLUG, "SKILL.md"), "utf8"), edited);
      assert.equal(hash(await readFile(join(callerWorkspace, ".agents/skills", SLUG, "SKILL.md"), "utf8")), hash(V3));
    });

    await scenario("create quotes an unquoted colon in the frontmatter", async () => {
      const description = "Use when: the user asks for the monthly report";
      const draft = `---\nname: monthly-report\ndescription: ${description}\n---\nWrite it.\n`;
      await writeSkill(otherWorkspace, "drafts/colon", draft);
      const created = await run("other", "create_skill", { sourcePath: "drafts/colon" });
      assert.ok(Exit.isSuccess(created));
      const saved = await Effect.runPromise(library.get(report.events.at(-1)?.skillId ?? ""));
      assert.equal(saved.description, description);
      assert.equal(saved.instructions, "Write it.");
      assert.equal(await readFile(join(otherWorkspace, "drafts/colon/SKILL.md"), "utf8"), draft);
    });

    await scenario("create saves a name with no Latin letter", async () => {
      const name = "月次レポート";
      await writeSkill(
        otherWorkspace,
        "drafts/japanese",
        `---\nname: ${name}\ndescription: 月次レポートを書く\n---\n書く。\n`,
      );
      const created = await run("other", "create_skill", { sourcePath: "drafts/japanese" });
      assert.ok(Exit.isSuccess(created));
      const saved = await Effect.runPromise(library.get(report.events.at(-1)?.skillId ?? ""));
      assert.equal(saved.name, name);
    });

    await templateScenarios(base, agents, library, service, scenario);
  } finally {
    await rm(base, { recursive: true, force: true }).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    });
  }
  report.status = report.cases.every((item) => item.status === "pass") ? "pass" : "fail";
}

await main().catch(() => {
  report.status = "fail";
});
await mkdir(".openbot-build", { recursive: true });
await writeFile(".openbot-build/skill-revision-e2e.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: report.status, cases: report.cases })}\n`);
process.exitCode = report.status === "pass" ? 0 : 1;
