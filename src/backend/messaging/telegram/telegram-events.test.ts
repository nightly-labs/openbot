import { describe, expect, it } from "vitest";
import { TELEGRAM_ACTION_PREFIX, telegramInboundAction, telegramInboundMessage } from "./telegram-events";

describe("telegramInboundMessage", () => {
  const botUserId = "987654";
  const botUsername = "OpenBotDevBot";

  it("handles a private (direct) message", () => {
    const update = {
      update_id: 101,
      message: {
        message_id: 42,
        from: { id: 12345, first_name: "Alice", username: "alice_dev" },
        chat: { id: 12345, type: "private" },
        date: 1700000000,
        text: "Please help me write a script",
      },
    };

    const inbound = telegramInboundMessage(update, botUserId, botUsername);
    expect(inbound).not.toBeNull();
    expect(inbound?.platformMessageId).toBe("42");
    expect(inbound?.authorId).toBe("12345");
    expect(inbound?.isDirect).toBe(true);
    expect(inbound?.platformChannelId).toBe("12345");
    expect(inbound?.threadKey).toBe("12345");
    expect(inbound?.text).toBe("Please help me write a script");
  });

  it("handles a group message mentioning the bot", () => {
    const update = {
      update_id: 102,
      message: {
        message_id: 43,
        from: { id: 54321, first_name: "Bob" },
        chat: { id: -1001234567, type: "supergroup", title: "Dev Group" },
        date: 1700000001,
        text: `@${botUsername} build the project`,
      },
    };

    const inbound = telegramInboundMessage(update, botUserId, botUsername);
    expect(inbound).not.toBeNull();
    expect(inbound?.isDirect).toBe(false);
    expect(inbound?.platformChannelId).toBe("-1001234567");
    expect(inbound?.text).toBe("build the project");
  });

  it("ignores messages sent by the bot itself", () => {
    const update = {
      update_id: 103,
      message: {
        message_id: 44,
        from: { id: Number(botUserId), first_name: "OpenBot" },
        chat: { id: 12345, type: "private" },
        date: 1700000002,
        text: "My own answer",
      },
    };

    const inbound = telegramInboundMessage(update, botUserId, botUsername);
    expect(inbound).toBeNull();
  });

  it("handles document attachments", () => {
    const update = {
      update_id: 104,
      message: {
        message_id: 45,
        from: { id: 12345, first_name: "Alice" },
        chat: { id: 12345, type: "private" },
        date: 1700000003,
        caption: "Check this log",
        document: {
          file_id: "file_doc_123",
          file_name: "build.log",
          mime_type: "text/plain",
          file_size: 2048,
        },
      },
    };

    const inbound = telegramInboundMessage(update, botUserId, botUsername);
    expect(inbound).not.toBeNull();
    expect(inbound?.text).toBe("Check this log");
    expect(inbound?.files).toHaveLength(1);
    expect(inbound?.files[0]?.id).toBe("file_doc_123");
    expect(inbound?.files[0]?.name).toBe("build.log");
  });
});

describe("telegramInboundAction", () => {
  it("parses valid inline callback buttons", () => {
    const update = {
      update_id: 201,
      callback_query: {
        id: "cq_123",
        from: { id: 12345, first_name: "Alice" },
        data: `${TELEGRAM_ACTION_PREFIX}:accept:tok_abc_123`,
        message: {
          message_id: 77,
          chat: { id: 999 },
        },
      },
    };

    const action = telegramInboundAction(update);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("approval");
    if (action?.type === "approval") {
      expect(action.decision).toBe("accept");
    }
    expect(action?.token).toBe("tok_abc_123");
    expect(action?.actorId).toBe("12345");
    expect(action?.platformMessageId).toBe("77");
  });

  it("ignores non-openbot callback queries", () => {
    const update = {
      update_id: 202,
      callback_query: {
        id: "cq_456",
        from: { id: 12345, first_name: "Alice" },
        data: "other_plugin:test:123",
      },
    };

    const action = telegramInboundAction(update);
    expect(action).toBeNull();
  });
});

describe("allowed chat IDs filtering", () => {
  const botUserId = "987654";
  const botUsername = "OpenBotDevBot";
  const originalEnv = process.env.TELEGRAM_ALLOWED_CHAT_IDS;

  it("filters out messages from chats not in TELEGRAM_ALLOWED_CHAT_IDS", () => {
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = "6179129034,99999999";
    try {
      const unauthorizedUpdate = {
        update_id: 301,
        message: {
          message_id: 50,
          from: { id: 11111, first_name: "Attacker" },
          chat: { id: 11111, type: "private" },
          text: "hacked",
        },
      };
      expect(telegramInboundMessage(unauthorizedUpdate, botUserId, botUsername)).toBeNull();

      const authorizedUpdate = {
        update_id: 302,
        message: {
          message_id: 51,
          from: { id: 6179129034, first_name: "Owner" },
          chat: { id: 6179129034, type: "private" },
          text: "hello bot",
        },
      };
      expect(telegramInboundMessage(authorizedUpdate, botUserId, botUsername)).not.toBeNull();
    } finally {
      if (originalEnv !== undefined) {
        process.env.TELEGRAM_ALLOWED_CHAT_IDS = originalEnv;
      } else {
        delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
      }
    }
  });

  it("handles openbot prefix in group chats without explicit @ mention", () => {
    const update = {
      update_id: 303,
      message: {
        message_id: 52,
        from: { id: 12345, first_name: "Dev" },
        chat: { id: -10055555, type: "supergroup", title: "Dev Group" },
        text: "openbot ping",
      },
    };
    const inbound = telegramInboundMessage(update, botUserId, botUsername);
    expect(inbound).not.toBeNull();
    expect(inbound?.requiresLink).toBe(false);
    expect(inbound?.text).toBe("openbot ping");
  });
});
