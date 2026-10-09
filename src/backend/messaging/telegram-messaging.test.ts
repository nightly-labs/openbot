import { Effect } from "effect";

// @vitest-environment node

// End to end on the real modules: `AgentService` with its SQLite database and mailbox, the
// messaging core, and the Telegram driver with its updates parser and transport. Signal is a local
// fake: it passes each update as Signal does after it checked Telegram's secret header, and it
// answers each Bot API call. Signal's own checks are in `remote/api/test`. Only the provider is
// faked, as in every agent service test. Writes .openbot-build/telegram-e2e/report.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { TelegramCallResult } from "@openbot/contracts/signal-protocol/telegram-route";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service";
import {
  type FakeAgentClient,
  inputRecords,
  paramsRecord,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";
import { SidebarLayoutStore } from "../sidebar-layout-store";
import { type MessagingCredentials, MessagingService } from "./messaging-service";
import type { IngressHandler, MessagingIngress, TelegramGateway } from "./messaging-types";
import { telegramDriver } from "./telegram/telegram-driver";

const REPORT_DIR = resolve(import.meta.dirname, "../../../.openbot-build/telegram-e2e");
const BOT_ID = "7000000001";
const BOT_USERNAME = "OpenBotTestBot";
const CHAT_ID = "-1001234567890";
const CODE = "c".repeat(43);
const ALICE = { id: 111, is_bot: false, first_name: "Alice" };
const MALLORY = { id: 222, is_bot: false, first_name: "Mallory" };
const CHAT = { id: Number(CHAT_ID), type: "supergroup", title: "Team chat" };

interface TelegramCall {
  method: string;
  params: DynamicRecord;
  messageId?: number;
}

/**
 * Signal with the OpenBot bot: it passes the chat's updates and answers the host's Bot API calls. As
 * the real socket, it is open only while something holds it, and a call fails when it is closed.
 */
class FakeSignal implements MessagingIngress {
  readonly calls: TelegramCall[] = [];
  #handler: IngressHandler | null = null;
  #messageId = 5_000;
  #updateId = 1;
  holders = 0;

  acquire = () => {
    this.holders += 1;
    let released = false;
    return () => {
      if (!released) this.holders -= 1;
      released = true;
    };
  };
  state = () => "online" as const;
  onState = () => () => undefined;
  reconnect = () => undefined;
  discord = () => Effect.die("This test makes no Discord call.");
  onDiscordRoutes = () => () => undefined;

  handle(handler: IngressHandler | null): void {
    this.#handler = handler;
  }

  readonly telegram: TelegramGateway = {
    available: () => this.holders > 0,
    call: (_botId, method, params) =>
      Effect.suspend(() =>
        this.holders > 0 ? Effect.void : Effect.die("The host called with the ingress socket closed."),
      ).pipe(
        Effect.as(undefined),
        Effect.flatMap(() =>
          Effect.sync((): TelegramCallResult => {
            const call: TelegramCall = { method, params: { ...params } };
            this.calls.push(call);
            if (method === "sendMessage") {
              call.messageId = ++this.#messageId;
              return { messageId: call.messageId };
            }
            if (method === "getMe") return { botId: BOT_ID, username: BOT_USERNAME };
            return {};
          }),
        ),
      ),
    download: () => Effect.die("This test sends no file."),
    upload: () => Effect.die("This test sends no file."),
  };

  /**
   * Passes one update of the chat as Signal does, and waits until the host has taken it. `linked` is
   * true only on the `/start` update that the account service linked. Signal routes a chat only to an
   * open socket.
   */
  async send(update: DynamicRecord, linked = false): Promise<void> {
    const handler = this.#handler;
    if (!handler) throw new Error("The host does not take Telegram updates.");
    if (this.holders === 0) throw new Error("The host has no ingress socket open.");
    const body = Buffer.from(JSON.stringify({ update_id: ++this.#updateId, ...update }));
    await runCauseEffect(handler(CHAT_ID, { platform: "telegram", botId: BOT_ID, body, linked }));
  }

  of(method: string): TelegramCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  texts(): string[] {
    return this.calls.flatMap((call) => (isString(call.params.text) ? [call.params.text] : []));
  }
}

function message(id: number, text: string, extra: DynamicRecord = {}): DynamicRecord {
  return { message: { message_id: id, date: 1_800_000_000, chat: CHAT, from: ALICE, text, ...extra } };
}

function mention(id: number, text: string, extra: DynamicRecord = {}): DynamicRecord {
  const handle = `@${BOT_USERNAME}`;
  return message(id, `${handle} ${text}`, {
    entities: [{ type: "mention", offset: 0, length: handle.length }],
    ...extra,
  });
}

function button(data: string, from: DynamicRecord, messageId: number, threadId: number): DynamicRecord {
  return {
    callback_query: {
      id: `cq-${messageId}-${String(from.id)}`,
      from,
      data,
      message: {
        message_id: messageId,
        chat: CHAT,
        message_thread_id: threadId,
        from: { id: Number(BOT_ID), is_bot: true },
      },
    },
  };
}

class MemoryCredentials implements MessagingCredentials {
  readonly values = new Map<string, Record<string, string>>();
  keys() {
    return [...this.values.keys()];
  }
  status(connectionId: string) {
    return this.values.has(connectionId) ? ("saved" as const) : ("missing" as const);
  }
  get(connectionId: string) {
    return this.values.get(connectionId) ?? null;
  }
  set(connectionId: string, values: Record<string, string>) {
    return Effect.sync(() => {
      this.values.set(connectionId, values);
    });
  }
  clear(connectionId: string) {
    return Effect.sync(() => {
      this.values.delete(connectionId);
    });
  }
  retain(connectionIds: ReadonlySet<string>) {
    return Effect.sync(() => {
      for (const id of [...this.values.keys()]) if (!connectionIds.has(id)) this.values.delete(id);
    });
  }
}

let root: string;
let service: AgentService | null = null;
let messaging: MessagingService | null = null;
let signal: FakeSignal;
const opened: string[] = [];
const unlinked: string[] = [];
const report: Record<string, Record<string, number | boolean | string | string[]>> = {};

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
  signal = new FakeSignal();
  opened.length = 0;
  unlinked.length = 0;
});

afterEach(async () => {
  await runCauseEffect(messaging?.stop() ?? Effect.succeed(undefined));
  messaging = null;
  await stopAgentTestFixture(root, service);
  service = null;
});

/** A group that added the bot with a link code, with the Telegram Orchestrator that the user added. */
async function linked(options: { autoComplete?: boolean } = {}) {
  const started = await startService(root, { provider: "codex", autoComplete: options.autoComplete ?? true });
  service = started.service;
  const sidebar = new SidebarLayoutStore(join(root, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  messaging = new MessagingService({
    sidebar,
    threads: started.service.messaging,
    agents: {
      listAgents: () => started.service.listAgents(),
      respondToApproval: (input) => started.service.respondToApproval(input),
      onEvent: (listener) => {
        started.service.on("event", listener);
        return () => started.service.off("event", listener);
      },
      createAgentProfile: (input) => started.service.createAgentProfile(input),
      createMemory: (input) => started.service.createMemory(input),
    },
    credentials: new MemoryCredentials(),
    drivers: [telegramDriver({ ingress: signal })],
    downloadsRoot: join(root, "messaging-downloads"),
    ingress: signal,
    telegramApp: {
      createLink: () => Effect.succeed({ botUsername: BOT_USERNAME, code: CODE }),
      unlink: (chatId) => Effect.sync(() => void unlinked.push(chatId)),
      openExternal: async (url) => void opened.push(url),
    },
  });
  await runCauseEffect(messaging.start());
  await runCauseEffect(messaging.connectTelegramChat("group"));
  // Nothing runs yet: the open link code alone holds the socket for the chat's `/start`.
  expect(signal.holders).toBe(1);
  await signal.send(message(1, `/start@${BOT_USERNAME} ${CODE}`), true);
  await waitFor(() => chat()?.state === "connected");
  const added = await runCauseEffect(messaging.addTelegramOrchestrator({}));
  const agent: AgentSummary | undefined = started.service.listAgents().find((entry) => entry.id === added.agentId);
  if (!agent) throw new Error("The Telegram Orchestrator was not created.");
  return { ...started, agent };
}

function chat() {
  return messaging?.telegramOverview().connections[0];
}

function turnStarts(client: FakeAgentClient) {
  return client.requests.filter((request) => request.method === "turn/start");
}

function promptOf(request: { params: unknown }): string {
  return inputRecords(request.params)
    .map((item) => (isString(item.text) ? item.text : ""))
    .join("\n");
}

function callbackData(call: TelegramCall | undefined): string[] {
  const markup = call?.params.reply_markup;
  const rows = isDynamicRecord(markup) && Array.isArray(markup.inline_keyboard) ? markup.inline_keyboard : [];
  return rows
    .flat()
    .flatMap((entry: unknown) =>
      isDynamicRecord(entry) && isString(entry.callback_data) ? [entry.callback_data] : [],
    );
}

describe.sequential("Telegram messaging end to end", () => {
  it("links a group with a code, and answers a mention and the replies of its chain", async () => {
    const { client } = await linked();
    expect(opened).toEqual([`https://t.me/${BOT_USERNAME}?startgroup=${CODE}`]);
    expect(chat()).toMatchObject({ workspaceId: CHAT_ID, workspaceName: "Team chat", platform: "telegram" });
    expect(chat()?.orchestratorAgentId).toBeTruthy();
    // The welcome names the bot. Status text makes every `@name` inert, the bot's own too.
    expect(signal.texts().some((text) => text.includes(`@\u2060${BOT_USERNAME}`))).toBe(true);

    await signal.send(mention(100, "hello"));
    await waitFor(() => signal.texts().includes("CODEX_DONE"));
    const [start] = turnStarts(client);
    const prompt = start ? promptOf(start) : "";
    expect(prompt).toContain("Message from a Telegram user. This person is not the OpenBot user.");
    expect(prompt).toContain("Telegram chat: Team chat");
    expect(prompt).toContain("Author: Alice (Telegram user 111)");
    expect(prompt).toContain("--- message ---\nhello");

    const working = signal.of("sendMessage").find((call) => call.params.text === "Working on it…");
    expect(working?.params.reply_parameters).toMatchObject({ message_id: 100 });
    expect(callbackData(working)[0]).toMatch(/^s:[0-9a-f]{32}$/u);
    const reactions = signal.of("setMessageReaction").map((call) => JSON.stringify(call.params.reaction));
    expect(reactions).toEqual(['[{"type":"emoji","emoji":"👀"}]', "[]", '[{"type":"emoji","emoji":"👌"}]']);

    // A reply to OpenBot in the same chain continues the conversation without a mention. A message of
    // another chain that does not name OpenBot is not for it.
    const botMessage = working?.messageId ?? 0;
    await signal.send(
      message(300, "not for the bot", {
        message_thread_id: 250,
        reply_to_message: { message_id: 250, from: MALLORY, chat: CHAT, text: "lunch?" },
      }),
    );
    await signal.send(
      message(101, "and tomorrow?", {
        message_thread_id: 100,
        reply_to_message: { message_id: botMessage, from: { id: Number(BOT_ID), is_bot: true }, chat: CHAT },
      }),
    );
    await waitFor(() => turnStarts(client).length === 2);
    const prompts = turnStarts(client).map(promptOf);
    expect(prompts.some((text) => text.includes("not for the bot"))).toBe(false);
    expect(prompts[1]).toContain("--- message ---\nand tomorrow?");
    const sessions = new Set(turnStarts(client).map((request) => paramsRecord(request.params)?.threadId));
    expect(sessions.size).toBe(1);
    report.chain = { turns: turnStarts(client).length, sessions: sessions.size, reactions: reactions.length };
  });

  it("asks the requester for an approval, answers another person in the chat, and stops on request", async () => {
    const { agent, client } = await linked({ autoComplete: false });
    await signal.send(mention(500, "run the build"));
    await waitFor(() => turnStarts(client).length === 1);
    await waitFor(() => signal.texts().includes("Working on it…"));
    const threadId = paramsRecord(turnStarts(client)[0]?.params)?.threadId;
    const link = service?.messaging.store.links(agent.id)[0];
    const turnId = link ? service?.messaging.runningOrigin(link.linkId)?.turnId : undefined;
    expect(turnId).toBeTruthy();

    client.emit("request", {
      id: "telegram-approval",
      method: "item/commandExecution/requestApproval",
      params: { threadId, turnId, command: "npm run build" },
    });
    await waitFor(() => signal.texts().some((text) => text.includes("npm run build")));
    const approval = signal
      .of("sendMessage")
      .find((call) => isString(call.params.text) && call.params.text.includes("npm run build"));
    const accept = callbackData(approval).find((data) => data.startsWith("a:"));
    expect(accept).toBeTruthy();

    await signal.send(button(accept ?? "", MALLORY, 6_000, 500));
    await waitFor(() => signal.texts().some((text) => text.includes(`tg://user?id=${ALICE.id}`)));
    expect(signal.of("answerCallbackQuery").length).toBe(1);
    expect(client.responses).toEqual([]);

    await signal.send(button(accept ?? "", ALICE, 6_000, 500));
    await waitFor(() => client.responses.some((response) => response.id === "telegram-approval"));
    expect(client.responses.find((response) => response.id === "telegram-approval")?.result).toEqual({
      decision: "accept",
    });
    await waitFor(() =>
      signal
        .of("editMessageText")
        .some((call) => isString(call.params.text) && call.params.text.includes("Approved by")),
    );

    await signal.send(mention(501, "stop", { message_thread_id: 500 }));
    await waitFor(() => client.requests.some((request) => request.method === "turn/interrupt"));
    report.approval = { refusedOther: true, accepted: true, interrupted: true };
  });

  it("keeps a paused chat paused for a made-up code, and leaves the chat on disconnect", async () => {
    await linked();
    // The chat's transport holds the socket; the link code no longer does.
    expect(signal.holders).toBe(1);
    // Another connection, such as a Slack workspace, keeps the socket open while the chat is paused.
    const other = signal.acquire();
    await runCauseEffect(messaging?.setEnabled("telegram", CHAT_ID, false) ?? Effect.succeed(undefined));
    expect(chat()?.state).toBe("paused");
    await signal.send(message(2, `/start ${"x".repeat(43)}`));
    expect(chat()?.state).toBe("paused");

    await runCauseEffect(messaging?.setEnabled("telegram", CHAT_ID, true) ?? Effect.succeed(undefined));
    await waitFor(() => chat()?.state === "connected");
    other();
    // Stopping the chat releases the last holder of the socket. The bot still leaves the chat first.
    await runCauseEffect(messaging?.disconnectTelegramChat(CHAT_ID) ?? Effect.succeed(undefined));
    expect(signal.of("leaveChat").map((call) => call.params.chat_id)).toEqual([Number(CHAT_ID)]);
    expect(unlinked).toEqual([CHAT_ID]);
    expect(messaging?.telegramOverview().connections).toEqual([]);
    expect(signal.holders).toBe(0);
    report.paused = { madeUpCodeIgnored: true, left: true };
  });

  it("keeps a chat that removed the bot removed, until a new link", async () => {
    await linked();
    await signal.send({
      my_chat_member: { chat: CHAT, new_chat_member: { user: { id: Number(BOT_ID), is_bot: true }, status: "kicked" } },
    });
    await waitFor(() => chat()?.state === "removed");
    expect(unlinked).toEqual([CHAT_ID]);
    // The transport stopped, so the socket's state cannot show the chat as connected again.
    expect(signal.holders).toBe(0);
    await expect(runCauseEffect(messaging?.reconnect("telegram", CHAT_ID) ?? Effect.void)).rejects.toThrow();
    await expect(runCauseEffect(messaging?.setEnabled("telegram", CHAT_ID, true) ?? Effect.void)).rejects.toThrow();
    expect(chat()?.state).toBe("removed");

    // A restart does not start it either.
    await runCauseEffect(messaging?.stop() ?? Effect.void);
    await runCauseEffect(messaging?.start() ?? Effect.void);
    expect(chat()?.state).toBe("removed");

    // A new link brings it back.
    await runCauseEffect(messaging?.connectTelegramChat("group") ?? Effect.void);
    await signal.send(message(3, `/start@${BOT_USERNAME} ${CODE}`), true);
    await waitFor(() => chat()?.state === "connected");

    await runCauseEffect(messaging?.disconnectTelegramChat(CHAT_ID) ?? Effect.void);
    expect(messaging?.telegramOverview().connections).toEqual([]);
    report.removed = { unlinked: unlinked.length, keptRemoved: true, relinked: true };

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  });
});
