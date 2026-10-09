import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { assertHost, joinHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, selectServer, send, t, upload } from "./support/ui";

test("host-isolation keeps drafts, attachments and file effects on the selected computer", async ({
  app,
  owner,
  serverId,
}) => {
  if (!serverId) throw new Error("This case requires a remote client.");
  const agentId = "release-codex"; // Both computers have this ID: server scope must disambiguate it.
  const name = "Release codex";
  const key = randomUUID();
  const filename = `host-${key}.txt`;
  const localFile = `local-${key}.txt`;
  const hostPath = join(owner.profile, "workspace-home/OpenBot/Agents", agentId);
  const localPath = join(app.profile, "workspace-home/OpenBot/Agents", agentId);
  try {
    await openAgent(app, name);
    await send(
      app,
      name,
      prompt({
        steps: [
          { kind: "hold", key },
          { kind: "write", name: filename, base64: Buffer.from("host").toString("base64") },
        ],
        reply: `Host result ${key}`,
      }),
    );
    await expect.poll(async () => (await conversation(app, agentId)).activeTurnId).not.toBeNull();
    const uploadPath = join(app.profile, `upload-${key}.txt`);
    await writeFile(uploadPath, key);
    await upload(app, uploadPath);
    const draft = prompt({ reply: `Host draft ${key}` });
    const composerName = t("composer.placeholder.message", { name });
    await app.page.getByRole("textbox", { name: composerName }).fill(draft);
    await selectServer(app, LOCAL_SERVER_ID);
    await openAgent(app, name);
    await expect(app.page.getByRole("textbox", { name: composerName })).toHaveText("");
    await expect(
      app.page.getByRole("button", { name: t("composer.attachment.remove", { name: `upload-${key}.txt` }) }),
    ).not.toBeVisible();
    await send(
      app,
      name,
      prompt({
        steps: [{ kind: "write", name: localFile, base64: Buffer.from("local").toString("base64") }],
        reply: `Local result ${key}`,
      }),
    );
    await completed(app, agentId, `Local result ${key}`);
    await owner.release(key);
    await completed(owner, agentId, `Host result ${key}`);
    expect((await conversation(app, agentId)).messages.some((item) => item.text === `Host result ${key}`)).toBe(false);
    await selectServer(app, serverId);
    await assertHost(app, serverId);
    await openAgent(app, name);
    await expect(app.page.getByRole("textbox", { name: composerName })).toHaveText(draft);
    await expect(
      app.page.getByRole("button", { name: t("composer.attachment.remove", { name: `upload-${key}.txt` }) }),
    ).toBeVisible();
    await app.page.getByRole("button", { name: t("composer.send.message"), exact: true }).click();
    await completed(app, agentId, `Host draft ${key}`);
    const history = await conversation(owner, agentId);
    expect(
      history.messages.filter((item) => item.text === draft).map((item) => item.attachments?.map((file) => file.name)),
    ).toEqual([[`upload-${key}.txt`]]);
    expect(history.messages.some((item) => item.text === `Local result ${key}`)).toBe(false);
    expect(await readFile(join(hostPath, filename), "utf8")).toBe("host");
    expect(await readFile(join(localPath, localFile), "utf8")).toBe("local");
    await expect(readFile(join(hostPath, localFile))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(localPath, filename))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await selectServer(app, serverId);
  }
});

test("host-reconnect reconnects through the UI without losing the conversation", async ({ app, owner, serverId }) => {
  if (!serverId) throw new Error("This case requires a remote client.");
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ reply: "Saved before host outage" }));
  await completed(app, agent.id, "Saved before host outage");
  const before = await conversation(app, agent.id);
  await owner.page.evaluate(() => window.openbot.host.stop());
  try {
    const retry = app.page.getByRole("button", { name: t("server.connection.retry"), exact: true });
    await expect(retry).toBeVisible();
    await owner.page.evaluate(() => window.openbot.host.start());
    await expect
      .poll(() => owner.page.evaluate(() => window.openbot.host.getStatus().then((status) => status.apiOnline)))
      .toBe(true);
    await retry.focus();
    await expect(retry).toBeFocused();
    await retry.press("Enter");
    await assertHost(app, serverId);
    await openAgent(app, agent.name);
    expect((await conversation(app, agent.id)).threadId).toBe(before.threadId);
    expect((await conversation(app, agent.id)).messages.map((item) => item.id)).toEqual(
      before.messages.map((item) => item.id),
    );
    await send(app, agent.name, prompt({ reply: "Sent after host reconnect" }));
    await completed(app, agent.id, "Sent after host reconnect");
    expect(
      (await conversation(owner, agent.id)).messages.filter((item) => item.text === "Sent after host reconnect"),
    ).toHaveLength(1);
  } finally {
    await owner.page.evaluate(() => window.openbot.host.start());
    await assertHost(app, serverId);
  }
});

