// Measures the skill suggestions of the background memory review on labelled chats. Each case is a
// chat with the agent's skills and its tool steps, and a label: the review must suggest a new skill,
// suggest an update of a named skill, or suggest nothing. The bench builds the real review prompt
// (`memoryReviewPrompt`), runs it through the real background call (`generateTextWithoutTools` at
// `withBackgroundEffort`, on the provider's default model) with the user's own Claude or Codex
// sign-in, and decodes the answer with the real schemas and the real filter (`acceptedSuggestion`).
// The report holds, for each provider: precision (suggestions that match the label), recall
// (positive cases that got the right suggestion), the false suggestions and the misses, checks of
// each question (length, a question mark, "you" not "the user", the chat's language, a class-level
// name), and the provider's token counts.
// `bun scripts/skill-suggestion-bench.ts`; `--provider=claude|codex` runs one provider (default
// both); `--runs=<n>` repeats each case (default 1); `--case=<id>` runs one case.
// Writes .openbot-build/skill-suggestion-bench/report.json. The run fails when a call fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentModelOption,
  agentProviderDescriptor,
  type ConversationMessage,
  isReasoningEffort,
} from "@openbot/contracts/ipc";
import { Schema } from "effect";
import { withBackgroundEffort } from "../src/backend/agent/background-model";
import {
  acceptedSuggestion,
  MemoryReviewResult,
  memoryReviewPrompt,
  type ReviewSkill,
  SkillReviewResult,
  type SkillReviewSuggestion,
} from "../src/backend/agent/memory-review-prompt";
import { generateTextWithoutTools, startToolless, stopToolless } from "../src/backend/agent/profile-generation";
import type { AgentClient } from "../src/backend/agent-client";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { cliPathEnvironment, resolveClaudeCli, resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getArray, getRecord, getString, isRecord } from "../src/backend/protocol";
import { extractJsonObject } from "../src/backend/structured-output";
import { observedQuery } from "./claude-agent-harness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/skill-suggestion-bench");
const TIMEOUT_MS = 180_000;
const CONCURRENCY = 3;

// --- Fixtures -------------------------------------------------------------------------------

const RELEASE_NOTES = "local-skill-0b9a8c1e-2f7d-4c55-9a10-5d1e0c7b3a01";
const SALES_REPORT = "local-skill-6c2e4f80-91ab-4d3e-8f27-a4b5c6d7e802";
const SKILLS: ReviewSkill[] = [
  {
    skillId: RELEASE_NOTES,
    name: "Release notes",
    description:
      "Write the release notes of this repository: one file per branch in changelog.d, one user-facing sentence per change, grouped under Features and Changes.",
  },
  {
    skillId: SALES_REPORT,
    name: "Weekly sales report",
    description:
      "Build the weekly sales report from the CRM CSV export: total revenue per region, a bar chart, and a short email to the sales team.",
  },
  { skillId: "openbot-skill-creator", name: "openbot-skill-creator", description: "Write a new skill folder." },
  { skillId: "marketplace:anthropic/pdf", name: "PDF", description: "Read, fill and merge PDF files." },
];

type Step = string | { command: string; error: string };
let sequence = 0;
let clock = Date.parse("2026-11-02T09:00:00Z");
const time = () => {
  clock += 45_000;
  return new Date(clock).toISOString();
};
const user = (text: string): ConversationMessage => ({
  id: `m${++sequence}`,
  author: "user",
  source: "user",
  status: "completed",
  createdAt: time(),
  text,
});
const agent = (text: string, steps: Step[] = []): ConversationMessage => {
  const startedAt = time();
  const endedAt = time();
  return {
    id: `m${++sequence}`,
    author: "assistant",
    source: "assistant",
    status: "completed",
    createdAt: endedAt,
    text,
    ...(steps.length
      ? {
          trace: {
            startedAt,
            endedAt,
            steps: steps.map((step, index) => ({
              id: `s${sequence}-${index}`,
              kind: "tool" as const,
              startedAt,
              endedAt,
              ...(typeof step === "string"
                ? { command: step }
                : { command: step.command, failed: true as const, error: step.error }),
            })),
          },
        }
      : {}),
  };
};

