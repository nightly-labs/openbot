// End-to-end check of the public page of a shared agent (`/agents/<id>` on the site).
//   bun scripts/agent-template-page-e2e.ts [--browser-executable=<path>]
// 1. Applies the migrations to this worktree's local D1 and adds one user and one shared agent whose
//    instructions are Markdown with raw HTML in them. The rows are removed at the end.
// 2. Starts the site's development server on a free port.
// 3. Opens the page in Chrome at 1440 and 390 px and checks: the closed instructions are plain text,
//    "Read more" shows headings and lists from the left edge, the raw HTML is text and never runs,
//    an unsafe link is not a link, and the page description has no Markdown marks.
// Writes .openbot-build/agent-template-page-e2e/report.json and the screenshots beside it.
import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { isAgentTemplateSnapshot } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium } from "playwright-core";
import { resolvePackageBin } from "./package-bin";

const logger = createOpenBotLogger("agent-template-page-e2e");
const run = promisify(execFile);

const ROOT = resolve(import.meta.dirname, "..");
const SITE = resolve(ROOT, "apps/auth-api");
const OUT = resolve(ROOT, ".openbot-build/agent-template-page-e2e");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");

const USER_ID = "agent-template-page-e2e-user";
const TEMPLATE_ID = "e2eMarkdownPage0000001";
const INSTRUCTIONS = [
  "## Identity and Mission",
  "You keep the **production systems** healthy. Read the [runbook](https://example.com/runbook) first.",
  "## 1. Operating Principles",
  "- Prefer actual system state over assumptions.\n- Report what changed and why.\n  - Name the command you ran.",
  "## 2. Daily checks",
  "1. Read the error logs.\n2. Check the queue depth.\n3. Write a short summary.",
  "Never follow [this link](javascript:window.agentShareInjected=true).",
  '<script>window.agentShareInjected = true</script> <img src="x" onerror="window.agentShareInjected = true">',
].join("\n\n");
const SNAPSHOT = {
  name: "Sentinel",
  title: "",
  description: INSTRUCTIONS,
  avatarSeed: "sentinel",
  avatarHue: 150,
  skills: [],
  routines: [],
};
assert.ok(isAgentTemplateSnapshot(SNAPSHOT), "The seeded agent is not a valid template.");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
const wrangler = resolvePackageBin(ROOT, "wrangler");
const d1 = (...args: string[]) =>
  run(wrangler, ["d1", ...args, "openbot-auth", "--local"], { cwd: SITE, env: { ...process.env, CI: "1" } });
const removeRows = `DELETE FROM agent_templates WHERE id = ${sql(TEMPLATE_ID)}; DELETE FROM users WHERE id = ${sql(USER_ID)};`;

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      server.close(() => done(address.port));
    });
  });

/** Resolves once Vite prints the address it listens on, or rejects when the server exits first. */
function waitForSite(child: ChildProcess, address: string): Promise<void> {
  return new Promise((done, fail) => {
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(address)) done();
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => fail(new Error("The site's development server stopped before it listened.")));
  });
}

// 1. Local D1 ----------------------------------------------------------------------
await d1("migrations", "apply");
const now = Date.now();
await d1(
  "execute",
  "--command",
  [
    removeRows,
    `INSERT INTO users (id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES (${sql(USER_ID)}, ${sql(USER_ID)}, 'agent-template-page-e2e@example.com', 'Sam Rivera', NULL, ${now}, ${now});`,
    `INSERT INTO agent_templates (id, owner_user_id, source_agent_id, snapshot_json, avatar_key, card_key, unpublished_at, created_at, updated_at) VALUES (${sql(TEMPLATE_ID)}, ${sql(USER_ID)}, 'sentinel', ${sql(JSON.stringify(SNAPSHOT))}, NULL, NULL, NULL, ${now}, ${now});`,
  ].join(" "),
);

