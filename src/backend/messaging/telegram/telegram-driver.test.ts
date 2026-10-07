// @vitest-environment node

import { createServer, type Server } from "node:http";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../../effect-boundary";
import { TelegramHistoryStore, telegramDriver } from "./telegram-driver";

const TOKEN = "123456:ABC-DEF-GHI-TEST-TOKEN";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server has no port.");
  return `http://127.0.0.1:${address.port}`;
}

describe("telegramDriver", () => {
  it("creates an adapter and identifies the bot", async () => {
    const origin = await listen((req, res) => {
      if (req.url === `/bot${TOKEN}/getMe`) {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            result: { id: 12345, is_bot: true, first_name: "Test Bot", username: "my_test_bot" },
          }),
        );
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const driver = telegramDriver({ origin });
    const adapter = driver.createAdapter({ botToken: TOKEN }, { rateLimited: () => undefined });
    const identity = await runCauseEffect(adapter.identify());

    expect(identity.workspaceId).toBe("12345");
    expect(identity.workspaceName).toBe("@my_test_bot");
    expect(identity.botUserId).toBe("12345");
  });

  it("posts messages and returns telegram message ID", async () => {
    let sentMethod = "";
    let sentPayload: DynamicRecord = {};

    const origin = await listen(async (req, res) => {
      sentMethod = req.url ?? "";
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (isDynamicRecord(parsed)) sentPayload = parsed;

      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          result: { message_id: 9988, chat: { id: 1122 } },
        }),
      );
    });

    const driver = telegramDriver({ origin });
    const adapter = driver.createAdapter({ botToken: TOKEN }, { rateLimited: () => undefined });

    const msgId = await runCauseEffect(
      adapter.post(
        { platformChannelId: "1122", replyThreadId: null },
        {
          text: "Hello **Telegram**!",
          buttons: [{ action: "accept", label: "Approve", token: "tok123" }],
        },
      ),
    );

    expect(msgId).toBe("9988");
    expect(sentMethod).toBe(`/bot${TOKEN}/sendMessage`);
    expect(sentPayload.chat_id).toBe("1122");
    expect(sentPayload.text).toContain("<b>Telegram</b>");
    expect(isDynamicRecord(sentPayload.reply_markup)).toBe(true);
  });

  it("edits an existing message", async () => {
    let editedPayload: DynamicRecord = {};

    const origin = await listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      editedPayload = JSON.parse(Buffer.concat(chunks).toString("utf8"));

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: true }));
    });

    const driver = telegramDriver({ origin });
    const adapter = driver.createAdapter({ botToken: TOKEN }, { rateLimited: () => undefined });

    await runCauseEffect(
      adapter.edit({ platformChannelId: "1122", replyThreadId: null }, "9988", {
        text: "Updated text",
      }),
    );

    expect(editedPayload.chat_id).toBe("1122");
    expect(editedPayload.message_id).toBe(9988);
    expect(editedPayload.text).toBe("Updated text");
  });

  it("maintains conversation history context store", async () => {
    const store = new TelegramHistoryStore();
    store.add("1122", "1122", {
      id: "1",
      authorName: "Alice",
      text: "First message",
      sentAt: "2026-01-01T00:00:00Z",
    });
    store.add("1122", "1122", {
      id: "2",
      authorName: "Bob",
      text: "Second message",
      sentAt: "2026-01-01T00:01:00Z",
    });
    store.add("1122", "1122", {
      id: "3",
      authorName: "Alice",
      text: "Third message",
      sentAt: "2026-01-01T00:02:00Z",
    });

    const context = store.get("1122", "1122", null, "3");
    expect(context).toHaveLength(2);
    expect(context[0]?.id).toBe("1");
    expect(context[1]?.id).toBe("2");
  });
});