type Expected = { action: "none" } | { action: "create" } | { action: "update"; skillId: string };
interface Case {
  id: string;
  /** What the case tests, for the report. */
  about: string;
  expected: Expected;
  messages: ConversationMessage[];
  earlierSuggestions?: string[];
  /** The language of the chat, when it is not English. */
  language?: "pl";
}

const commitChat = () => [
  user("Commit the login timeout fix."),
  agent('Committed: "Updated the auth module to fix some timeout issues with login".', [
    "git add src/auth/session.ts",
    'git commit -m "Updated the auth module to fix some timeout issues with login"',
  ]),
  user(
    "No. Commit subjects are imperative, at most 50 characters, with the area in brackets first: [auth] Fix login timeout. Amend it, and do it like this every time.",
  ),
  agent('Amended: "[auth] Fix login timeout".', ['git commit --amend -m "[auth] Fix login timeout"']),
  user("Good. Now commit the rate limit change too."),
  agent('Committed: "[api] Add rate limit to search".', [
    "git add src/api/search.ts",
    'git commit -m "[api] Add rate limit to search"',
  ]),
];

const CASES: Case[] = [
  // Positive: a correction of how the agent does a class of task.
  {
    id: "p1-commit-format",
    about: "The user corrects the commit subject format and says to do it every time.",
    expected: { action: "create" },
    messages: commitChat(),
  },
  {
    id: "p2-postgres-batched-migration",
    about: "A non-obvious method worked after a lock timeout on a large table.",
    expected: { action: "create" },
    messages: [
      user("Add a non-null `archived` boolean with default false to the orders table in production."),
      agent("The migration failed: the ALTER TABLE timed out on the lock. orders has 180 million rows.", [
        {
          command: "psql $DATABASE_URL -c 'ALTER TABLE orders ADD COLUMN archived boolean NOT NULL DEFAULT false'",
          error: "ERROR: canceling statement due to lock timeout",
        },
      ]),
      user("We have this every time on the big tables. Find a way that does not lock."),
      agent(
        "Done without a long lock: I added the column as nullable with no default, set the default for new rows, backfilled in batches of 10,000 ids with a short sleep, then added the NOT NULL constraint as NOT VALID and validated it separately.",
        [
          "psql $DATABASE_URL -c 'ALTER TABLE orders ADD COLUMN archived boolean'",
          "psql $DATABASE_URL -c 'ALTER TABLE orders ALTER COLUMN archived SET DEFAULT false'",
          "bun scripts/backfill.ts --table=orders --column=archived --value=false --batch=10000",
          "psql $DATABASE_URL -c 'ALTER TABLE orders ADD CONSTRAINT orders_archived_not_null CHECK (archived IS NOT NULL) NOT VALID'",
          "psql $DATABASE_URL -c 'ALTER TABLE orders VALIDATE CONSTRAINT orders_archived_not_null'",
        ],
      ),
      user("Perfect, no alerts this time. That is how we must do it on the big tables from now on."),
      agent("Understood."),
    ],
  },
  {
    id: "p3-release-notes-correction",
    about: "The Release notes skill was used and the user corrects its result.",
    expected: { action: "update", skillId: RELEASE_NOTES },
    messages: [
      user("Write the release notes for this branch."),
      agent("I wrote changelog.d/fix-sync.md:\n### Changes\n- Fix sync stall (#4821, SYNC-112).", [
        `read_local_skill ${RELEASE_NOTES}`,
        "cat changelog.d/README.md",
        "write changelog.d/fix-sync.md",
      ]),
      user(
        "Two things, and they apply to all release notes: never put PR or ticket numbers in them, users cannot open those. And a fix goes under ### Fixes, not ### Changes.",
      ),
      agent("Fixed: ### Fixes\n- Fix a stall when two computers sync the same chat.", [
        "write changelog.d/fix-sync.md",
      ]),
      user("Yes, that is right."),
    ],
  },
  {
    id: "p4-sales-report-column",
    about: "The Weekly sales report skill is out of date: the CRM renamed a column.",
    expected: { action: "update", skillId: SALES_REPORT },
    messages: [
      user("Make this week's sales report."),
      agent("The report script stopped: the export has no Region column. The CRM now calls it Sales region.", [
        `read_local_skill ${SALES_REPORT}`,
        {
          command: "python3 report.py exports/crm-2026-11-02.csv",
          error: "KeyError: 'Region'",
        },
        "head -1 exports/crm-2026-11-02.csv",
      ]),
      user("Yes, they renamed it last week and it stays like that. Use the new column."),
      agent("Done. Revenue per region is in report.pdf, and the email draft is ready.", [
        "python3 report.py exports/crm-2026-11-02.csv --region-column 'Sales region'",
      ]),
      user("Thanks, send it."),
      agent("Sent to sales@."),
    ],
  },
  {
    id: "p5-meeting-notes-format",
    about: "A standing format for one class of task: meeting summaries.",
    expected: { action: "create" },
    messages: [
      user("Summarize this meeting transcript. [transcript of the Tuesday product sync]"),
      agent(
        "The team met on Tuesday to discuss the roadmap. Ana opened with the Q1 goals, then Ben talked about the hiring plan, and after a long discussion they agreed to move the mobile launch.",
      ),
      user(
        "Too long and the wrong order. For my meeting summaries: decisions first, then action items as 'owner: task (date)', then open questions. No story. Always like this.",
      ),
      agent(
        "Decisions:\n- The mobile launch moves to March.\nAction items:\n- Ana: update the roadmap (Nov 8)\n- Ben: open two backend roles (Nov 15)\nOpen questions:\n- Who owns the beta?",
      ),
      user("Exactly."),
    ],
  },
  {
    id: "p6-simulator-push",
    about: "A technique that is not obvious worked, and the user says it is needed again.",
    expected: { action: "create" },
    messages: [
      user("I need to test the order-shipped push notification in the iOS simulator."),
      agent("Sending a real push needs an APNs key, and the sandbox call failed.", [
        {
          command: "curl -v --http2 https://api.sandbox.push.apple.com/3/device/$TOKEN -d @payload.json",
          error: "403 InvalidProviderToken",
        },
      ]),
      user("Is there a way without APNs?"),
      agent(
        "Yes: the simulator takes a local push. I wrote order-shipped.apns with the bundle id in Simulator Target Bundle, and xcrun simctl push delivered it.",
        ["write order-shipped.apns", "xcrun simctl push booted com.example.shop order-shipped.apns"],
      ),
      user("It works! We test notifications like this all the time, remember how."),
      agent("Good."),
    ],
  },
  {
    id: "p7-invoice-reminder-pl",
    about: "A correction of tone and format for payment reminders, in Polish.",
    expected: { action: "create" },
    language: "pl",
    messages: [
      user("Napisz przypomnienie o zaległej fakturze 2026/10/31 dla firmy Nowak."),
      agent(
        "Szanowni Państwo, uprzejmie informujemy, że faktura nie została opłacona. Prosimy o niezwłoczną wpłatę, w przeciwnym razie sprawa trafi do windykacji.",
      ),
      user(
        "Za ostro. Przypomnienia o płatnościach zawsze piszemy uprzejmie: najpierw numer faktury, kwota i termin, potem numer konta, bez gróźb o windykacji, a na końcu prośba o kontakt, jeśli płatność już poszła.",
      ),
      agent(
        "Dzień dobry, przypominamy o fakturze 2026/10/31 na kwotę 4 200 zł z terminem 31.10. Numer konta: 12 3456 7890. Jeśli płatność już została wysłana, prosimy o krótką wiadomość. Pozdrawiamy.",
      ),
      user("Tak, idealnie."),
    ],
  },
  {
    id: "p8-docs-deploy-order",
    about: "The user corrects the order of steps for docs deploys.",
    expected: { action: "create" },
    messages: [
      user("Deploy the docs site."),
      agent("Deployed to docs.example.com.", ["bun run docs:build", "wrangler pages deploy dist --project-name docs"]),
      user(
        "You deployed broken links again. Before every docs deploy run the link checker on the build, and deploy only when it passes.",
      ),
      agent("The link checker found 3 broken links. I fixed them and deployed again.", [
        "bun run docs:build",
        { command: "bunx linkinator dist --recurse", error: "3 broken links: /api/v2, /guides/sso, /blog/old" },
        "edit docs/guides/sso.md docs/api/index.md docs/blog/index.md",
        "bun run docs:build",
        "bunx linkinator dist --recurse",
        "wrangler pages deploy dist --project-name docs",
      ]),
      user("Good, that is the procedure."),
    ],
  },
  {
    id: "p9-gif-two-pass",
    about: "A better method replaced a blurry first attempt, and the user wants it again.",
    expected: { action: "create" },
    messages: [
      user("Make a GIF from demo.mov for the README."),
      agent("Done: demo.gif, 24 MB.", ["ffmpeg -i demo.mov demo.gif"]),
      user("It is blurry, the colors band and it is huge. GitHub wants under 10 MB."),
      agent(
        "This one is 4.1 MB and sharp: 12 fps, 960 px wide, and a two-pass palette (palettegen, then paletteuse with dithering).",
        [
          "ffmpeg -i demo.mov -vf 'fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff' palette.png",
          "ffmpeg -i demo.mov -i palette.png -lavfi 'fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5' demo.gif",
        ],
      ),
      user("Much better. Do all README GIFs this way."),
    ],
  },
  {
    id: "p10-sales-report-change",
    about: "The user adds a standing requirement to the Weekly sales report.",
    expected: { action: "update", skillId: SALES_REPORT },
    messages: [
      user("Weekly sales report, please."),
      agent("Done: report.pdf has the revenue per region and the chart. The email draft is ready.", [
        `read_local_skill ${SALES_REPORT}`,
        "python3 report.py exports/crm-2026-11-09.csv --region-column 'Sales region'",
      ]),
      user(
        "I asked for this last month too: every weekly report shows the week-over-week change in percent beside each region. Add it, and always include it.",
      ),
      agent("Added the week-over-week column. North is +12%, South -3%.", [
        "python3 report.py exports/crm-2026-11-09.csv --region-column 'Sales region' --compare exports/crm-2026-11-02.csv",
      ]),
      user("Thanks."),
    ],
  },
  // Negative: nothing to keep as a skill.
  {
    id: "n1-one-off-summary",
    about: "A task done once: summarize one article.",
    expected: { action: "none" },
    messages: [
      user("Summarize https://example.com/blog/rust-2027 in three points."),
      agent("1. Rust 2027 adds async closures. 2. The borrow checker gets faster. 3. Editions stay opt-in.", [
        "browser open https://example.com/blog/rust-2027",
      ]),
      user("Thanks."),
    ],
  },
  {
    id: "n2-missing-program",
    about: "An environment failure that the user fixed: a missing program.",
    expected: { action: "none" },
    messages: [
      user("List my open pull requests."),
      agent("gh is not installed on this computer.", [
        { command: "gh pr list --author @me", error: "zsh: command not found: gh" },
      ]),
      user("Installed it now and signed in."),
      agent("You have 2 open pull requests: #12 Fix header, #15 Add search.", ["gh pr list --author @me"]),
    ],
  },
  {
    id: "n3-memory-facts",
    about: "Facts and a general preference, which go to memory, not to a skill.",
    expected: { action: "none" },
    messages: [
      user("I moved to Kraków last month, so use Europe/Warsaw times from now on. And keep all your answers short."),
      agent("Noted: Europe/Warsaw, short answers."),
      user("What time is the standup in my time zone? It is 9:00 New York."),
      agent("15:00."),
    ],
  },
  {
    id: "n4-tool-broken-claim",
    about: "A claim that a tool does not work, with no method that worked.",
    expected: { action: "none" },
    messages: [
      user("Check the price of the Sony WH-1000XM6 on the shop site."),
      agent("The browser tool does not work: the page did not load.", [
        { command: "browser open https://shop.example.com/sony-wh-1000xm6", error: "net::ERR_TIMED_OUT" },
      ]),
      user("Never mind, I will look myself."),
    ],
  },
  {
    id: "n5-retry-worked",
    about: "An error that went away on a retry.",
    expected: { action: "none" },
    messages: [
      user("Install the dependencies and run the tests."),
      agent("All 214 tests pass. The first install failed on a network timeout; the second worked.", [
        { command: "bun install", error: "error: ETIMEDOUT registry.npmjs.org" },
        "bun install",
        "bun test",
      ]),
      user("Great."),
    ],
  },
  {
    id: "n6-skill-already-covers",
    about: "The Release notes skill was used and the user is happy: nothing new.",
    expected: { action: "none" },
    messages: [
      user("Write the release notes for this branch."),
      agent("I wrote changelog.d/search-filter.md:\n### Features\n- Filter search results by date.", [
        `read_local_skill ${RELEASE_NOTES}`,
        "write changelog.d/search-filter.md",
      ]),
      user("Looks good."),
    ],
  },
  {
    id: "n7-already-asked",
    about: "The commit chat again, but the review already asked about this skill.",
    expected: { action: "none" },
    messages: commitChat(),
    earlierSuggestions: [
      "You corrected my commit subjects: imperative mood, at most 50 characters, area in brackets first. Should I save this as a new skill named Git commit subjects?",
    ],
  },
  {
    id: "n8-never-worked",
    about: "Several attempts, none worked; the user gives up.",
    expected: { action: "none" },
    messages: [
      user("My Bluetooth headphones crackle on the Mac. Fix it."),
      agent("I reset the Bluetooth module and the audio daemon. Does it still crackle?", [
        "sudo pkill bluetoothd",
        "sudo killall coreaudiod",
      ]),
      user("Still crackles."),
      agent("I set the output to 44.1 kHz. And now?", ["SwitchAudioSource -t output -s 'WH-1000XM6'"]),
      user("Same. Forget it, I will use the cable."),
    ],
  },
  {
    id: "n9-small-talk",
    about: "Quick questions with no method.",
    expected: { action: "none" },
    messages: [
      user("What is 15% of 240?"),
      agent("36."),
      user("And the capital of Australia?"),
      agent("Canberra."),
      user("Thanks!"),
    ],
  },
  {
    id: "n10-one-time-migration",
    about: "A long task that the user says happens once.",
    expected: { action: "none" },
    messages: [
      user(
        "Move my old WordPress posts into the new site's content folder. This is a one-time move, we will never do it again.",
      ),
      agent("Converted 312 posts to Markdown in content/posts and copied the images.", [
        "unzip wordpress-export.zip -d /tmp/wp",
        "bunx wordpress-export-to-markdown --input /tmp/wp/export.xml --output content/posts",
        "cp -R /tmp/wp/uploads public/images",
      ]),
      user("Thanks, that is done then."),
    ],
  },
];

