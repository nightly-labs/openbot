import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { z } from "zod";
import { expect, test } from "./support/fixtures";
import { startMcpServer } from "./support/mcp-server";
import { fillMcp, openMcp } from "./support/mcp-ui";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, resumeHost, send, t } from "./support/ui";

for (const transport of ["http", "stdio"] as const) {
  test(`mcp-${transport} connects, calls a tool, disables, reconnects, and removes a custom server`, async ({
    app,
    owner,
    serverId,
  }) => {
    const marker = randomUUID();
    const token = randomUUID();
    const name = `release_${transport}_${marker.replaceAll("-", "")}`;
    const firstReceipt = join(owner.profile, `mcp-${marker}.txt`);
    let receipt = firstReceipt;
    await writeFile(receipt, "");
    const agent = await newAgent(app);
    const endpoints: Awaited<ReturnType<typeof startMcpServer>>[] = [];
    const serve = async (value: string) => {
      const server = await startMcpServer(value);
      endpoints.push(server);
      return server;
    };
    let endpoint = transport === "http" ? await serve(token) : null;
    const receipts = async () =>
      endpoint ? [...endpoint.receipts] : (await readFile(receipt, "utf8")).split("\n").filter(Boolean);
    const scope = serverId ?? LOCAL_SERVER_ID;
    const saved = () => app.page.evaluate((id) => window.openbot.agent.listMcpServers(id), scope);
    const close = () => app.page.getByRole("button", { name: t("server.settings.close"), exact: true }).click();
    const status = (text: string) => app.page.getByRole("status").filter({ hasText: text });
    const testConnection = () =>
      app.page.getByRole("button", { name: t("mcp.panel.testConnection"), exact: true }).click();
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
      await owner.restart();
      if (serverId) await resumeHost(app, owner, serverId);
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
      // An edit must reach the agent's existing conversation. The old target gets no further calls.
      const nextToken = randomUUID();
      const first = endpoint;
      if (endpoint) endpoint = await serve(nextToken);
      else {
        receipt = join(owner.profile, `mcp-${marker}-edited.txt`);
        await writeFile(receipt, "");
      }
      await openMcp(app);
      await actions();
      await app.page.getByRole("menuitem", { name: t("common.edit"), exact: true }).click();
      if (endpoint) {
        await app.page.getByRole("textbox", { name: t("mcp.panel.serverUrl"), exact: true }).fill(endpoint.url);
        await testConnection();
        await expect(status(t("error.backend.mcpServerHttpCredentials", { status: 403 }))).toBeVisible();
        await app.page
          .getByRole("textbox", { name: t("mcp.panel.headerValue", { position: 1 }), exact: true })
          .fill(nextToken);
      } else
        await app.page
          .getByRole("textbox", { name: t("mcp.panel.environmentVariableValue", { position: 1 }), exact: true })
          .fill(receipt);
      await testConnection();
      await expect(status(t("mcp.test.connected", { count: 1 }))).toBeVisible();
      await app.page.getByRole("button", { name: t("common.save"), exact: true }).click();
      await expect
        .poll(async () => (await saved()).find((entry) => entry.name === name))
        .toMatchObject(
          endpoint
            ? { url: endpoint.url, headers: [{ key: "x-e2e-token", value: nextToken }] }
            : { env: [{ key: "OPENBOT_E2E_MCP_RECEIPT", value: receipt }] },
        );
      await close();
      await useTool(`edited-${marker}`, true);
      expect(await receipts()).toEqual([`edited-${marker}`]);
      if (first) expect(first.receipts).toEqual([marker]);
      else expect((await readFile(firstReceipt, "utf8")).split("\n").filter(Boolean)).toEqual([marker]);
      // OpenBot saves only a disabled placeholder in the provider's user config file.
      // The endpoint, credentials, and environment values stay in the thread configuration.
      const userConfig = await readFile(join(owner.profile, "protocol", "codex-user-config.json"), "utf8");
      expect(
        z.object({ config: z.object({ mcp_servers: z.record(z.string(), z.json()) }) }).parse(JSON.parse(userConfig))
          .config.mcp_servers[name],
      ).toEqual(
        transport === "http"
          ? { url: "http://127.0.0.1:1", enabled: false }
          : { command: "openbot-mcp", enabled: false },
      );
      for (const secret of [token, nextToken, firstReceipt, receipt, ...endpoints.map((server) => server.url)])
        expect(userConfig).not.toContain(secret);
      await openMcp(app);
      const enabled = app.page.getByRole("switch", { name: t("mcp.panel.enable", { name }), exact: true });
      await enabled.focus();
      await enabled.press("Space");
      await expect(enabled).not.toBeChecked();
      await expect.poll(async () => (await saved()).find((entry) => entry.name === name)?.enabled).toBe(false);
      await close();
      await useTool(`disabled-${marker}`, false);
      expect(await receipts()).toEqual([`edited-${marker}`]);
      await openMcp(app);
      await enabled.focus();
      await enabled.press("Space");
      await expect(enabled).toBeChecked();
      await expect.poll(async () => (await saved()).find((entry) => entry.name === name)?.enabled).toBe(true);
      await close();
      await useTool(`reconnected-${marker}`, true);
      expect(await receipts()).toEqual([`edited-${marker}`, `reconnected-${marker}`]);
      await openMcp(app);
      await actions();
      await app.page.getByRole("menuitem", { name: t("common.remove"), exact: true }).click();
      await app.page.getByRole("button", { name: t("mcp.panel.removeConfirm"), exact: true }).click();
      await expect.poll(async () => (await saved()).some((entry) => entry.name === name)).toBe(false);
      await expect(enabled).not.toBeVisible();
      await close();
      await useTool(`removed-${marker}`, false);
      expect(await receipts()).toEqual([`edited-${marker}`, `reconnected-${marker}`]);
    } finally {
      await Promise.all(endpoints.map((server) => server.stop()));
    }
  });
}
