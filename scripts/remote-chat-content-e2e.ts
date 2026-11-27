import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Schema } from "effect";
import type { Locator, Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/remote-chat-content-e2e");
const SEED_FILE = join(OUT, "seed.json");
const CONTENT_PORT = 47821;
const LINK_PORTS = { off: 47822, on: 47823 } as const;
const WAIT_MS = 30_000;
type Phase = keyof typeof LINK_PORTS;
const PHASES: readonly Phase[] = ["off", "on"];

const SeedSchema = Schema.Struct({ agentId: Schema.String, agentName: Schema.String });
type Seed = typeof SeedSchema.Type;
const decodeSeed = Schema.decodeUnknownSync(Schema.fromJsonString(SeedSchema));

interface LoggedRequest {
  at: string;
  port: number;
  path: string;
  host: string;
}

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const heading = (phase: Phase) => `Remote content check ${phase.toUpperCase()}.`;
const fileName = (phase: Phase, extension: "html" | "md") => `remote-content-${phase}.${extension}`;
const contentUrl = (kind: string, phase: Phase) => `http://127.0.0.1:${CONTENT_PORT}/${kind}?tag=${phase}`;

function messageBody(phase: Phase): string {
  return [
    heading(phase),
    "",
    `![Status ${phase}](${contentUrl("picture", phase)})`,
    "",
    `See the [release notes](http://localhost:${LINK_PORTS[phase]}/notes).`,
    "",
    `Open \`${fileName(phase, "html")}\` and \`${fileName(phase, "md")}\`.`,
    "",
    "```mermaid",
    "flowchart LR",
    `  A@{ img: "${contentUrl("mermaid", phase)}", label: "Build", h: 40, w: 40 }`,
    "  A --> B[Release]",
    "```",
  ].join("\n");
}

function pageHtml(phase: Phase): string {
  return [
    "<!doctype html><html><head>",
    `<link rel="stylesheet" href="${contentUrl("page-css", phase)}">`,
    "</head><body>",
    `<h1>Remote content page ${phase}</h1>`,
    `<img alt="Page picture" src="${contentUrl("page-img", phase)}">`,
    `<script>fetch(${JSON.stringify(contentUrl("page-fetch", phase))}).catch(() => {});</script>`,
    "</body></html>",
  ].join("\n");
}

function markdownFile(phase: Phase): string {
  return [
    `# Notes ${phase}`,
    "",
    `![Chart ${phase}](${contentUrl("md-picture", phase)})`,
    "",
    `Read [the docs](http://localhost:${LINK_PORTS[phase]}/docs).`,
  ].join("\n");
}

async function seed(): Promise<void> {
  const profile = argument("profile");
  assert.ok(profile && existsSync(profile), "Pass --profile=<userData of this worktree's dev profile>.");
  const { isDevelopmentProfileActive } = await import("./seed-dev-state");
  assert.equal(await isDevelopmentProfileActive(profile), false, "Stop the app first: bun run dev:stop");
  const { OpenBotDatabase } = await import("../src/backend/openbot-database");
  const { runCauseEffect } = await import("../src/backend/effect-boundary");
  const database = new OpenBotDatabase(profile);
  await runCauseEffect(database.initialize());
  try {
    const agent = database.listAgents()[0];
    assert.ok(agent, "The profile has no agent.");
    const threadId = agent.threadId;
    assert.ok(threadId, "The agent has no chat thread.");
    mkdirSync(agent.workspacePath, { recursive: true });
    const start = Date.now();
    PHASES.forEach((phase, index) => {
      writeFileSync(join(agent.workspacePath, fileName(phase, "html")), pageHtml(phase));
      writeFileSync(join(agent.workspacePath, fileName(phase, "md")), markdownFile(phase));
      const message: ConversationMessage = {
        id: `remote-content-e2e-${phase}-${start}`,
        author: "assistant",
        source: "assistant",
        text: messageBody(phase),
        createdAt: new Date(start + index * 1_000).toISOString(),
        status: "completed",
      };
      database.appendConversationMessage({
        agentId: agent.id,
        threadId,
        activeTurnId: null,
        message,
        eventType: "dev-seed.remote-content-e2e",
      });
    });
    mkdirSync(OUT, { recursive: true });
    const result: Seed = { agentId: agent.id, agentName: agent.name };
    writeFileSync(SEED_FILE, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`Seeded two messages and four workspace files for ${agent.name}.\n`);
  } finally {
    database.close();
  }
}

function startLoggingServer() {
  const requests: LoggedRequest[] = [];
  const waiters = new Set<() => void>();
  const servers = [CONTENT_PORT, LINK_PORTS.off, LINK_PORTS.on].map((port) => {
    const server = createServer((request, response) => {
      requests.push({
        at: new Date().toISOString(),
        port,
        path: request.url ?? "/",
        host: request.headers.host ?? "",
      });
      for (const wake of waiters) wake();
      const path = request.url ?? "/";
      if (path.startsWith("/page-css")) {
        response.writeHead(200, { "Content-Type": "text/css", "Access-Control-Allow-Origin": "*" });
        response.end("h1 { color: rgb(200, 0, 0); }");
        return;
      }
      if (path.startsWith("/page-fetch")) {
        response.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
        response.end("ok");
        return;
      }
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e33"/></svg>',
      );
    });
    return new Promise<ReturnType<typeof createServer>>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolveListen(server));
    });
  });
  const matching = (port: number, prefix: string) =>
    requests.filter((entry) => entry.port === port && entry.path.startsWith(prefix));
  const until = (port: number, prefix: string, label: string) =>
    new Promise<LoggedRequest>((resolveSeen, reject) => {
      const found = () => matching(port, prefix)[0];
      const already = found();
      if (already) return resolveSeen(already);
      const timer = setTimeout(() => {
        waiters.delete(wake);
        reject(new Error(`No request for ${label} within ${WAIT_MS} ms.`));
      }, WAIT_MS);
      const wake = () => {
        const seen = found();
        if (!seen) return;
        clearTimeout(timer);
        waiters.delete(wake);
        resolveSeen(seen);
      };
      waiters.add(wake);
    });
  return {
    requests,
    matching,
    until,
    ready: Promise.all(servers),
    close: async () => {
      for (const server of await Promise.all(servers)) server.close();
    },
  };
}