// --- Run ------------------------------------------------------------------------------------

type Provider = "claude" | "codex";
const argument = (name: string) => process.argv.find((each) => each.startsWith(`--${name}=`))?.split("=")[1];
const chosen = argument("provider");
const providers: Provider[] = chosen === "claude" || chosen === "codex" ? [chosen] : ["claude", "codex"];
const runCount = Math.max(1, Number(argument("runs") ?? 1) || 1);
const cases = argument("case") ? CASES.filter((each) => each.id === argument("case")) : CASES;
if (!cases.length) throw new Error(`No case ${argument("case")}.`);

const PROFILE = { name: "Chief", title: "Engineering assistant", description: "" };
const BASE = { epoch: 0, limit: 200, essentialBytes: 0, memories: [] };

interface Usage {
  inputTokens: number;
  outputTokens: number;
}
interface Run {
  provider: Provider;
  model: string;
  case: string;
  expected: string;
  got: string;
  outcome: "hit" | "wrong-target" | "false-suggestion" | "miss" | "correct-none" | "bad-answer";
  memoryOperations: number;
  /** The memory texts that the review added or changed. */
  memoryTexts?: string[];
  suggestion: SkillReviewSuggestion | null;
  /** The raw skill field when the filter or the schema dropped it. */
  dropped?: unknown;
  checks?: Record<string, boolean>;
  usage: Usage | null;
  seconds: number;
}