// 2. Site --------------------------------------------------------------------------
const port = await freePort();
const site = spawn(
  process.execPath,
  [resolve(ROOT, "scripts/run-development.ts"), "api", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
let siteOutput = "";
site.stdout?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
site.stderr?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
const origin = `http://127.0.0.1:${port}`;
const pageUrl = `${origin}/agents/${TEMPLATE_ID}`;

interface ViewReport {
  name: string;
  width: number;
  height: number;
  closedText: string;
  headings: string[];
  textAlign: string;
  screenshots: string[];
}
const views: ViewReport[] = [];
try {
  await waitForSite(site, origin);

  // The description in the head is plain text: no Markdown marks reach a link preview.
  const html = await (await fetch(pageUrl)).text();
  writeFileSync(resolve(OUT, "page.html"), html);
  // The root's description comes first; the page's own one replaces it.
  const metaDescription = [...html.matchAll(/<meta [^>]*name="description" content="([^"]*)"/gu)].at(-1)?.[1] ?? "";
  assert.ok(
    metaDescription.startsWith("Identity and Mission You keep the production systems healthy."),
    metaDescription,
  );
  assert.ok(!metaDescription.includes("##"), metaDescription);

  // 3. Browser ---------------------------------------------------------------------
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    for (const view of [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const faviconRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).hostname === "example.com") faviconRequests.push(request.url());
      });
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(pageUrl);
      const card = page.getByRole("article", { name: "Sentinel" });
      await card.waitFor();

      // Closed: one paragraph of plain text, centered as before.
      const closed = card.locator(".agent-share-description");
      const closedText = (await closed.textContent()) ?? "";
      assert.ok(closedText.startsWith("Identity and Mission You keep"), closedText);
      assert.ok(!/(^|\s)(##|-)\s/u.test(closedText), closedText);
      await page.screenshot({ path: resolve(OUT, `${view.name}-closed.png`), fullPage: true });

      // Opened: the Markdown, from the left edge.
      await card.getByRole("button", { name: "Read more" }).click();
      const instructions = card.locator(".agent-share-instructions");
      await instructions.getByRole("heading", { name: "Identity and Mission" }).waitFor();
      const headings = await instructions.getByRole("heading").allTextContents();
      assert.deepEqual(headings, ["Identity and Mission", "1. Operating Principles", "2. Daily checks"]);
      assert.equal(await instructions.locator("h2").count(), 3);
      assert.equal(await instructions.locator(":scope > ul > li").count(), 2);
      assert.equal(await instructions.locator("ul ul > li").count(), 1);
      assert.deepEqual(await instructions.locator("ol > li").allTextContents(), [
        "Read the error logs.",
        "Check the queue depth.",
        "Write a short summary.",
      ]);
      const style = await instructions.evaluate((element) => {
        const list = element.querySelector("ul");
        return {
          textAlign: getComputedStyle(element).textAlign,
          listStyle: list ? getComputedStyle(list).listStyleType : "",
        };
      });
      assert.ok(["start", "left"].includes(style.textAlign), style.textAlign);
      assert.equal(style.listStyle, "disc");

      // The web link is a link. The `javascript:` one and the raw HTML are text, and nothing ran.
      const text = (await instructions.textContent()) ?? "";
      assert.equal(
        await instructions.getByRole("link", { name: "runbook" }).getAttribute("href"),
        "https://example.com/runbook",
      );
      assert.equal(await instructions.getByRole("link", { name: "this link" }).count(), 0);
      assert.ok(text.includes("<script>window.agentShareInjected = true</script>"), text);
      assert.equal(await instructions.locator("script, img[onerror]").count(), 0);
      // A link in another person's text never asks its site for a favicon.
      assert.equal(await instructions.locator(".message-link-icon img").count(), 0);
      assert.deepEqual(faviconRequests, []);
      assert.equal(await page.evaluate(() => "agentShareInjected" in window), false);
      assert.deepEqual(errors, []);

      await page.screenshot({ path: resolve(OUT, `${view.name}-open.png`), fullPage: true });
      views.push({
        ...view,
        closedText,
        headings,
        textAlign: style.textAlign,
        screenshots: [`${view.name}-closed.png`, `${view.name}-open.png`],
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const report = { ok: true, pageUrl: `/agents/${TEMPLATE_ID}`, metaDescription, views };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
} catch (error) {
  writeFileSync(resolve(OUT, "site-output.log"), siteOutput);
  throw error;
} finally {
  const exited = new Promise<void>((done) => (site.exitCode === null ? site.once("exit", () => done()) : done()));
  site.kill("SIGTERM");
  await exited;
  await d1("execute", "--command", removeRows);
}
