import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { argument, connectChannelE2e, WAIT_MS, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "mcp-sign-in-card-smoke";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
mkdirSync(OUT, { recursive: true });
const english = translateFor("en");
const SERVER_ID = "local";
const SERVER_NAME = "parallel";
const CATALOG_URL = "https://mcp.parallel.ai/mcp";
const LOGIN_URL = `${CATALOG_URL}?login`;
const UI_WAIT_MS = 60_000;
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Report {
  agentId: string;
  cardPosted: boolean;
  savedBackToCatalog: boolean;
  notNeededShown: boolean;
  marketplaceOpened: boolean;
  screenshot: string | null;
  pageErrors: string[];
  passed: boolean;
}

const report: Report = {
  agentId,
  cardPosted: false,
  savedBackToCatalog: false,
  notNeededShown: false,
  marketplaceOpened: false,
  screenshot: null,
  pageErrors: [],
  passed: false,
};
const session = await connectChannelE2e(NAME);
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));

const savedRow = () =>
  page.evaluate(
    async ({ serverId, name }) =>
      (await window.openbot.agent.listMcpServers(serverId)).find((row) => row.name === name) ?? null,
    { serverId: SERVER_ID, name: SERVER_NAME },
  );

const saveAddress = (row: McpServerConfig | null, url: string) =>
  page.evaluate(async ({ serverId, config }) => window.openbot.agent.saveMcpServer({ config }, serverId), {
    serverId: SERVER_ID,
    config: row
      ? { ...row, url }
      : {
          id: "",
          name: SERVER_NAME,
          transport: "http" as const,
          enabled: true,
          command: "",
          args: [],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url,
          headers: [],
        },
  });

try {
  await saveAddress(await savedRow(), CATALOG_URL);
  const agent = await page.evaluate(async (id) => {
    const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown agent: ${id}`);
    return { name: found.name };
  }, agentId);
  await page.bringToFront();
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agent.name)}[,.]`) })
    .first()
    .click();

  const signIn = page.getByRole("button", {
    name: english("chat.mcpSignIn.signInNamed", { name: SERVER_NAME }),
    exact: true,
  });
  const cardsBefore = await signIn.count();
  const composer = page.getByRole("textbox", {
    name: english("composer.placeholder.message", { name: agent.name }),
    exact: true,
  });
  await composer.fill(
    `Use openbot.save_mcp_server to change the address of the MCP server named ${SERVER_NAME} to ${LOGIN_URL}. Do nothing else.`,
  );
  await composer.press("Enter");
  await waitFor(
    page,
    "the agent saves the sign-in address and a Sign in card appears",
    async () => ({ url: (await savedRow())?.url ?? null, cards: await signIn.count() }),
    (state) => state.url === LOGIN_URL && state.cards > cardsBefore,
    WAIT_MS,
  );
  report.cardPosted = true;

  await saveAddress(await savedRow(), CATALOG_URL);
  report.savedBackToCatalog = (await savedRow())?.url === CATALOG_URL;
  assert.ok(report.savedBackToCatalog, "The server did not go back to the Marketplace address.");

  await signIn.last().click();
  const notNeeded = page.getByText(english("chat.mcpSignIn.notNeeded", { name: SERVER_NAME }), { exact: true });
  const marketplace = page.getByRole("region", { name: english("marketplace.title"), exact: true });
  await Promise.race([
    notNeeded.last().waitFor({ timeout: UI_WAIT_MS }),
    marketplace.waitFor({ timeout: UI_WAIT_MS }),
  ]).catch(() => undefined);
  report.notNeededShown = await notNeeded.last().isVisible();
  report.marketplaceOpened = await marketplace.isVisible();
  report.screenshot = resolve(OUT, "after-sign-in.png");
  await page.screenshot({ path: report.screenshot });
  report.passed = report.notNeededShown && !report.marketplaceOpened && report.pageErrors.length === 0;
} finally {
  const path = writeReport(NAME, report);
  createOpenBotLogger(NAME).info("Wrote the report.", { report: path, passed: report.passed });
  await session.close();
}

assert.ok(report.passed, "The stale Sign in card did not show that the server works without a sign-in.");