const label = (expected: Expected) => (expected.action === "update" ? `update:${expected.skillId}` : expected.action);
const gotLabel = (suggestion: SkillReviewSuggestion | null) =>
  suggestion ? (suggestion.action === "update" ? `update:${suggestion.skillId}` : "create") : "none";

/** Checks of the question and the name, which the card shows as they are. */
function questionChecks(testCase: Case, suggestion: SkillReviewSuggestion): Record<string, boolean> {
  const message = suggestion.message;
  return {
    asksAQuestion: message.includes("?"),
    speaksToYou: !/\bthe user\b/iu.test(message),
    noList: !/^\s*([-*•#]|\d+\.)\s/mu.test(message),
    atMostThreeSentences: (message.match(/[.!?](\s|$)/gu) ?? []).length <= 3,
    chatLanguage:
      testCase.language === "pl"
        ? /[ąćęłńóśźż]|\b(czy|zapisać|umiejętność)\b/iu.test(message)
        : /\b(the|you|I)\b/u.test(message),
    classLevelName:
      suggestion.action === "update" ||
      (!/\d|#/u.test(suggestion.name) && suggestion.name.trim().split(/\s+/u).length <= 6),
  };
}

function outcome(expected: Expected, suggestion: SkillReviewSuggestion | null): Run["outcome"] {
  if (expected.action === "none") return suggestion ? "false-suggestion" : "correct-none";
  if (!suggestion) return "miss";
  if (expected.action === "create") return suggestion.action === "create" ? "hit" : "wrong-target";
  return suggestion.action === "update" && suggestion.skillId === expected.skillId ? "hit" : "wrong-target";
}

async function defaultModel(client: AgentClient, provider: Provider): Promise<AgentModelOption> {
  const id = agentProviderDescriptor(provider).defaultModel;
  await runCauseEffect(startToolless(client));
  try {
    const list = await runCauseEffect(
      client.request("model/list", { limit: 100, includeHidden: true }, (value) => value),
    );
    const item = getArray(list, "data").find((entry) => getString(entry, "model") === id);
    if (!item) throw new Error(`${provider} does not list ${id}.`);
    const efforts = getArray(item, "supportedReasoningEfforts")
      .map((entry) => getString(entry, "reasoningEffort"))
      .filter(isReasoningEffort);
    const listedDefault = getString(item, "defaultReasoningEffort");
    return withBackgroundEffort({
      provider,
      id,
      name: id,
      description: "",
      defaultReasoningEffort: isReasoningEffort(listedDefault) ? listedDefault : (efforts[0] ?? "medium"),
      supportedReasoningEfforts: efforts.length ? efforts : ["medium"],
    });
  } finally {
    await runCauseEffect(stopToolless(client)).catch(() => undefined);
  }
}

const count = (record: unknown, key: string) => {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === "number" ? value : 0;
};

/** One call: a new client each time, so no call sees another's history. */
async function generate(provider: Provider, model: AgentModelOption, prompt: string) {
  const seen: { usage: Usage | null } = { usage: null };
  if (provider === "claude") {
    const cli = await runCauseEffect(resolveClaudeCli());
    const createQuery = observedQuery((message) => {
      if (message.type === "result")
        seen.usage = {
          inputTokens:
            message.usage.input_tokens +
            message.usage.cache_read_input_tokens +
            message.usage.cache_creation_input_tokens,
          outputTokens: message.usage.output_tokens,
        };
    });
    const client = new ClaudeAgentClient(cli, createQuery, undefined, TIMEOUT_MS);
    return { answer: await runCauseEffect(generateTextWithoutTools(client, model, prompt)), usage: () => seen.usage };
  }
  const cli = await runCauseEffect(resolveCodexCli());
  const observe = (notification: AppServerNotification) => {
    if (notification.method !== "thread/tokenUsage/updated") return;
    const total = getRecord(getRecord(notification.params, "tokenUsage"), "total");
    if (total) seen.usage = { inputTokens: count(total, "inputTokens"), outputTokens: count(total, "outputTokens") };
  };
  const client = new CodexAppServerClient(cli.executable, TIMEOUT_MS, cliPathEnvironment(cli));
  const answer = await runCauseEffect(generateTextWithoutTools(client, model, prompt, undefined, observe));
  return { answer, usage: () => seen.usage };
}

async function runCase(provider: Provider, model: AgentModelOption, testCase: Case): Promise<Run> {
  const prompt = memoryReviewPrompt(PROFILE, BASE, testCase.messages, {
    skills: SKILLS,
    earlierSuggestions: testCase.earlierSuggestions ?? [],
    // The checks grade the question that the "Ask first" mode shows.
    automatic: false,
  });
  const started = Date.now();
  const { answer, usage } = await generate(provider, model, prompt);
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const base = { provider, model: model.id, case: testCase.id, expected: label(testCase.expected), seconds };
  let json: ReturnType<typeof extractJsonObject>;
  try {
    json = extractJsonObject(answer);
  } catch {
    return { ...base, got: "not JSON", outcome: "bad-answer", memoryOperations: 0, suggestion: null, usage: usage() };
  }
  const memory = Schema.decodeUnknownOption(MemoryReviewResult)(json);
  const skill = Schema.decodeUnknownOption(SkillReviewResult)(json);
  const raw = json.skill;
  const suggestion = skill._tag === "Some" ? acceptedSuggestion(skill.value.skill, SKILLS) : null;
  return {
    ...base,
    got: gotLabel(suggestion),
    outcome: memory._tag === "None" ? "bad-answer" : outcome(testCase.expected, suggestion),
    memoryOperations: memory._tag === "Some" ? memory.value.operations.length : 0,
    ...(memory._tag === "Some"
      ? { memoryTexts: memory.value.operations.flatMap((operation) => ("text" in operation ? [operation.text] : [])) }
      : {}),
    suggestion,
    ...(raw && !suggestion ? { dropped: raw } : {}),
    ...(suggestion ? { checks: questionChecks(testCase, suggestion) } : {}),
    usage: usage(),
  };
}

const runs: Run[] = [];
const failures: string[] = [];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

for (const provider of providers) {
  let model: AgentModelOption;
  try {
    model =
      provider === "claude"
        ? await defaultModel(
            new ClaudeAgentClient(await runCauseEffect(resolveClaudeCli()), undefined, undefined, TIMEOUT_MS),
            provider,
          )
        : await (async () => {
            const cli = await runCauseEffect(resolveCodexCli());
            return defaultModel(
              new CodexAppServerClient(cli.executable, TIMEOUT_MS, cliPathEnvironment(cli)),
              provider,
            );
          })();
  } catch (error) {
    failures.push(`${provider}: ${message(error)}`);
    continue;
  }
  const queue = cases.flatMap((testCase) => Array.from({ length: runCount }, () => testCase));
  const worker = async () => {
    for (let testCase = queue.shift(); testCase; testCase = queue.shift()) {
      try {
        const run = await runCase(provider, model, testCase);
        runs.push(run);
        process.stdout.write(`${provider} ${run.case}: ${run.outcome} (${run.got}, ${run.seconds}s)\n`);
      } catch (error) {
        failures.push(`${provider} ${testCase.id}: ${message(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

const mean = (values: number[]) =>
  values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const ratio = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) / 100 : null);
const summary = providers.map((provider) => {
  const own = runs.filter((run) => run.provider === provider);
  const of = (kind: Run["outcome"]) => own.filter((run) => run.outcome === kind).length;
  const suggested = own.filter((run) => run.suggestion).length;
  const positives = own.filter((run) => run.expected !== "none").length;
  const checked = own.filter((run) => run.checks);
  const checkNames = Object.keys(checked[0]?.checks ?? {});
  return {
    provider,
    model: own[0]?.model ?? null,
    runs: own.length,
    precision: ratio(of("hit"), suggested),
    recall: ratio(of("hit"), positives),
    falseSuggestions: own.filter((run) => run.outcome === "false-suggestion").map((run) => run.case),
    misses: own.filter((run) => run.outcome === "miss").map((run) => run.case),
    wrongTarget: own.filter((run) => run.outcome === "wrong-target").map((run) => `${run.case} → ${run.got}`),
    badAnswers: own.filter((run) => run.outcome === "bad-answer").map((run) => run.case),
    droppedByFilter: own.filter((run) => run.dropped).map((run) => run.case),
    questionChecksFailed: Object.fromEntries(
      checkNames.map((name) => [name, checked.filter((run) => run.checks?.[name] === false).map((run) => run.case)]),
    ),
    meanInputTokens: mean(own.flatMap((run) => (run.usage ? [run.usage.inputTokens] : []))),
    meanOutputTokens: mean(own.flatMap((run) => (run.usage ? [run.usage.outputTokens] : []))),
    meanSeconds: mean(own.map((run) => run.seconds)),
  };
});
mkdirSync(OUT, { recursive: true });
const report = {
  date: new Date().toISOString(),
  runsPerCase: runCount,
  cases: cases.map(({ id, about, expected }) => ({ id, about, expected: label(expected) })),
  summary,
  runs,
  failures,
};
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ summary, failures }, null, 2)}\nReport: ${resolve(OUT, "report.json")}\n`);
if (failures.length) process.exit(1);
