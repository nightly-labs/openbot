import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { assertHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { startMcpServer } from "./support/mcp-server";
import { fillMcp, openMcp } from "./support/mcp-ui";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, send, t } from "./support/ui";

for (const transport of ["http", "stdio"] as const) {
  test(`mcp-${transport} connects, calls a tool, disables, reconnects, and removes a custom server`, async ({
    app,
    owner,
    serverId,
  }) => {
    const marker = randomUUID();
    const token = randomUUID();
    const name = `release_${transport}_${marker.replaceAll("-", "")}`;
    const receipt = join(owner.profile, `mcp-${marker}.txt`);
    await writeFile(receipt, "");
    const agent = await newAgent(app);
    const endpoint = transport === "http" ? await startMcpServer(token) : null;
    const receipts = async () =>
      endpoint ? [...endpoint.receipts] : (await readFile(receipt, "utf8")).split("\n").filter(Boolean);
    const scope = serverId ?? LOCAL_SERVER_ID;
    const saved = () => app.page.evaluate((id) => window.openbot.agent.listMcpServers(id), scope);
    const close = () => app.page.getByRole("button", { name: t("server.settings.close"), exact: true }).click();
    const actions = () =>
      app.page.getByRole("button", { name: t("mcp.panel.actionsFor", { name }), exact: true }).click();
    const useTool = async (value: string, available: boolean) => {
      // Reuse the agent so configuration changes must reach its existing conversation.
      await openAgent(app, agent.name);
      await send(
        app,
        agent.name,
        prompt({ steps: [{ kind: "mcp", server: name, value, save: "result" }], reply: "$result:result" }),
      );
      const reply = available ? `MCP recorded: ${value}` : `MCP unavailable: ${value}`;
      await completed(app, agent.id, reply);
      expect(
        (await conversation(app, agent.id)).messages.filter(
          (message) => message.author === "assistant" && message.text === reply,
        ),
      ).toHaveLength(1);
    };
    try {
      await openMcp(app);
      await fillMcp(
        app,
        endpoint
          ? { name, transport: "http", url: endpoint.url, token: "incorrect" }
          : { name, transport: "stdio", command: join(owner.profile, "missing-command"), receipt },
      );
      await app.page.getByRole("button", { name: t("mcp.panel.testConnection"), exact: true }).click();
      const result = app.page.getByRole("status").filter({
        hasText:
          transport === "http"
            ? t("error.backend.mcpServerHttpCredentials", { status: 403 })
            : t("error.backend.mcpCommandNotFound", { command: join(owner.profile, "missing-command") }),
      });
      await expect(result).toBeVisible();
      expect((await saved()).some((config) => config.name === name)).toBe(false);
      if (endpoint)
        await app.page
          .getByRole("textbox", { name: t("mcp.panel.headerValue", { position: 1 }), exact: true })
          .fill(token);
      else await app.page.getByRole("textbox", { name: t("mcp.panel.command"), exact: true }).fill("bun");
      await expect(
        app.page.getByRole("status").filter({ hasText: t("mcp.test.connected", { count: 1 }) }),
      ).not.toBeVisible();
      await app.page.getByRole("button", { name: t("mcp.panel.testConnection"), exact: true }).click();
      await expect(
        app.page.getByRole("status").filter({ hasText: t("mcp.test.connected", { count: 1 }) }),
      ).toBeVisible();
      expect(await receipts()).toEqual([]);
      await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
      await expect.poll(async () => (await saved()).filter((config) => config.name === name).length).toBe(1);
      const config = (await saved()).find((entry) => entry.name === name);
      expect(config).toMatchObject({ name, transport, enabled: true });
      expect(
        (await owner.page.evaluate((id) => window.openbot.agent.listMcpServers(id), LOCAL_SERVER_ID)).find(
          (entry) => entry.name === name,
        ),
      ).toEqual(config);
      if (serverId)
        expect(
          (await app.page.evaluate((id) => window.openbot.agent.listMcpServers(id), LOCAL_SERVER_ID)).some(
            (entry) => entry.name === name,
          ),
        ).toBe(false);
      await close();
      await app.page.reload();
      if (serverId) await assertHost(app, serverId);
      await openMcp(app);
      await actions();
      await app.page.getByRole("menuitem", { name: t("common.edit"), exact: true }).click();
      await expect(app.page.getByRole("textbox", { name: t("mcp.panel.name"), exact: true })).toHaveValue(name);
      if (endpoint)
        await expect(app.page.getByRole("textbox", { name: t("mcp.panel.serverUrl"), exact: true })).toHaveValue(
          endpoint.url,
        );
      else
        await expect(app.page.getByRole("textbox", { name: t("mcp.panel.command"), exact: true })).toHaveValue("bun");
      expect((await saved()).find((entry) => entry.name === name)).toEqual(config);
      await close();
      await useTool(marker, true);
      expect(await receipts()).toEqual([marker]);
      await openMcp(app);
      const enabled = app.page.getByRole("switch", { name: t("mcp.panel.enable", { name }), exact: true });
      await enabled.focus();
      await enabled.press("Space");
      await expect(enabled).not.toBeChecked();
      await expect.poll(async () => (await saved()).find((entry) => entry.name === name)?.enabled).toBe(false);
      await close();
      await useTool(`disabled-${marker}`, false);
      expect(await receipts()).toEqual([marker]);
      await openMcp(app);
      await enabled.focus();
      await enabled.press("Space");
      await expect(enabled).toBeChecked();
      await expect.poll(async () => (await saved()).find((entry) => entry.name === name)?.enabled).toBe(true);
      await close();
      await useTool(`reconnected-${marker}`, true);
      expect(await receipts()).toEqual([marker, `reconnected-${marker}`]);
      await openMcp(app);
      await actions();
      await app.page.getByRole("menuitem", { name: t("common.remove"), exact: true }).click();
      await app.page.getByRole("button", { name: t("mcp.panel.removeConfirm"), exact: true }).click();
      await expect.poll(async () => (await saved()).some((entry) => entry.name === name)).toBe(false);
      await expect(enabled).not.toBeVisible();
      await close();
      await useTool(`removed-${marker}`, false);
      expect(await receipts()).toEqual([marker, `reconnected-${marker}`]);
    } finally {
      await endpoint?.stop();
    }
  });
}