test("host-revoke blocks stale message and file requests after membership removal", async ({
  app,
  owner,
  serverId,
}) => {
  if (!serverId) throw new Error("This case requires a remote client.");
  const agent = await newAgent(app);
  const marker = randomUUID();
  const name = `Member ${marker.slice(0, 8)}`;
  await app.page.evaluate((value) => window.openbot.auth.updateName(value), name);
  const filename = `private-${marker}.txt`;
  await openAgent(app, agent.name);
  await send(
    app,
    agent.name,
    prompt({
      steps: [{ kind: "write", name: filename, base64: Buffer.from(marker).toString("base64") }],
      reply: "Private file ready",
    }),
  );
  await completed(app, agent.id, "Private file ready");
  const file = { agentId: agent.id, path: filename };
  const preview = await app.page.evaluate(
    async ({ file, serverId }) => {
      const result = await window.openbot.agent.previewWorkspaceFile(file, serverId);
      return result.bytes ? new TextDecoder().decode(result.bytes) : null;
    },
    { file, serverId },
  );
  expect(preview).toBe(marker);
  const before = await conversation(owner, agent.id);
  const member = (await owner.page.evaluate(() => window.openbot.host.listMembers())).find(
    (item) => item.email === app.email,
  );
  if (!member) throw new Error("The client membership is missing.");
  const local = (await owner.page.evaluate(() => window.openbot.servers.list())).find(
    (item) => item.id === LOCAL_SERVER_ID,
  );
  if (!local) throw new Error("The owner server is missing.");
  await owner.page
    .getByRole("complementary", { name: t("server.rail.label") })
    .getByRole("button", { name: t("server.rail.buttonLabel", { name: local.name }), exact: true })
    .click({ button: "right" });
  await owner.page.getByRole("menuitem", { name: t("server.rail.settings"), exact: true }).click();
  await owner.page.getByRole("tab", { name: t("server.settings.membersTitle"), exact: true }).click();
  await owner.page
    .getByRole("button", {
      name: t("server.members.actionsFor", { name: member.name || member.email || member.username }),
      exact: true,
    })
    .click();
  await owner.page.getByRole("menuitem", { name: t("server.members.remove"), exact: true }).click();
  await owner.page.getByRole("button", { name: t("server.members.remove"), exact: true }).click();
  try {
    await expect
      .poll(async () =>
        (await owner.page.evaluate(() => window.openbot.host.listMembers())).some(
          (item) => item.id === member.id && !item.disabled,
        ),
      )
      .toBe(false);
    await expect
      .poll(async () =>
        (await app.page.evaluate(() => window.openbot.servers.list())).some((item) => item.id === serverId),
      )
      .toBe(false);
    await expect(
      app.page.evaluate(({ file, serverId }) => window.openbot.agent.previewWorkspaceFile(file, serverId), {
        file,
        serverId,
      }),
    ).rejects.toThrow();
    await expect(
      app.page.evaluate(
        ({ agentId, serverId }) =>
          window.openbot.agent.sendMessage({ agentId, text: "Unauthorized message" }, serverId),
        { agentId: agent.id, serverId },
      ),
    ).rejects.toThrow();
    expect((await conversation(owner, agent.id)).messages.map((item) => item.id)).toEqual(
      before.messages.map((item) => item.id),
    );
    expect(await readFile(join(owner.profile, "workspace-home/OpenBot/Agents", agent.id, filename), "utf8")).toBe(
      marker,
    );
  } finally {
    await owner.page.keyboard.press("Escape");
    await joinHost(owner, app);
  }
});
