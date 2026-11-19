import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Browser, test } from "@e2e-dev/web";
import {
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { expect } from "e2e";
import { WebSocket } from "ws";
import { readyProvider, waitFor } from "./live-agent";
import { BENCH_TAG, DEBUGGING_PORT_FILE, type LiveProvider, PROJECT_ROOT, profilePath, RENDERER_HOST } from "./targets";

const OUT = join(PROJECT_ROOT, ".openbot-build", "provider-live-bench");
const GOOGLE_SESSION = join(homedir(), ".config", "openbot", "test-google-account.storage.json");
const INBOX = "https://mail.google.com/mail/u/0/#inbox";
const POLL_MS = 1_000;
const TURN_MS = 360_000;
const QUIET_MS = 90_000;

interface Step {
  author: string;
  source: string | null;
  itemType: string | null;
  status: string;
  text: string;
}

interface TurnRecord {
  steps: Step[];
  stopped: boolean;
}

async function readSteps(browser: Browser, agentId: string) {
  const read = await browser.evaluate(async (id) => {
    const conversation = await window.openbot.agent.readConversation(id);
    return {
      revision: conversation.revision,
      activeTurnId: conversation.activeTurnId,
      steps: conversation.messages.map((message) => ({
        author: message.author,
        source: message.source ?? null,
        itemType: message.itemType ?? null,
        status: message.status,
        text: message.text,
      })),
    };
  }, agentId);
  return {
    ...read,
    steps: read.steps.map((step) => (isAnswer(step) ? step : { ...step, text: step.text.slice(0, 600) })),
  };
}

async function runTask(
  browser: Browser,
  input: { provider: LiveProvider; model: string; task: string; prompt: string },
): Promise<TurnRecord> {
  const agentId = await browser.evaluate(
    async (create) =>
      (
        await window.openbot.agent.createAgent({
          name: `Bench ${create.provider}`,
          description: "Personal assistant.",
          avatarSeed: `bench-${create.provider}`,
          avatarHue: null,
          initialMessage: create.prompt,
          provider: create.provider,
          model: create.model,
        })
      ).id,
    { provider: input.provider, model: input.model, prompt: input.prompt },
  );
  try {
    const deadline = Date.now() + TURN_MS;
    let started = false;
    let lastRevision = -1;
    let lastChange = Date.now();
    for (;;) {
      const read = await readSteps(browser, agentId);
      if (read.revision !== lastRevision) {
        lastRevision = read.revision;
        lastChange = Date.now();
      }
      if (read.activeTurnId !== null) started = true;
      const answered = read.steps.some((step) => isAnswer(step) && step.status === "completed");
      if (read.activeTurnId === null && (started || answered)) return { steps: read.steps, stopped: false };
      const quiet = Date.now() - lastChange > QUIET_MS;
      if (read.activeTurnId !== null && (quiet || Date.now() > deadline)) {
        await browser.evaluate((stop) => window.openbot.agent.interrupt(stop).then(() => null), {
          agentId,
          turnId: read.activeTurnId,
        });
        return { steps: read.steps, stopped: true };
      }
      if (Date.now() > deadline) throw new Error(`The ${input.task} turn did not start.`);
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
  } finally {
    await browser
      .evaluate((id) => window.openbot.agent.deleteAgent(id).then(() => null), agentId)
      .catch(() => undefined);
  }
}

interface BenchResult extends TurnRecord {
  provider: string;
  model: string;
  expected: string;
  cards: string[];
  answer: string;
  passed: boolean;
}

function finish(
  input: { provider: string; model: string; task: string; expected: string },
  record: TurnRecord,
  matches: (answer: string) => boolean,
): BenchResult {
  const text = answer(record.steps);
  const cards = connectCards(record.steps);
  const result: BenchResult = {
    provider: input.provider,
    model: input.model,
    expected: input.expected,
    cards,
    answer: text,
    passed: matches(text) && cards.length === 0,
    ...record,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${input.provider}-${input.task}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function readJsonString(url: string, path: string[]): Promise<string> {
  let value: unknown = await (await fetch(url)).json();
  for (const key of path) value = isDynamicRecord(value) ? value[key] : undefined;
  if (!isString(value) || value === "") throw new Error(`${url} has no ${path.join(".")}.`);
  return value;
}

function connectCards(steps: Step[]): string[] {
  return steps.flatMap((step) =>
    step.itemType?.startsWith(MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX)
      ? [step.itemType.slice(MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX.length)]
      : [],
  );
}

function isAnswer(step: Step): boolean {
  return (
    step.author === "assistant" &&
    step.text.trim() !== "" &&
    !["commentary", "question_prompt", CONVERSATION_PLAN_ITEM_TYPE, CONVERSATION_SUBAGENTS_ITEM_TYPE].includes(
      step.itemType ?? "",
    ) &&
    !step.itemType?.startsWith(MARKETPLACE_SUGGESTION_ITEM_TYPE_PREFIX)
  );
}

function answer(steps: Step[]): string {
  return steps
    .filter(isAnswer)
    .map((step) => step.text)
    .join("\n");
}

interface PageParams {
  cookies?: DynamicRecord[];
  url?: string;
  expression?: string;
  returnByValue?: boolean;
}

type Send = (method: string, params?: PageParams) => Promise<unknown>;

async function onPage<T>(socketUrl: string, use: (send: Send) => Promise<T>): Promise<T> {
  const socket = new WebSocket(socketUrl);
  await new Promise((done, fail) => {
    socket.once("open", done);
    socket.once("error", fail);
  });
  let nextId = 0;
  const send: Send = (method, params = {}) =>
    new Promise((done, fail) => {
      nextId += 1;
      const id = nextId;
      const onMessage = (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (!isDynamicRecord(message) || message.id !== id) return;
        socket.off("message", onMessage);
        if (message.error) fail(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else done(message.result);
      };
      socket.on("message", onMessage);
      socket.send(JSON.stringify({ id, method, params }));
    });
  try {
    return await use(send);
  } finally {
    socket.close();
  }
}

async function appPages(provider: LiveProvider): Promise<{ url: string; socket: string }[]> {
  const port = readFileSync(join(profilePath(provider), DEBUGGING_PORT_FILE), "utf8").trim();
  const listed = await (await fetch(`http://${RENDERER_HOST}:${port}/json/list`)).json();
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((page: unknown) =>
    isDynamicRecord(page) && isString(page.url) && isString(page.webSocketDebuggerUrl)
      ? [{ url: page.url, socket: page.webSocketDebuggerUrl }]
      : [],
  );
}

async function signInToGmail(browser: Browser, provider: LiveProvider): Promise<string> {
  const saved = JSON.parse(readFileSync(GOOGLE_SESSION, "utf8"));
  const cookies = (isDynamicRecord(saved) && Array.isArray(saved.cookies) ? saved.cookies : []).flatMap(
    (cookie: unknown) => {
      if (!isDynamicRecord(cookie)) return [];
      const { expires, ...rest } = cookie;
      return [typeof expires === "number" && expires > 0 ? { ...rest, expires } : rest];
    },
  );
  const tabId = await browser.evaluate(
    async (url) => (await window.openbot.browser.open({ url, focus: false })).id,
    INBOX,
  );
  try {
    const page = await waitFor(
      "the Gmail tab",
      30_000,
      async () => (await appPages(provider)).find((candidate) => candidate.url.startsWith("https://mail.google.com/")),
      (found) => found !== undefined,
    );
    if (!page) throw new Error("No Gmail tab.");
    return await onPage(page.socket, async (send) => {
      await send("Network.setCookies", { cookies });
      await send("Page.navigate", { url: INBOX });
      const read = await waitFor(
        "the Gmail inbox",
        60_000,
        async () => {
          const result = await send("Runtime.evaluate", {
            expression: `({ host: location.host, subject: document.querySelector("tr.zA .bog")?.textContent ?? "" })`,
            returnByValue: true,
          });
          const value = isDynamicRecord(result) && isDynamicRecord(result.result) ? result.result.value : null;
          return isDynamicRecord(value) && isString(value.host) && isString(value.subject)
            ? { host: value.host, subject: value.subject.trim() }
            : { host: "", subject: "" };
        },
        (value) => value.subject !== "" || (value.host !== "" && value.host !== "mail.google.com"),
      );
      if (read.host !== "mail.google.com")
        throw new Error("The test Google session has expired. Save it again (AGENTS.md, development data).");
      return read.subject;
    });
  } finally {
    await browser.evaluate((id) => window.openbot.browser.close(id).then(() => null), tabId);
  }
}

async function latestReleaseTag(repo: string): Promise<string> {
  const res = await fetch(`https://github.com/${repo}/releases/latest`, { redirect: "manual" });
  const tag = res.headers.get("location")?.split("/releases/tag/")[1];
  if (!tag) throw new Error(`${repo} has no latest release.`);
  return decodeURIComponent(tag);
}

test("the agent uses its own tools before it asks for a connection", { tags: [BENCH_TAG] }, async ({
  app,
  browser,
}) => {
  await app.open("/");
  const { provider, model } = await readyProvider(browser);

  const tag = await latestReleaseTag("oven-sh/bun");
  const github = await runTask(browser, {
    provider,
    model,
    task: "github",
    prompt: "What is the tag name of the latest release of the GitHub repository oven-sh/bun?",
  });
  const results = [finish({ provider, model, task: "github", expected: tag }, github, (text) => text.includes(tag))];

  const price = Number(await readJsonString("https://api.coinbase.com/v2/prices/BTC-USD/spot", ["data", "amount"]));
  const priced = await runTask(browser, {
    provider,
    model,
    task: "price",
    prompt: "What is the price of one Bitcoin in US dollars now? Use CoinGecko.",
  });
  results.push(
    finish({ provider, model, task: "price", expected: String(price) }, priced, (text) =>
      [...text.replaceAll(",", "").matchAll(/\d+(?:\.\d+)?/g)].some(
        (match) => Math.abs(Number(match[0]) - price) / price < 0.03,
      ),
    ),
  );

  if (existsSync(GOOGLE_SESSION)) {
    const subject = await signInToGmail(browser, provider);
    const mail = await runTask(browser, {
      provider,
      model,
      task: "mail",
      prompt: "What is the subject of the latest email in my Gmail inbox?",
    });
    results.push(
      finish({ provider, model, task: "mail", expected: subject }, mail, (text) =>
        text.toLowerCase().includes(subject.toLowerCase()),
      ),
    );
  }

  expect(
    results.map((result) => ({ expected: result.expected, cards: result.cards, passed: result.passed })),
    "each answer gives the value, with no connect card",
  ).toEqual(results.map((result) => ({ expected: result.expected, cards: [], passed: true })));
});