async function run(): Promise<void> {
  assert.ok(existsSync(SEED_FILE), "Seed first: bun scripts/remote-chat-content-e2e.ts --seed --profile=<userData>");
  const seedData = decodeSeed(readFileSync(SEED_FILE, "utf8"));
  const instances = readDevInstanceRecords().filter(
    (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
  );
  assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
  const instance = instances[0];
  assert.ok(instance);
  assertMutationAllowed({
    command: "remote-chat-content-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: true,
    target: instance.instanceId,
  });
  const log = startLoggingServer();
  await log.ready;
  const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("remote-chat-content-e2e"), {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
  const checks: Check[] = [];
  const screenshots: string[] = [];
  const check = (name: string, passed: boolean, detail: unknown) => {
    checks.push({ name, passed, detail });
    process.stdout.write(`${passed ? "PASS" : "FAIL"} ${name}\n`);
  };
  const page: Page = session.page;
  page.setDefaultTimeout(WAIT_MS);
  const shot = async (label: string, target: Locator) => {
    const path = join(OUT, `${label}.png`);
    await target.screenshot({ path });
    screenshots.push(path);
  };
  const setRemote = (enabled: boolean) =>
    page.evaluate((value) => window.openbot.hostAdmin.setRemoteChatContent(value, "local"), enabled);
  const article = (phase: Phase) =>
    page
      .getByRole("main", { name: "Conversation" })
      .getByRole("article")
      .filter({ hasText: heading(phase) });
  const panel = page.getByRole("complementary", { name: "File preview", exact: true });
  const openFile = async (phase: Phase, extension: "html" | "md") => {
    await article(phase)
      .getByRole("button", { name: `Open workspace file ${fileName(phase, extension)}`, exact: true })
      .click();
    await page
      .getByRole("tablist", { name: "Side panel" })
      .getByRole("tab", { name: fileName(phase, extension), exact: true, selected: true })
      .waitFor();
    await panel.waitFor();
  };
  const closeFile = async () => {
    await page.getByRole("button", { name: "Close side panel", exact: true }).click();
    await panel.waitFor({ state: "detached" });
  };
  const contentRequests = (phase: Phase) => log.requests.filter((entry) => entry.path.endsWith(`tag=${phase}`));
  const linkIcons = (phase: Phase) => log.matching(LINK_PORTS[phase], "/favicon.ico");

  try {
    const initial = await setRemote(false);
    check("the local setting starts off", initial.enabled === false, initial);
    await page.reload();
    const openPanel = page.getByRole("button", { name: "Close side panel", exact: true });
    if (await openPanel.isVisible().catch(() => false)) await closeFile();
    const chats = page.getByRole("navigation", { name: "Chat list" });
    await chats.getByRole("button", { name: new RegExp(`^${seedData.agentName},`) }).click();
    for (const phase of PHASES) await article(phase).waitFor();

    await article("off").scrollIntoViewIfNeeded();
    await article("off").getByRole("button", { name: "Load picture" }).waitFor();
    await article("off").getByRole("button", { name: "Load diagram" }).waitFor();
    await article("on").scrollIntoViewIfNeeded();
    await article("on").getByRole("button", { name: "Load picture" }).waitFor();
    await article("off").scrollIntoViewIfNeeded();
    await shot("off-message", article("off"));
    check(
      "while off, a chat message shows a placeholder for its picture and diagram and makes no request",
      log.requests.length === 0,
      [...log.requests],
    );

    await article("off").getByRole("button", { name: "Load picture" }).click();
    await log.until(CONTENT_PORT, "/picture?tag=off", "the clicked picture");
    await article("off").getByRole("button", { name: "Load diagram" }).click();
    await log.until(CONTENT_PORT, "/mermaid?tag=off", "the clicked diagram");
    check(
      "while off, only the picture and the diagram that the user clicks load; no link icon loads",
      contentRequests("off").every((entry) => /^\/(picture|mermaid)\?/u.test(entry.path)) &&
        contentRequests("on").length === 0 &&
        linkIcons("off").length === 0 &&
        linkIcons("on").length === 0,
      [...log.requests],
    );

    await openFile("off", "html");
    const frame = panel.locator("iframe");
    const staticSrc = await frame.getAttribute("src");
    await frame.contentFrame().getByRole("heading", { name: "Remote content page off" }).waitFor();
    await shot("off-html-preview", panel);
    check(
      "while off, an HTML file preview shows the page without scripts and loads nothing remote",
      Boolean(staticSrc?.includes("static=1")) &&
        (await frame.getAttribute("sandbox")) === "" &&
        log.matching(CONTENT_PORT, "/page-").length === 0,
      { staticSrc, requests: [...log.requests] },
    );
    await panel.getByRole("button", { name: "Run page" }).click();
    const running = panel.locator('iframe[sandbox="allow-scripts allow-forms"]');
    await running.waitFor();
    check("after Run page, the frame runs the page with scripts", true, {
      src: await running.getAttribute("src"),
      frames: await panel.locator("iframe").count(),
    });
    await log.until(CONTENT_PORT, "/page-img?tag=off", "the run page picture");
    await log.until(CONTENT_PORT, "/page-fetch?tag=off", "the run page script request");
    check(
      "after Run page, the HTML page runs its script and loads its content",
      log.matching(CONTENT_PORT, "/page-img?tag=off").length > 0 &&
        log.matching(CONTENT_PORT, "/page-fetch?tag=off").length > 0,
      log.matching(CONTENT_PORT, "/page-"),
    );
    await closeFile();

    await openFile("off", "md");
    await panel.getByRole("button", { name: "Load picture" }).waitFor();
    await shot("off-markdown-preview", panel);
    check(
      "while off, a Markdown file preview shows a placeholder and loads no picture or link icon",
      log.matching(CONTENT_PORT, "/md-picture").length === 0 && linkIcons("off").length === 0,
      [...log.requests],
    );
    await panel.getByRole("button", { name: "Load picture" }).click();
    await log.until(CONTENT_PORT, "/md-picture?tag=off", "the clicked Markdown file picture");
    await closeFile();

    const turnedOn = await setRemote(true);
    await article("on").scrollIntoViewIfNeeded();
    await log.until(CONTENT_PORT, "/picture?tag=on", "the picture with the setting on");
    await log.until(CONTENT_PORT, "/mermaid?tag=on", "the diagram with the setting on");
    await log.until(LINK_PORTS.on, "/favicon.ico", "the link icon with the setting on");
    check(
      "with the setting on, the picture, the diagram picture and the link icon load with no click",
      turnedOn.enabled === true,
      contentRequests("on"),
    );

    await openFile("on", "html");
    await log.until(CONTENT_PORT, "/page-img?tag=on", "the page picture with the setting on");
    await log.until(CONTENT_PORT, "/page-fetch?tag=on", "the page script request with the setting on");
    check(
      "with the setting on, an HTML file preview runs at once",
      !(await panel.locator("iframe").getAttribute("src"))?.includes("static=1"),
      log.matching(CONTENT_PORT, "/page-"),
    );
    await closeFile();
    await openFile("on", "md");
    await log.until(CONTENT_PORT, "/md-picture?tag=on", "the Markdown file picture with the setting on");
    check("with the setting on, a Markdown file preview loads its picture with no click", true, null);
    await closeFile();
  } catch (error) {
    check("the run finished", false, error instanceof Error ? error.message : String(error));
  } finally {
    const restored = await setRemote(false).catch(() => null);
    check("the local setting is off again", restored?.enabled === false, restored);
    const passed = checks.every((entry) => entry.passed);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, "report.json"),
      `${JSON.stringify({ passed, checks, requests: log.requests, screenshots }, null, 2)}\n`,
    );
    await session.close();
    await log.close();
    process.stdout.write(`${passed ? "PASSED" : "FAILED"}: ${join(OUT, "report.json")}\n`);
    if (!passed) process.exitCode = 1;
  }
}

if (process.argv.includes("--seed")) await seed();
else await run();
