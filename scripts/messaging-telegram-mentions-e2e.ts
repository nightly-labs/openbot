// Checks that a Telegram answer notifies the people it mentions. Runs the real Telegram driver and
// adapter; only Signal's relay of the Bot API calls is a stand-in, so no bot, account or network is
// used. An answer with `@username` or `@<user id>` is a new post with live mentions, because an edit
// notifies nobody, and the status post goes only after that post; an answer without one still edits
// the status post; the plain-text fallback and a status post still mention nobody.
//
// Run: bun scripts/messaging-telegram-mentions-e2e.ts
// Writes .openbot-build/messaging-telegram-mentions-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  TelegramCallMethod,
  TelegramCallParams,
  TelegramCallResult,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  MessagingAdapterError,
  type MessagingIngress,
  TelegramCallError,
} from "../src/backend/messaging/messaging-types";
import { telegramDriver } from "../src/backend/messaging/telegram/telegram-driver";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-telegram-mentions-e2e");
const BOT = "7000000001";
const CHAT = "-1001234567890";
const WORD_JOINER = "⁠";
const USER_ID = "424242424";

interface Call {
  method: TelegramCallMethod;
  params: TelegramCallParams[TelegramCallMethod];
}

interface Report {
  steps: { name: string; passed: boolean; detail?: unknown; error?: string }[];
  passed: boolean;
}

const report: Report = { steps: [], passed: false };
const calls: Call[] = [];
let nextMessageId = 500;
/** While set, Telegram refuses the next HTML post as it refuses HTML that it cannot parse. */
let refuseHtml = false;
/** While set, Telegram refuses the next post, as for a chat that the bot left. */
let refusePost = false;

const unused = (): never => {
  throw new Error("The Telegram adapter used a relay call that this check does not give.");
};

