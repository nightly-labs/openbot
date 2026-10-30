// Checks that the reader can scroll away from a reply that is still arriving, and from new messages
// that arrive in a burst, in a running Storybook that renders the real agent chat and channel chat
// against the preview mock. Read-only. Pass the URL that `bun run storybook` reports:
// `bun scripts/chat-scroll-streaming-e2e.ts --storybook=http://localhost:6006 [--stories=burst,channel]`.
// The chat must follow new content while the reader is at the bottom, also after a sideways swipe, stay
// at the bottom across growth while a turn runs, hold still after a short scroll up and after a long
// one, follow again when the reader goes back to the bottom, hold still after a scroll up with the
// arrow key, and hold still after a smooth jump up from the bottom with the scroll rail. In a burst, the jump button must count the new messages and return to the latest one, a
// message the reader sends while scrolled up must return the chat to the bottom, and a focus move to a
// control above the view, as Tab or a screen reader makes, must hold the chat still. A focus that
// returns to a control above the view without a scroll, as a closed dialog or menu gives it, must not
// stop the follow.
// It checks histories of 40 rows, which the chats draw whole, and of 120, which they virtualize.
// Writes .openbot-build/chat-scroll-streaming-e2e/report.json and one screenshot per story.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/chat-scroll-streaming-e2e");
const SCROLL = ".conversation-scroll";
const AGENT_COMPOSER = ".composer [contenteditable='true']";
const REPLY = '[data-chat-search-message="reading-history-reply"]';

interface StoryCase {
  id: string;
  /** An element that must hold still; by default the top row on the screen. */
  anchor?: string;
  /** The composer of a burst story, for the checks of the jump button and of a send. */
  composer?: string;
}

const STORIES: StoryCase[] = [
  { id: "conversation-conversation--streaming-while-reading-history", anchor: REPLY },
  { id: "conversation-conversation--streaming-while-reading-long-history", anchor: REPLY },
  {
    id: "conversation-conversation--reply-burst-while-reading-history",

    composer: AGENT_COMPOSER,
  },
  {
    id: "conversation-conversation--reply-burst-while-reading-long-history",

    composer: AGENT_COMPOSER,
  },
  // A channel draws its rows in the same view, with an author header for each run.
  { id: "conversation-channel--streaming-while-reading-history", anchor: REPLY },
  { id: "conversation-channel--streaming-while-reading-long-history", anchor: REPLY },
  { id: "conversation-channel--reply-burst-while-reading-history", composer: AGENT_COMPOSER },
  { id: "conversation-channel--reply-burst-while-reading-long-history", composer: AGENT_COMPOSER },
];
/* Enough growth for several reveal steps of a reply, several resizes of the thinking line, or several new rows. */
const GROWTH = 400;
const TOLERANCE = 2;
const storybook = option("storybook");
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");
const filters = option("stories")?.split(",");

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

interface Position {
  scrollTop: number;
  scrollHeight: number;
  distanceFromBottom: number;
  anchorTop: number;
}

interface HoldResult {
  before: Position;
  after: Position;
  scrollTopMoved: number;
  anchorMoved: number;
}

interface BottomHold {
  samples: number;
  maxRemaining: number;
  minScrollTopDelta: number;
}

interface StoryResult {
  follows?: Position;
  followsAfterSidewaysSwipe?: Position;
  staysAtBottom?: BottomHold;
  shortScrollUp?: HoldResult;
  longScrollUp?: HoldResult;
  followsAgain?: Position;
  arrowKeyScrollUp?: HoldResult;
  followsBeforeRailJump?: Position;
  railJump?: HoldResult;
  newMessageCounts?: number[];
  followsAfterJump?: Position;
  followsAfterSend?: Position;
  followsAfterFocusReturn?: Position;
  focusAbove?: HoldResult;
  error?: string;
}

interface Report {
  stories: Record<string, StoryResult>;
  passed: boolean;
}

const report: Report = { stories: {}, passed: false };

