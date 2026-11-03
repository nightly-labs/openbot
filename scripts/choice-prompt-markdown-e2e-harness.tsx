// The Solid harness that `scripts/choice-prompt-markdown-e2e.ts` bundles and runs. It renders the
// real `QuestionPromptBubble` from `@openbot/ui` into a jsdom document, clicks the Markdown link in
// the title, and asserts that the handler the renderer passes receives the link address. It also
// checks that a plain title renders as text, with no link and no Markdown characters.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";

const ROOT = process.env.CHOICE_PROMPT_MARKDOWN_E2E_ROOT ?? resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build/choice-prompt-markdown-e2e");

// --- The browser that Solid renders into. ---

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const { window } = dom;
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  CustomEvent: window.CustomEvent,
  MessageEvent: window.MessageEvent,
  DocumentFragment: window.DocumentFragment,
  SVGElement: window.SVGElement,
  requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  getComputedStyle: window.getComputedStyle.bind(window),
  IntersectionObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  scrollTo: () => undefined,
});

const { createComponent, render } = await import("@solidjs/web");
const { QuestionPromptBubble } = await import("@openbot/ui/components/QuestionPromptBubble");

// --- The harness. ---

const LINK_URL = "https://example.com/docs";
const LINK_TITLE = `Read the [setup guide](${LINK_URL}) before you choose.`;

function questions(question: string) {
  return [
    {
      id: "choice",
      header: "Choice",
      question,
      isSecret: false,
      options: [
        { label: "First", description: "The first option." },
        { label: "Second", description: "The second option." },
      ],
    },
  ];
}

interface RenderedPrompt {
  host: HTMLDivElement;
  dispose: () => void;
  opened: string[];
}

function renderPrompt(question: string): RenderedPrompt {
  const opened: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(
    () =>
      createComponent(QuestionPromptBubble, {
        questions: questions(question),
        onSubmit: async () => false,
        onOpenLink: (url: string) => {
          opened.push(url);
        },
      }),
    host,
  );
  return { host, dispose, opened };
}

function titleElement(host: HTMLDivElement): Element {
  const title = host.querySelector("h2");
  assert.ok(title, "The prompt title did not render.");
  return title;
}

function click(link: Element): void {
  link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

interface CaseResult {
  name: string;
  passed: boolean;
  checks: Record<string, boolean>;
  error?: string;
}

const cases: [string, () => CaseResult][] = [
  [
    "a Markdown link in the title renders as a link and opens through the handler",
    () => {
      const prompt = renderPrompt(LINK_TITLE);
      try {
        const title = titleElement(prompt.host);
        const link = title.querySelector("a");
        assert.ok(link, "The title has no link.");
        assert.equal(link.getAttribute("href"), LINK_URL, "The link address is wrong.");
        assert.equal(link.textContent, "setup guide", "The link text is wrong.");
        assert.ok(
          !title.textContent?.includes("[") && !title.textContent?.includes("]("),
          "The title still shows raw Markdown.",
        );
        click(link);
        assert.deepEqual(prompt.opened, [LINK_URL], "The handler did not receive the link address.");
        return {
          name: "link title",
          passed: true,
          checks: { rendersLink: true, href: true, linkText: true, noRawMarkdown: true, handlerCalled: true },
        };
      } finally {
        prompt.dispose();
      }
    },
  ],
  [
    "a plain title renders as text, with no link and no Markdown change",
    () => {
      const plain = "Which option do you want?";
      const prompt = renderPrompt(plain);
      try {
        const title = titleElement(prompt.host);
        assert.equal(title.querySelectorAll("a").length, 0, "A plain title has a link.");
        assert.equal(title.textContent, plain, "A plain title changed.");
        click(title);
        assert.deepEqual(prompt.opened, [], "A plain title opened a link.");
        return {
          name: "plain title",
          passed: true,
          checks: { noLink: true, sameText: true, noOpen: true },
        };
      } finally {
        prompt.dispose();
      }
    },
  ],
  [
    "a title with text after the link keeps the text and opens only the link",
    () => {
      const prompt = renderPrompt(`Start [here](${LINK_URL}) and finish.`);
      try {
        const title = titleElement(prompt.host);
        const link = title.querySelector("a");
        assert.ok(link, "The title has no link.");
        assert.equal(title.textContent, "Start here and finish.", "The title text is wrong.");
        click(link);
        assert.deepEqual(prompt.opened, [LINK_URL], "The handler did not receive the link address.");
        return {
          name: "link with surrounding text",
          passed: true,
          checks: { rendersLink: true, keepsText: true, handlerCalled: true },
        };
      } finally {
        prompt.dispose();
      }
    },
  ],
];

mkdirSync(OUT, { recursive: true });
const results: CaseResult[] = [];
for (const [name, run] of cases) {
  process.stdout.write(`- ${name}\n`);
  try {
    results.push(run());
  } catch (error) {
    results.push({ name, passed: false, checks: {}, error: error instanceof Error ? error.message : String(error) });
  }
}
const passed = results.every((result) => result.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed, results }, null, 2)}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
if (!passed) {
  for (const result of results.filter((candidate) => !candidate.passed)) {
    process.stderr.write(`${result.name}: ${result.error ?? JSON.stringify(result.checks)}\n`);
  }
  process.exit(1);
}
process.exit(0);
