import {
  ApplicationFlags,
  GatewayDispatchEvents,
  GatewayOpcodes,
  type GatewayReadyDispatch,
} from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { type DiscordMessageData, DiscordState, normalizeGuildMessage } from "../src/discord-events";

const BOT = "900";

function message(overrides: Partial<DiscordMessageData> = {}): DiscordMessageData {
  return {
    id: "500",
    channel_id: "110",
    guild_id: "100",
    content: `<@${BOT}> summarize <@!${BOT}> this for <@42>`,
    timestamp: "2026-10-06T12:00:00.000Z",
    author: { id: "42", username: "ada", global_name: "Ada", bot: false },
    member: { nick: "Ada L." },
    mentions: [{ id: BOT }],
    attachments: [
      { id: "1", filename: "a.png", content_type: "image/png", size: 10, url: "https://cdn.discordapp.com/a.png" },
      { id: "2", filename: "b.png", size: 10, url: "https://example.com/b.png" },
    ],
    ...overrides,
  };
}

describe("Discord message normalization", () => {
  it("passes on a mention of the bot without the bot's mention", () => {
    expect(normalizeGuildMessage(message(), BOT)).toEqual({
      id: "500",
      channelId: "110",
      authorId: "42",
      authorName: "Ada L.",
      content: "summarize  this for <@42>",
      replyTo: null,
      attachments: [
        { id: "1", filename: "a.png", contentType: "image/png", size: 10, url: "https://cdn.discordapp.com/a.png" },
      ],
      sentAt: "2026-10-06T12:00:00.000Z",
    });
  });

  it("drops bots, webhooks and messages that do not mention the bot", () => {
    expect(normalizeGuildMessage(message({ author: { id: "7", username: "other", bot: true } }), BOT)).toBeNull();
    expect(normalizeGuildMessage(message({ webhook_id: "8" }), BOT)).toBeNull();
    expect(normalizeGuildMessage(message({ mentions: [{ id: "42" }] }), BOT)).toBeNull();
  });

  it("names the conversation's root only for a reply to the bot", () => {
    const toBot = normalizeGuildMessage(
      message({
        message_reference: { type: 0, message_id: "400" },
        referenced_message: { id: "400", author: { id: BOT }, message_reference: { message_id: "300" } },
      }),
      BOT,
    );
    expect(toBot?.replyTo).toEqual({ messageId: "400", authorIsBot: true, rootId: "300" });

    const toPerson = normalizeGuildMessage(
      message({
        message_reference: { type: 0, message_id: "401" },
        referenced_message: { id: "401", author: { id: "43" }, message_reference: { message_id: "300" } },
      }),
      BOT,
    );
    expect(toPerson?.replyTo).toEqual({ messageId: "401", authorIsBot: false, rootId: null });
  });
});

// Guild 8388608 is on shard 0 of 2 and guild 4194304 on shard 1: Discord uses `(id >> 22) % count`.
function ready(shard: [number, number], guilds: string[]): GatewayReadyDispatch {
  return {
    op: GatewayOpcodes.Dispatch,
    t: GatewayDispatchEvents.Ready,
    s: 1,
    d: {
      v: 10,
      user: { id: BOT, username: "openbot", discriminator: "0", global_name: null, avatar: null },
      guilds: guilds.map((id) => ({ id, unavailable: true })),
      session_id: "session",
      resume_gateway_url: "wss://gateway.discord.gg",
      shard,
      application: { id: "1", flags: ApplicationFlags.GatewayMessageContentLimited, flags_new: "0" },
    },
  };
}

describe("Discord guild membership", () => {
  it("is known only after every shard is ready, and follows a removal", () => {
    const state = new DiscordState("1");
    expect(state.handle(ready([0, 2], ["8388608"]))).toEqual([]);
    expect(state.memberGuildIds()).toBeNull();
    expect(state.isMember("8388608")).toBeNull();

    expect(state.handle(ready([1, 2], ["4194304"]))).toEqual([{ type: "reconcile" }]);
    expect(state.memberGuildIds()?.sort()).toEqual(["4194304", "8388608"]);
    expect(state.isMember("4194304")).toBe(true);
    expect(state.isMember("12582912")).toBe(false);

    state.handle({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.GuildDelete, s: 2, d: { id: "4194304" } });
    expect(state.isMember("4194304")).toBe(false);
    // A closed shard can miss a new guild: nothing is sent until it resumes or is ready again.
    state.shardClosed(1);
    expect(state.memberGuildIds()).toBeNull();
    expect(state.shardResumed(1)).toEqual([{ type: "reconcile" }]);
    expect(state.memberGuildIds()).toEqual(["8388608"]);
    state.shardClosed(0);
    // A new session of a shard lists its guilds again.
    expect(state.handle(ready([0, 2], []))).toEqual([{ type: "reconcile" }]);
    expect(state.memberGuildIds()).toEqual([]);
  });
});