/* The anchor is the given element, or the row with this index. */
function position(page: Page, story: StoryCase, anchorIndex?: string): Promise<Position> {
  return page.evaluate(
    ({ scrollSelector, anchor, index }) => {
      const scroll = document.querySelector<HTMLElement>(scrollSelector);
      if (!scroll) throw new Error("The conversation is missing.");
      const row = anchor
        ? document.querySelector<HTMLElement>(anchor)
        : index !== undefined
          ? scroll.querySelector<HTMLElement>(`[data-index="${index}"]`)
          : null;
      return {
        scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight,
        distanceFromBottom: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
        anchorTop: row ? row.getBoundingClientRect().top - scroll.getBoundingClientRect().top : Number.NaN,
      };
    },
    { scrollSelector: SCROLL, anchor: story.anchor, index: anchorIndex },
  );
}

/* The index of the first row whose bottom is on the screen. */
function topRowIndex(page: Page): Promise<string | undefined> {
  return page.evaluate((scrollSelector) => {
    const scroll = document.querySelector<HTMLElement>(scrollSelector);
    if (!scroll) throw new Error("The conversation is missing.");
    const top = scroll.getBoundingClientRect().top;
    const rows = [...scroll.querySelectorAll<HTMLElement>("[data-index]")];
    return rows.find((row) => row.getBoundingClientRect().bottom > top)?.dataset.index;
  }, SCROLL);
}

/* The chat grows by itself; this waits for it to grow, then for the next two frames to paint. */
async function waitForGrowth(page: Page, story: StoryCase): Promise<void> {
  const from = (await position(page, story)).scrollHeight;
  await page.waitForFunction(
    ([scrollSelector, height, growth]) =>
      (document.querySelector(scrollSelector)?.scrollHeight ?? 0) >= height + growth,
    [SCROLL, from, GROWTH] as const,
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))),
  );
}

/*
 * An input, then the scroll event that moves the chat in its direction. A scroll event that the chat's
 * own follow queued before the input can arrive first.
 */
async function scrollWith(page: Page, up: boolean, input: () => Promise<void>): Promise<void> {
  const scrolled = page.evaluate(
    ({ scrollSelector, towardTop }) => {
      const scroll = document.querySelector<HTMLElement>(scrollSelector);
      if (!scroll) throw new Error("The conversation is missing.");
      const from = scroll.scrollTop;
      return new Promise((done) => {
        const onScroll = () => {
          if (towardTop ? scroll.scrollTop >= from : scroll.scrollTop <= from) return;
          scroll.removeEventListener("scroll", onScroll);
          done(undefined);
        };
        scroll.addEventListener("scroll", onScroll);
      });
    },
    { scrollSelector: SCROLL, towardTop: up },
  );
  await input();
  await scrolled;
}

function wheel(page: Page, deltaY: number): Promise<void> {
  return scrollWith(page, deltaY < 0, () => page.mouse.wheel(0, deltaY));
}

async function longScrollUp(page: Page): Promise<void> {
  for (let step = 0; step < 8; step += 1) await wheel(page, -40);
}

async function holds(page: Page, story: StoryCase, scrollUp: () => Promise<void>): Promise<HoldResult> {
  await scrollUp();
  const anchorIndex = story.anchor ? undefined : await topRowIndex(page);
  const before = await position(page, story, anchorIndex);
  await waitForGrowth(page, story);
  const after = await position(page, story, anchorIndex);
  return {
    before,
    after,
    scrollTopMoved: after.scrollTop - before.scrollTop,
    anchorMoved: after.anchorTop - before.anchorTop,
  };
}

function assertHolds(story: string, name: string, hold: HoldResult): void {
  assert.ok(hold.after.distanceFromBottom > 80, `${story}: the chat went back to the bottom after ${name}.`);
  assert.ok(Math.abs(hold.scrollTopMoved) <= TOLERANCE, `${story}: the chat moved after ${name}.`);
  assert.ok(Math.abs(hold.anchorMoved) <= TOLERANCE, `${story}: the content moved after ${name}.`);
}

async function assertFollows(page: Page, story: StoryCase, name: string): Promise<Position> {
  await waitForGrowth(page, story);
  const result = await position(page, story);
  assert.ok(result.distanceFromBottom <= 80, `${story.id}: the chat does not follow ${name}.`);
  return result;
}

/*
 * While a turn runs, growth must not bounce the chat off the bottom. The sampling stops after about 30
 * seconds of frames, as `waitForGrowth` does, so a chat that stops growing fails and writes the report.
 */
