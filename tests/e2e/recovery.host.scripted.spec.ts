import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, send, t } from "./support/ui";

test("delegation-reconnect preserves work and routes one recovery result", async ({ app, owner, serverId }) => {
  if (!serverId) throw new Error("This case requires a remote client.");
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
  // The client disconnects while the host keeps working, then reconnects to the finished result.
  await app.stop();
  await owner.release(key);
  const result = `Completed ${key}`;
  await completed(owner, parent.id, `Status: done\nResult: ${result}`);
  await app.restart();
  await assertHost(app, serverId);
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
  expect(await readFile(path, "utf8")).toBe("performed\n");
  await openAgent(app, child.name);
  await expect(
    app.page.getByRole("main", { name: t("conversation.view.label") }).getByText(result, { exact: true }),
  ).toBeVisible();
});