const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "online",
  onState: () => () => {},
  handle: () => {},
  reconnect: () => {},
  discord: unused,
  onDiscordRoutes: () => () => {},
  telegram: {
    available: () => true,
    call<M extends TelegramCallMethod>(
      botId: string,
      method: M,
      params: TelegramCallParams[M],
    ): Effect.Effect<TelegramCallResult, MessagingAdapterError> {
      assert.equal(botId, BOT);
      calls.push({ method, params });
      if (refuseHtml && "parse_mode" in params && method === "sendMessage" && params.parse_mode === "HTML") {
        refuseHtml = false;
        return Effect.fail(
          new MessagingAdapterError({
            cause: new TelegramCallError(400, "Bad Request: can't parse entities", null),
          }),
        );
      }
      if (refusePost && method === "sendMessage") {
        refusePost = false;
        return Effect.fail(
          new MessagingAdapterError({ cause: new TelegramCallError(400, "Bad Request: chat not found", null) }),
        );
      }
      nextMessageId += 1;
      return Effect.succeed(method === "sendMessage" ? { messageId: nextMessageId } : {});
    },
    download: unused,
    upload: unused,
  },
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  const entry: Report["steps"][number] = { name, passed: false };
  report.steps.push(entry);
  try {
    entry.detail = await run();
    entry.passed = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/** The calls that `run` makes. */
async function callsOf(run: () => Promise<unknown>): Promise<Call[]> {
  const from = calls.length;
  await run();
  return calls.slice(from);
}

function textOf(call: Call | undefined): string {
  assert.ok(call && "text" in call.params, `The ${call?.method ?? "missing"} call has no text.`);
  return call.params.text ?? "";
}

function messageIdOf(call: Call | undefined): number | undefined {
  return call && "message_id" in call.params ? call.params.message_id : undefined;
}

function parseModeOf(call: Call | undefined): string | undefined {
  return call && "parse_mode" in call.params ? call.params.parse_mode : undefined;
}

const adapter = telegramDriver({ ingress }).createAdapter(
  { botId: BOT, chatId: CHAT, botUsername: "openbot_e2e_bot", chatTitle: "E2E group" },
  { rateLimited: () => {} },
);
const target = { platformChannelId: CHAT, replyThreadId: null };

try {
  await step("an answer without a mention edits the status post", async () => {
    const made = await callsOf(() => runCauseEffect(adapter.postAnswer(target, "Done, see **this**.", "100")));
    assert.deepEqual(
      made.map((call) => call.method),
      ["editMessageText"],
    );
    assert.equal(messageIdOf(made[0]), 100);
    return { methods: made.map((call) => call.method) };
  });

  await step("an answer with a mention is a new post that mentions the people", async () => {
    let answerId = "";
    const made = await callsOf(async () => {
      answerId = await runCauseEffect(
        adapter.postAnswer(target, `Done @${USER_ID}, and @alice_bob please check.`, "101"),
      );
    });
    assert.deepEqual(
      made.map((call) => call.method),
      ["sendMessage", "deleteMessage"],
      "An answer with a mention edited the status post, which notifies nobody.",
    );
    assert.equal(messageIdOf(made[1]), 101, "The status post was not deleted.");
    assert.notEqual(answerId, "101");
    const html = textOf(made[0]);
    assert.equal(parseModeOf(made[0]), "HTML");
    assert.ok(html.includes(`<a href="tg://user?id=${USER_ID}">${USER_ID}</a>`), "The user id is not a mention link.");
    assert.ok(html.includes("@alice_bob") && !html.includes(WORD_JOINER), "The @username is not a live mention.");
    return { html };
  });

  await step("when the new post fails, the status post stays for the next attempt", async () => {
    refusePost = true;
    const made = await callsOf(async () => {
      const result = await Effect.runPromise(Effect.result(adapter.postAnswer(target, "Done @alice_bob", "103")));
      assert.equal(result._tag, "Failure", "A refused post did not fail the answer.");
    });
    assert.deepEqual(
      made.map((call) => call.method),
      ["sendMessage"],
      "The status post was deleted before the answer was posted.",
    );
    return { methods: made.map((call) => call.method) };
  });

  await step("a post to another place mentions the people", async () => {
    const made = await callsOf(() => runCauseEffect(adapter.postAnswer(target, "Report for @alice_bob", null)));
    assert.deepEqual(
      made.map((call) => call.method),
      ["sendMessage"],
    );
    assert.ok(textOf(made[0]).includes("@alice_bob") && !textOf(made[0]).includes(WORD_JOINER));
    return { text: textOf(made[0]) };
  });

  await step("the plain-text fallback mentions nobody", async () => {
    refuseHtml = true;
    const made = await callsOf(() => runCauseEffect(adapter.postAnswer(target, "Thanks @alice_bob <3", null)));
    assert.deepEqual(
      made.map((call) => call.method),
      ["sendMessage", "sendMessage"],
    );
    assert.equal(parseModeOf(made[1]), undefined, "The fallback was not plain text.");
    assert.equal(textOf(made[1]), `Thanks @${WORD_JOINER}alice_bob <3`);
    return { text: textOf(made[1]) };
  });

  await step("mentions in code, a link label, an email address and a short number stay inert", async () => {
    const text = `Run \`ping @${USER_ID}\`, mail a@example.com, rated @4.5, [@${USER_ID} doc](https://e.x)`;
    const made = await callsOf(() => runCauseEffect(adapter.postAnswer(target, text, "102")));
    assert.deepEqual(
      made.map((call) => call.method),
      ["editMessageText"],
      "Text with no live mention was not an edit.",
    );
    const html = textOf(made[0]);
    assert.ok(!html.includes("tg://user"), "A mention in code or a link label became live.");
    return { html };
  });

  await step("a status post still mentions nobody", async () => {
    const made = await callsOf(() => runCauseEffect(adapter.post(target, { text: "Ask @alice_bob" })));
    assert.ok(textOf(made[0]).includes(`@${WORD_JOINER}alice_bob`), "A status post made a live @username.");
    return { text: textOf(made[0]) };
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`Telegram mention check passed. Report: ${join(OUT, "report.json")}\n`);