async function assertStaysAtBottom(page: Page, story: StoryCase): Promise<BottomHold> {
  const { samples, grew } = await page.evaluate(
    ({ scrollSelector, growth }) => {
      const scroll = document.querySelector<HTMLElement>(scrollSelector);
      if (!scroll) throw new Error("The conversation is missing.");
      const from = scroll.scrollHeight;
      const samples: Array<{ scrollTop: number; remaining: number }> = [];
      const record = () => {
        samples.push({
          scrollTop: scroll.scrollTop,
          remaining: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
        });
      };
      record();
      return new Promise<{ samples: Array<{ scrollTop: number; remaining: number }>; grew: boolean }>((done) => {
        const step = () => {
          record();
          const grew = scroll.scrollHeight >= from + growth;
          if (grew || samples.length > 1_800) done({ samples, grew });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
    { scrollSelector: SCROLL, growth: GROWTH },
  );
  assert.ok(grew && samples.length >= 2, `${story.id}: the chat did not grow at the bottom.`);
  let maxRemaining = 0;
  let minScrollTopDelta = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;
    maxRemaining = Math.max(maxRemaining, current.remaining);
    minScrollTopDelta = Math.min(minScrollTopDelta, current.scrollTop - previous.scrollTop);
    assert.ok(
      current.remaining <= 80 || previous.remaining <= 80,
      `${story.id}: the chat left the bottom while a turn ran (remaining ${current.remaining}).`,
    );
    assert.ok(current.scrollTop + TOLERANCE >= previous.scrollTop, `${story.id}: the chat jumped up while a turn ran.`);
  }
  return { samples: samples.length, maxRemaining, minScrollTopDelta };
}

/*
 * Focus on the last control above the view that does not have the focus, then two painted frames. Tab
 * or a screen reader scrolls to the control; a closed dialog or menu gives the focus back with
 * `preventScroll`.
 */
async function focusAbove(page: Page, preventScroll = false): Promise<void> {
  await page.evaluate(
    ({ scrollSelector, preventScroll }) => {
      const scroll = document.querySelector<HTMLElement>(scrollSelector);
      if (!scroll) throw new Error("The conversation is missing.");
      const top = scroll.getBoundingClientRect().top;
      const control = [...scroll.querySelectorAll<HTMLElement>("button")]
        .filter((element) => element !== document.activeElement && element.getBoundingClientRect().bottom < top - 200)
        .at(-1);
      if (!control) throw new Error("No control above the view.");
      control.focus({ preventScroll });
      return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined))));
    },
    { scrollSelector: SCROLL, preventScroll },
  );
}

