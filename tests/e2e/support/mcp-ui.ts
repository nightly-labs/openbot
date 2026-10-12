import { join } from "node:path";
import type { TestApp } from "./app";
import { root } from "./settings";
import { t } from "./ui";

export async function openMcp(app: TestApp) {
  const active = (await app.page.evaluate(() => window.openbot.servers.list())).find((server) => server.active);
  if (!active) throw new Error("The active test server is missing.");
  await app.page
    .getByRole("complementary", { name: t("server.rail.label") })
    .getByRole("button", { name: t("server.rail.buttonLabel", { name: active.name }), exact: true })
    .click({ button: "right" });
  await app.page.getByRole("menuitem", { name: t("server.rail.settings"), exact: true }).click();
  await app.page.getByRole("tab", { name: t("server.settings.mcpTitle"), exact: true }).click();
}

export async function fillMcp(
  app: TestApp,
  input: { name: string } & (
    | { transport: "http"; url: string; token: string }
    | { transport: "stdio"; command: string; receipt: string }
  ),
) {
  await app.page
    .getByRole("button", { name: t("mcp.panel.connectCustom"), exact: true })
    .first()
    .click();
  await app.page.getByRole("textbox", { name: t("mcp.panel.name"), exact: true }).fill(input.name);
  if (input.transport === "http") {
    await app.page.getByRole("tab", { name: "Streamable HTTP", exact: true }).click();
    await app.page.getByRole("textbox", { name: t("mcp.panel.serverUrl"), exact: true }).fill(input.url);
    await app.page
      .getByRole("textbox", { name: t("mcp.panel.headerKey", { position: 1 }), exact: true })
      .fill("x-e2e-token");
    await app.page
      .getByRole("textbox", { name: t("mcp.panel.headerValue", { position: 1 }), exact: true })
      .fill(input.token);
  } else {
    await app.page.getByRole("textbox", { name: t("mcp.panel.command"), exact: true }).fill(input.command);
    await app.page
      .getByRole("textbox", { name: t("mcp.panel.argument", { position: 1 }), exact: true })
      .fill(join(root, "tests/e2e/support/mcp-server.ts"));
    await app.page.getByRole("button", { name: t("mcp.panel.addArgument"), exact: true }).click();
    await app.page
      .getByRole("textbox", { name: t("mcp.panel.argument", { position: 2 }), exact: true })
      .fill("--stdio");
    await app.page
      .getByRole("textbox", { name: t("mcp.panel.environmentVariableKey", { position: 1 }), exact: true })
      .fill("OPENBOT_E2E_MCP_RECEIPT");
    await app.page
      .getByRole("textbox", { name: t("mcp.panel.environmentVariableValue", { position: 1 }), exact: true })
      .fill(input.receipt);
  }
}
