import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { Lexer } from "marked";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { emitAgentEvent, installOpenbotStub } from "../../app-test-harness";

// Hard caps for one streamed reply, about 30% above the values measured when each cap was set. They
// count work, not time, so the result is the same on every machine. A red test means a change made
// each streamed chunk do more work. Make the change cheaper, or raise the cap in the same pull
// request and say why. `.openbot-build/transfer-budget/render-streaming.json` has the measured
// values; the CI budget comment compares them with main.
const BUDGETS = {
  /** Characters that marked lexes as blocks while the reply streams. */
  streamingLexedChars: 13_100,
  /** Characters split into content blocks (code, table, text) while the reply streams. */
  streamingSplitChars: 1_030_000,
  /** Characters of code that the highlighter tokenizes while the reply streams. */
  streamingHighlightedChars: 19_600,
  /** Elements added to the document while the reply streams. */
  streamingAddedElements: 4_400,
};

const REPORT_PATH = resolve(import.meta.dirname, "../../../../../.openbot-build/transfer-budget/render-streaming.json");
const CHUNK_SIZE = 96;

const work = vi.hoisted(() => ({
  splitChars: 0,
  highlightedChars: 0,
  highlights: new Set<Promise<unknown>>(),
}));

vi.mock("@speed-highlight/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@speed-highlight/core")>();
  return {
    ...actual,
    tokenize: (...args: Parameters<typeof actual.tokenize>) => {
      work.highlightedChars += args[0].length;
      const run = actual.tokenize(...args);
      work.highlights.add(run);
      void run.finally(() => work.highlights.delete(run)).catch(() => undefined);
      return run;
    },
  };
});

vi.mock("@openbot/ui/features/conversation/DataTable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbot/ui/features/conversation/DataTable")>();
  return {
    ...actual,
    messageContentBlocks: (...args: Parameters<typeof actual.messageContentBlocks>) => {
      work.splitChars += args[0].length;
      return actual.messageContentBlocks(...args);
    },
  };
});

beforeEach(() => {
  installOpenbotStub();
  // Reduced motion shows each chunk at once, so one chunk is one render and no timer decides how
  // many reveal steps run.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  work.splitChars = 0;
  work.highlightedChars = 0;
  work.highlights.clear();
});

describe("streaming render budget", () => {
  it("keeps one streamed reply within its render work caps", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(window.openbot.agent.readConversation).toHaveBeenCalledWith("chief"));

    const lex = vi.spyOn(Lexer.prototype, "lex");
    let addedElements = 0;
    const countAdded = (records: MutationRecord[]) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) addedElements += 1 + node.querySelectorAll("*").length;
        }
      }
    };
    const observer = new MutationObserver(countAdded);
    observer.observe(document.body, { childList: true, subtree: true });

    const reply = streamedReply();
    for (let offset = 0, revision = 1; offset < reply.length; offset += CHUNK_SIZE, revision += 1) {
      emitAgentEvent?.({
        type: "conversation-delta",
        agentId: "chief",
        threadId: "thread-chief",
        turnId: "turn-budget",
        messageId: "agent-budget-reply",
        delta: reply.slice(offset, offset + CHUNK_SIZE),
        createdAt: "2026-10-06T09:00:00.000Z",
        revision,
      });
      // A real chunk arrives after the last highlight finished, so each one waits for it here.
      while (work.highlights.size > 0) await Promise.allSettled([...work.highlights]);
      await Promise.resolve();
    }

    await waitFor(() =>
      expect(document.querySelector('[data-chat-search-message="agent-budget-reply"]')).toHaveTextContent(
        "End of the budget reply.",
      ),
    );
    countAdded(observer.takeRecords());
    observer.disconnect();

    const measured: typeof BUDGETS = {
      streamingLexedChars: lex.mock.calls.reduce((total, [source]) => total + source.length, 0),
      streamingSplitChars: work.splitChars,
      streamingHighlightedChars: work.highlightedChars,
      streamingAddedElements: addedElements,
    };
    await mkdir(join(REPORT_PATH, ".."), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify({ measured, budgets: BUDGETS }, null, 2)}\n`);
    const values = new Map(Object.entries(measured));
    for (const [name, budget] of Object.entries(BUDGETS)) {
      // A zero means that a spy stopped counting, not that the reply is free.
      expect(values.get(name), name).toBeGreaterThan(0);
      expect(values.get(name), name).toBeLessThanOrEqual(budget);
    }
  });
});

/**
 * One fixed reply of about 12 KB in the shape of a long agent answer: prose with non-Latin-1
 * characters, a table, a 120-line TypeScript block, and long prose with a list after it.
 */
function streamedReply(): string {
  const intro = [
    "## Plan — what changes and why",
    "",
    "The renderer does the same work again for each chunk. Here is the summary “before” the code:",
    "",
    "| Area | Cost | Owner |",
    "| --- | ---: | --- |",
    ...Array.from({ length: 8 }, (_, index) => `| Area ${index + 1} | ${(index + 1) * 12} ms | Team ${index % 3} |`),
    "",
  ];
  const code = [
    "```ts",
    ...Array.from({ length: 30 }, (_, index) => [
      `export function step${index}(values: readonly number[]): number {`,
      `  const total = values.reduce((sum, value) => sum + value * ${index + 1}, 0);`,
      `  return total > ${index * 10} ? total : "${index}".length; // keep — step ${index}`,
      "}",
    ]).flat(),
    "```",
    "",
  ];
  const outro = Array.from({ length: 24 }, (_, index) =>
    [
      `### Step ${index + 1} — result`,
      "",
      `The change in step ${index + 1} keeps **finished blocks** as they are and reads the layout once. It is “safe” because the text does not move.`,
      "",
      `- Item ${index + 1}.1 with \`inline code\` and a [link](https://example.com/${index}).`,
      `- Item ${index + 1}.2 — a second point.`,
      "",
    ].join("\n"),
  );
  return [...intro, ...code, ...outro, "End of the budget reply."].join("\n");
}