/* A jump with the scroll rail to the fifth section from the end, then the frames until the smooth scroll stops. */
async function railJump(page: Page): Promise<void> {
  await page.evaluate((scrollSelector) => {
    const scroll = document.querySelector<HTMLElement>(scrollSelector);
    if (!scroll) throw new Error("The conversation is missing.");
    const link = [...document.querySelectorAll<HTMLElement>(".chat-scroll-rail-link")].at(-5);
    if (!link) throw new Error("The scroll rail has no section to jump to.");
    link.click();
    return new Promise((done) => {
      let last = scroll.scrollTop;
      let still = 0;
      const step = () => {
        still = scroll.scrollTop === last ? still + 1 : 0;
        last = scroll.scrollTop;
        if (still >= 6) done(undefined);
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, SCROLL);
}

async function newMessageCount(page: Page): Promise<number> {
  const label = await page.locator(".scroll-to-latest-count").textContent();
  return Number(label?.match(/\d+/)?.[0] ?? 0);
}

async function openStory(page: Page, story: StoryCase): Promise<void> {
  await page.goto(`${storybook}/iframe.html?id=${story.id}&viewMode=story`);
  await page.locator(`${SCROLL} [data-index]`).first().waitFor();
}

async function checkStory(page: Page, story: StoryCase, result: StoryResult): Promise<void> {
  await openStory(page, story);
  const box = await page.locator(SCROLL).boundingBox();
  assert.ok(box, `${story.id}: the conversation has no box.`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // At the bottom, the chat follows new content.
  result.follows = await assertFollows(page, story, "new content at the bottom");

  // A sideways swipe with a small vertical delta, as a trackpad sends, does not stop the follow.
  await page.mouse.wheel(-60, -1);
  result.followsAfterSidewaysSwipe = await assertFollows(page, story, "new content after a sideways swipe");

  // While the turn still runs, further growth must keep the chat at the bottom.
  result.staysAtBottom = await assertStaysAtBottom(page, story);

  // A short scroll up, less than the distance that counted as the bottom, holds the chat still.
  // A longer scroll up holds it still too. Both are measured before either is checked.
  result.shortScrollUp = await holds(page, story, () => wheel(page, -40));
  result.longScrollUp = await holds(page, story, () => longScrollUp(page));
  await page.screenshot({ path: resolve(OUT, `${story.id.replace("conversation-", "")}.png`) });
  assertHolds(story.id, "a short scroll up", result.shortScrollUp);
  assertHolds(story.id, "a long scroll up", result.longScrollUp);

  // Back at the bottom, the chat follows again.
  await wheel(page, 100_000);
  result.followsAgain = await assertFollows(page, story, "new content again at the bottom");

  // A click on a row leaves the focus on the page; the arrow key then scrolls the chat up. The content
  // keeps growing, so the click goes to a point and does not wait for a row to stop moving.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  result.arrowKeyScrollUp = await holds(page, story, () =>
    scrollWith(page, true, () => page.keyboard.press("ArrowUp")),
  );
  assertHolds(story.id, "a scroll up with the arrow key", result.arrowKeyScrollUp);

  if (!story.composer) return;
  // The jump button counts the messages that arrive while the reader is away, and returns to the latest.
  const firstCount = await newMessageCount(page);
  await waitForGrowth(page, story);
  result.newMessageCounts = [firstCount, await newMessageCount(page)];
  assert.ok(firstCount > 0, `${story.id}: the jump button does not count the new messages.`);
  assert.ok(
    (result.newMessageCounts[1] ?? 0) > firstCount,
    `${story.id}: the jump button does not count the messages that arrived later.`,
  );
  await page.locator(".scroll-to-latest-button").click();
  result.followsAfterJump = await assertFollows(page, story, "new content after the jump to the latest message");

  // A message the reader sends while scrolled up returns the chat to the bottom.
  await longScrollUp(page);
  await page.locator(story.composer).click();
  await page.keyboard.type("Thanks, keep going.");
  await page.keyboard.press("Enter");
  result.followsAfterSend = await assertFollows(page, story, "new content after a send");

  // A focus that returns to a control above the view without a scroll does not stop the follow.
  await focusAbove(page, true);
  result.followsAfterFocusReturn = await assertFollows(page, story, "new content after a focus return");

  // A focus move to a control above the view scrolls the chat with no reader input; the chat holds still.
  result.focusAbove = await holds(page, story, () => focusAbove(page));
  assertHolds(story.id, "a focus move up", result.focusAbove);
}

/*
 * A smooth jump up from the bottom with the scroll rail holds the chat at the section. Its first scroll
 * events are still near the bottom. The other checks turn smooth scrolling off, which makes this jump
 * instant, so it runs in a second browser.
 */
async function checkRailJump(page: Page, story: StoryCase, result: StoryResult): Promise<void> {
  await openStory(page, story);
  result.followsBeforeRailJump = await assertFollows(page, story, "new content before a rail jump");
  result.railJump = await holds(page, story, () => railJump(page));
  assertHolds(story.id, "a jump with the scroll rail", result.railJump);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", args: ["--disable-smooth-scrolling"] });
const smoothBrowser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  const smoothPage = await smoothBrowser.newPage({ viewport: { width: 1200, height: 860 } });
  for (const story of STORIES.filter(
    (candidate) => !filters || filters.some((filter) => candidate.id.includes(filter)),
  )) {
    const result: StoryResult = {};
    report.stories[story.id] = result;
    // Each story is checked, so one run shows every chat that fails.
    try {
      await checkStory(page, story, result);
      await checkRailJump(smoothPage, story, result);
    } catch (cause) {
      result.error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const failures = Object.values(report.stories).flatMap((result) => (result.error ? [result.error] : []));
  report.passed = failures.length === 0;
  assert.equal(failures.length, 0, failures.join("\n"));
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await browser.close();
  await smoothBrowser.close();
}
