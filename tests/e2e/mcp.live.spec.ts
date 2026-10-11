import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type CreateAgentInput, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { expect, test } from "./support/fixtures";
import { startMcpServer } from "./support/mcp-server";
import { fillMcp, openMcp } from "./support/mcp-ui";
import { modelFor, providers } from "./support/settings";
import { completed, conversation, openAgent, send, t } from "./support/ui";

test.use({ realProviders: true });

for (const provider of providers) {
  test(`live-mcp-${provider === "antigravity" ? "gemini" : provider} discovers and calls custom HTTP and STDIO tools`, async ({
    app,
    owner,
    serverId,
  }, testInfo) => {
    testInfo.annotations.push(
      { type: "provider", description: provider },
      { type: "model", description: modelFor(provider) },
    );
    const seed = (await app.page.evaluate(() => window.openbot.agent.listAgents())).find(
      (entry) => entry.id === `release-${provider}`,
    );
    if (!seed) throw new Error(`Missing ${provider} agent.`);
    const marker = randomUUID();
    const agent = await app.page.evaluate((input) => window.openbot.agent.createAgent(input), {
      name: `MCP ${provider} ${marker.slice(0, 8)}`,
      description: "Custom MCP visibility release test",
      initialMessage: "Reply READY without using tools.",
      provider,
      model: modelFor(provider),
      reasoningEffort: seed.reasoningEffort,
      avatarSeed: marker,
      avatarHue: null,
    } satisfies CreateAgentInput);
    await completed(app, agent.id, "READY");
    expect(agent).toMatchObject({ provider, model: modelFor(provider) });
    const token = randomUUID();
    const httpName = `http_${marker.replaceAll("-", "")}`;
    const stdioName = `stdio_${marker.replaceAll("-", "")}`;
    const receipt = join(owner.profile, "workspace-home/OpenBot/Agents", agent.id, `mcp-${marker}.txt`);
    // The receipt belongs to the agent's workspace, including with process confinement enabled.
    const endpoint = await startMcpServer(token);
    const scope = serverId ?? LOCAL_SERVER_ID;
    try {
      await openMcp(app);
      await fillMcp(app, { name: httpName, transport: "http", url: endpoint.url, token });
      await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
      await expect(
        app.page.getByRole("switch", { name: t("mcp.panel.enable", { name: httpName }), exact: true }),
      ).toBeChecked();
      await fillMcp(app, { name: stdioName, transport: "stdio", command: "bun", receipt });
      await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
      await expect(
        app.page.getByRole("switch", { name: t("mcp.panel.enable", { name: stdioName }), exact: true }),
      ).toBeChecked();
      await app.page.getByRole("button", { name: t("server.settings.close"), exact: true }).click();
      await openAgent(app, agent.name);
      await mkdir(dirname(receipt), { recursive: true });
      await writeFile(receipt, "");
      await send(
        app,
        agent.name,
        [
          `Find the custom MCP tools from servers ${httpName} and ${stdioName}.`,
          `Call ${httpName}'s record tool exactly once with value "http-${marker}".`,
          `Call ${stdioName}'s record tool exactly once with value "stdio-${marker}".`,
          "Use those MCP tools directly. Do not use shell, browser, or HTTP commands to imitate them.",
          "Reply with both tool results. Do not call either tool again.",
        ].join("\n"),
      );
      if (provider === "codex") {
        for (let permission = 0; permission < 2; permission += 1) {
          const allow = app.page.getByRole("radio", { name: /^Allow once/ }).first();
          await expect(allow).toBeVisible({ timeout: 120_000 });
          await allow.click();
          await expect
            .poll(
              async () =>
                endpoint.receipts.length + (await readFile(receipt, "utf8")).split("\n").filter(Boolean).length,
            )
            .toBe(permission + 1);
        }
      }
      await expect
        .poll(() => endpoint.receipts, {
          timeout: 120_000,
          message: `${provider} must see and call the HTTP MCP tool.`,
        })
        .toEqual([`http-${marker}`]);
      await expect
        .poll(async () => (await readFile(receipt, "utf8")).split("\n").filter(Boolean), {
          timeout: 120_000,
          message: `${provider} must see and call the STDIO MCP tool.`,
        })
        .toEqual([`stdio-${marker}`]);
      await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).toBeNull();
      const history = await conversation(app, agent.id);
      for (const transport of ["http", "stdio"]) {
        expect(
          history.messages.filter(
            (message) =>
              message.author === "assistant" && message.text.includes(`MCP recorded: ${transport}-${marker}`),
          ),
        ).toHaveLength(1);
      }
      expect(endpoint.receipts).toEqual([`http-${marker}`]);
      expect((await readFile(receipt, "utf8")).split("\n").filter(Boolean)).toEqual([`stdio-${marker}`]);
    } finally {
      // Remove per-case settings even on failure so reused workers cannot see a dead test endpoint.
      try {
        const configs = await app.page.evaluate((id) => window.openbot.agent.listMcpServers(id), scope);
        for (const config of configs.filter((entry) => entry.name === httpName || entry.name === stdioName)) {
          await app.page.evaluate(({ id, scope }) => window.openbot.agent.removeMcpServer({ mcpServerId: id }, scope), {
            id: config.id,
            scope,
          });
        }
      } finally {
        await endpoint.stop();
      }
    }
  });
}
