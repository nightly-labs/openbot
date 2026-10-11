import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, resumeHost, send, t } from "./support/ui";

for (const restartOwner of [false, true]) {
  test(`delegation-${restartOwner ? "restart" : "reconnect"} preserves work and routes one recovery result`, async ({
    app,
    owner,
    serverId,
  }) => {
    const parent = await newAgent(app);
    const child = await newAgent(app);
    const key = randomUUID();
    const receipt = `receipt-${key}.txt`;
    const path = join(owner.profile, "workspace-home/OpenBot/Agents", child.id, receipt);
    const work = prompt({
      steps: [
        { kind: "write", name: receipt, base64: Buffer.from("performed\n").toString("base64"), append: true },
        { kind: "hold", key },
      ],
      reply: `Completed ${key}`,
    });
    await openAgent(app, parent.name);
    await send(
      app,
      parent.name,
      prompt({
        steps: [{ kind: "tool", name: "send_message", args: { recipientAgentIds: [child.id], text: work } }],
        reply: "Delegated work",
      }),
    );
    await completed(app, parent.id, "Delegated work");
    await expect.poll(() => readFile(path, "utf8").catch(() => "")).toBe("performed\n");
    const before = await conversation(app, child.id);
    const delivery = (await app.page.evaluate((id) => window.openbot.agent.listQueue(id), child.id)).deliveries.find(
      (item) => item.text === work,
    );
    if (!delivery) throw new Error("The delegated delivery is missing.");
    expect(delivery.sender).toEqual({ kind: "agent", agentId: parent.id });
    expect(delivery.messageId).toBeTruthy();
    expect(before.activeTurnId).not.toBeNull();
    if (restartOwner) {
      await owner.restart();
      if (serverId) await resumeHost(app, owner, serverId);
      await expect
        .poll(
          async () =>
            (await app.page.evaluate((id) => window.openbot.agent.listQueue(id), child.id)).deliveries.find(
              (item) => item.id === delivery.id,
            )?.status,
        )
        .toBe("interrupted");
      await owner.release(key);
      await openAgent(app, parent.name);
      await send(
        app,
        parent.name,
        prompt({
          steps: [
            {
              kind: "tool",
              name: "send_message",
              args: { recipientAgentIds: [child.id], text: prompt({ reply: `Recovered ${key}` }) },
            },
          ],
          reply: "Recovery requested",
        }),
      );
    } else {
      if (serverId) await app.stop();
      else await app.page.reload();
      await owner.release(key);
      await completed(owner, parent.id, `Status: done\nResult: Completed ${key}`);
      if (serverId) {
        await app.restart();
        await assertHost(app, serverId);
      }
    }
    const result = `${restartOwner ? "Recovered" : "Completed"} ${key}`;
    await completed(app, parent.id, `Status: done\nResult: ${result}`);
    const after = await conversation(app, child.id);
    expect(after.threadId).toBe(before.threadId);
    const restored = (await app.page.evaluate((id) => window.openbot.agent.listQueue(id), child.id)).deliveries.find(
      (item) => item.id === delivery.id,
    );
    expect(restored).toMatchObject({
      messageId: delivery.messageId,
      sender: delivery.sender,
      recipientAgentId: child.id,
    });
    const replies = (await conversation(app, parent.id)).messages.filter(
      (item) => item.senderAgentId === child.id && item.text.includes(`Status: done\nResult: ${result}`),
    );
    expect(replies).toHaveLength(1);
    if (restartOwner) expect(after.messages.some((item) => item.text === `Completed ${key}`)).toBe(false);
    expect(await readFile(path, "utf8")).toBe("performed\n");
    await openAgent(app, child.name);
    await expect(
      app.page.getByRole("main", { name: t("conversation.view.label") }).getByText(result, { exact: true }),
    ).toBeVisible();
  });
}

test("provider-failure retains input after an error and CLI crash and accepts recovery", async ({ app }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  const view = app.page.getByRole("main", { name: t("conversation.view.label") });
  for (const kind of ["fail", "crash"] as const) {
    const text = prompt({
      steps: [kind === "fail" ? { kind, message: "Release provider unavailable" } : { kind }],
      reply: "Must not finish",
    });
    await send(app, agent.name, text);
    await expect
      .poll(
        async () =>
          (await app.page.evaluate((id) => window.openbot.agent.listQueue(id), agent.id)).deliveries.find(
            (item) => item.text === text,
          )?.status,
      )
      .toBe(kind === "crash" ? "interrupted" : "failed");
    await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).toBeNull();
    await expect(app.page.getByRole("button", { name: t("composer.send.stop") })).not.toBeVisible();
    if (kind === "crash") {
      const picker = app.page.getByRole("button", { name: new RegExp(`^${t("provider.picker.agentModel")}:`) });
      await picker.click();
      await expect(app.page.getByText("Codex App Server exited with code 73.", { exact: true })).toBeVisible();
      await picker.click();
    } else await expect(view.getByText(/Release provider unavailable/).first()).toBeVisible();
    const failed = await conversation(app, agent.id);
    expect(failed.messages.filter((item) => item.author === "user" && item.text === text)).toHaveLength(1);
    expect(failed.messages.some((item) => item.text === "Must not finish")).toBe(false);
    const reply = `Recovered from ${kind}`;
    await send(app, agent.name, prompt({ reply }));
    await completed(app, agent.id, reply);
    expect((await conversation(app, agent.id)).messages.filter((item) => item.text === reply)).toHaveLength(1);
    await expect(view.getByText(reply, { exact: true })).toBeVisible();
  }
});
