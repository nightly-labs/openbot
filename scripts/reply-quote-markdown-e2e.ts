// Checks that a reply quote renders the original's Markdown in a running Storybook, which renders
// the real shared message body and the real conversation composer.
// Pass the URL that `bun run storybook` reports:
// `bun scripts/reply-quote-markdown-e2e.ts --storybook=http://localhost:6006`.
// Writes .openbot-build/reply-quote-markdown-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/reply-quote-markdown-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const browserExecutable = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface QuoteResult {
  text: string;
  heading: string;
  links: string[];
  listItems: string[];
}

interface Report {
  sent?: QuoteResult;
  composer?: QuoteResult;
  conversationSent?: QuoteResult;
  openFence?: { text: string; replyText: string; replyReachable: boolean };
  error?: string;
  passed: boolean;
}

const report: Report = { passed: false };

async function openStory(page: Page, id: string): Promise<void> {
  await page.goto(`${storybook}/iframe.html?id=${id}&viewMode=story`);
}

/** The quote is inert, so its roles are read with `includeHidden`. */
async function readQuote(quote: Locator): Promise<QuoteResult> {
  await quote.waitFor({ timeout: 60_000 });
  return {
    text: (await quote.textContent()) ?? "",
    heading: (await quote.getByRole("heading", { level: 2, includeHidden: true }).textContent()) ?? "",
    links: await quote.getByRole("link", { includeHidden: true }).allTextContents(),
    listItems: await quote.getByRole("listitem", { includeHidden: true }).allTextContents(),
  };
}

function assertMarkdownQuote(quote: QuoteResult, where: string): void {
  assert.equal(quote.heading, "Launch plan", `${where}: the heading must render as a heading.`);
  assert.ok(
    quote.links.some((link) => link.includes("the release guide")),
    `${where}: the link must render as a link.`,
  );
  assert.equal(quote.listItems.length, 2, `${where}: the list must render as list items.`);
  assert.ok(quote.text.includes("bun run check"), `${where}: the code must show.`);
  for (const mark of ["##", "`", "**"]) {
    assert.ok(!quote.text.includes(mark), `${where}: the Markdown mark ${mark} must not show.`);
  }
  assert.ok(quote.text.includes("<b>the notes</b>"), `${where}: raw HTML must show as text.`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  await openStory(page, "conversation-messagebody--reply-markdown-original");
  report.sent = await readQuote(page.locator(".message-reply-context .message-reply-quote"));
  assertMarkdownQuote(report.sent, "Sent message");
  await page.locator(".message-reply-context").screenshot({ path: resolve(OUT, "sent-quote.png") });

  // A quote cut inside an open code fence must leave the reply under it readable and reachable.
  await openStory(page, "conversation-messagebody--reply-markdown-open-fence");
  const openFenceQuote = page.locator(".message-reply-context .message-reply-quote");
  await openFenceQuote.waitFor({ timeout: 60_000 });
  const reply = page.getByText("Approved. Renew it today", { exact: false });
  await reply.waitFor();
  const replyReachable = await reply.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = element.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && element.contains(hit);
  });
  report.openFence = {
    text: (await openFenceQuote.textContent()) ?? "",
    replyText: (await reply.textContent()) ?? "",
    replyReachable,
  };
  assert.ok(report.openFence.text.includes("bun run check"), "An open fence must still show its code.");
  assert.ok(!report.openFence.text.includes("```"), "An open fence must not show its fence mark.");
  assert.ok(replyReachable, "The reply under a quote with an open fence must be visible and reachable.");
  await page.locator('[data-slot="bubble"]').screenshot({ path: resolve(OUT, "open-fence.png") });

  await page.setViewportSize({ width: 1100, height: 820 });
  await openStory(page, "conversation-conversation--markdown-reply-quote");
  report.composer = await readQuote(page.locator(".composer-reply-preview .message-reply-quote"));
  assertMarkdownQuote(report.composer, "Composer preview");
  report.conversationSent = await readQuote(page.locator(".message-reply-context .message-reply-quote"));
  assertMarkdownQuote(report.conversationSent, "Sent message in the chat");
  assert.deepEqual(
    report.composer,
    report.conversationSent,
    "The composer preview and the sent message must render the quote the same way.",
  );
  await page.screenshot({ path: resolve(OUT, "conversation.png") });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
