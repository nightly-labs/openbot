// Runs the real Dynamic Island on a Linux X11 desktop and drives it with the real pointer and keyboard:
// 1. The island is a DOCK window at the top centre of the work area, above other windows and on all workspaces.
// 2. A click outside the shape of the island goes to the window under it.
// 3. The pointer on the island expands it.
// 4. Text typed in the inline reply is sent with Return.
// 5. A click on Approve answers an approval request.
// 6. A switch to another workspace keeps the island on the screen.
// 7. With the pointer away, an idle island keeps its greeting and its logo still: it uses little CPU and
//    does not send a new shape. The pointer on the island changes the greetings again. The greeting
//    emoji draws in color on a desktop with no emoji font.
//
// Build the app first (`bun run build`), then run on Linux: bun scripts/linux-dynamic-island-e2e.ts
// `scripts/linux-above-apps-e2e.ts` starts the desktop and records the video (see there).
// It writes .openbot-build/linux-dynamic-island-e2e/<desktop>/report.json, screenshots and video.mp4.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { DynamicIslandAgentIdentity, DynamicIslandPresentation } from "@openbot/contracts/ipc";
import { Schema } from "effect";
import {
  buildHarness,
  checkOtherWorkspace,
  closeSession,
  cpuOf,
  type Desktop,
  decodeBoolean,
  decodeBox,
  decodeNumber,
  decodePage,
  firstClick,
  fromPixels,
  type Harness,
  MOTION_DONE,
  NO_WINDOW_MODES,
  NO_WINDOW_WAIT_MS,
  openSession,
  pointOutside,
  type Rect,
  RectSchema,
  screenshot,
  startDesktopAndRecorder,
  startHarness,
  TWO_FRAMES,
  until,
  windowManagerProperties,
} from "./linux-above-apps-e2e";

/** Two greeting intervals: with the pointer on the island, it shows the next greeting every 8 s. */
const IDLE_SECONDS = 16;
/**
 * Percent of one core, in the second half of the idle measure. With the pointer away, the idle island
 * draws no frame. The greeting crossfades and the blink cost 1.2% on X11 in software, with no GPU; one
 * motion that never ended cost about a fifth of a core on macOS. The first seconds after the change to
 * idle can have short peaks of clean-up work: 1% on GNOME, all in the first 8 s.
 */
const IDLE_CPU_LIMIT_PERCENT = 1;
/** The number of colored pixels of the first greeting emoji, drawn with the font of the greeting. */
const GREETING_COLOR_PIXELS = `(async () => {
  const style = getComputedStyle(document.querySelector('.dynamic-island-surface-idle-greeting'));
  const font = '48px ' + style.fontFamily;
  await document.fonts.load(font, '\u{1F44B}');
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.font = font;
  context.textBaseline = 'top';
  context.fillStyle = '#000';
  context.fillText('\u{1F44B}', 4, 4);
  const data = context.getImageData(0, 0, 64, 64).data;
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    if (data[i + 3] > 0 && Math.max(red, green, blue) - Math.min(red, green, blue) > 60) colored += 1;
  }
  return colored;
})()`;
const EXPANDED = 'document.querySelector(\'[data-slot="dynamic-island"][data-state="expanded"]\') !== null';
const REPLY = ".dynamic-island-reply-input";
const AWAY = fromPixels(300, 700);

const AGENT: DynamicIslandAgentIdentity = {
  id: "agent-1",
  name: "Ada",
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};
const MESSAGE: DynamicIslandPresentation = {
  serverId: "local",
  mode: "message",
  unreadCount: 1,
  message: {
    agent: AGENT,
    messageId: "message-1",
    text: "The build is ready. Do you want a pull request?",
    createdAt: new Date().toISOString(),
  },
};
const APPROVAL: DynamicIslandPresentation = {
  serverId: "local",
  mode: "approval",
  remainingCount: 0,
  item: {
    requestId: "request-1",
    agent: AGENT,
    title: "Run a command",
    detail: "bun run build",
    truncated: false,
    approval: {
      kind: "command",
      command: "bun run build",
      cwd: "/home/user/project",
      reason: "Build the app before the pull request",
      grantRoot: null,
      permissions: null,
    },
  },
};
const WORKING: DynamicIslandPresentation = {
  serverId: "local",
  mode: "working",
  working: [{ agent: AGENT, task: "Writing the release notes", turnId: "turn-1" }],
};
const IDLE: DynamicIslandPresentation = { serverId: "local", mode: "idle" };

const IslandInfoSchema = Schema.Struct({
  bounds: RectSchema,
  workArea: RectSchema,
  xid: Schema.Number,
  visible: Schema.Boolean,
  allWorkspaces: Schema.Boolean,
  mainPid: Schema.Number,
});
type IslandInfo = typeof IslandInfoSchema.Type;
const StatsSchema = Schema.Struct({
  actions: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  regions: Schema.Array(Schema.Struct({ at: Schema.Number, rects: Schema.Array(RectSchema) })),
  interactive: Schema.Array(
    Schema.Struct({ at: Schema.Number, interactive: Schema.Boolean, keyboard: Schema.Boolean }),
  ),
  rendererErrors: Schema.Array(Schema.String),
  unhandled: Schema.Array(Schema.String),
  x11: Schema.Boolean,
  aboveAppsWindows: Schema.Number,
});
type Stats = typeof StatsSchema.Type;
const decodeIsland = Schema.decodeUnknownSync(IslandInfoSchema);
const decodeNumbers = Schema.decodeUnknownSync(Schema.Array(Schema.Number));
const decodeStats = Schema.decodeUnknownSync(StatsSchema);
const decodeString = Schema.decodeUnknownSync(Schema.String);

const steps: { step: string; detail?: unknown }[] = [];
const session = await openSession("linux-dynamic-island-e2e");
let passed = false;
let error: string | undefined;
let stats: Stats | undefined;
const cpu: Record<string, Awaited<ReturnType<typeof cpuOf>>> = {};
let started: App | undefined;
let islandPage: { url: string; html: string } | string | undefined;

try {
  const bundle = buildHarness("linux-dynamic-island-electron.ts", "linux-dynamic-island-e2e");
  const desktop = await startDesktopAndRecorder(session);

  const app = islandApp(startHarness<Command>(session, bundle));
  started = app;
  await app.ready;
  assert.equal((await app.stats()).x11, true, "the app uses X11 windows");
  await until(
    async () => await app.eval("island", "document.querySelector('.dynamic-island-shell') !== null", decodeBoolean),
    "the island",
  );
  await app.publish(MESSAGE);
  await until(
    async () =>
      await app.eval(
        "island",
        `document.querySelector(${JSON.stringify(".dynamic-island-message-first-panel, .dynamic-island-surface-compact-name")}) !== null`,
        decodeBoolean,
      ),
    "the message",
  );
  await until(async () => (await app.stats()).regions.some((entry) => entry.rects.length > 0), "the first shape");
  await settle(app);
  const island = await app.island();

  // 1. Placement: centred in the work area, at its top edge, below a top panel.
  const properties = await windowManagerProperties(session, island.xid);
  const centre = island.bounds.x + island.bounds.width / 2;
  assert.ok(
    Math.abs(centre - (island.workArea.x + island.workArea.width / 2)) <= 1,
    `the island is centred (${centre} in ${JSON.stringify(island.workArea)})`,
  );
  assert.equal(island.bounds.y, island.workArea.y, "the island is at the top of the work area");
  assert.equal(island.visible, true);
  const shell = await screenBox(app, island, ".dynamic-island-shell");
  steps.push({
    step: "placement",
    detail: { bounds: island.bounds, workArea: island.workArea, shell, properties: properties.trim().split("\n") },
  });
  screenshot(session, "01-placement");

  // 2. Click-through: a point of the island window outside its shape. A first click away from the
  // island shows that the pointer of the test reaches the window under it.
  await firstClick(desktop, AWAY, () => app.eval("main", "clicks.length", decodeNumber));
  const region = latestRegion(await app.stats());
  const outside = pointOutside(island.bounds, region);
  const clicksBefore = await app.eval("main", "clicks.length", decodeNumber);
  desktop.move(outside.x, outside.y);
  desktop.click();
  await until(
    async () => (await app.eval("main", "clicks.length", decodeNumber)) > clicksBefore,
    "the click under the island",
  );
  assert.equal(await app.eval("island", EXPANDED, decodeBoolean), false, "a click beside the island leaves it shut");
  steps.push({ step: "click-through", detail: { point: outside, region } });

  // 3. Hover expands the island.
  await hoverOpen(app, desktop, island);
  screenshot(session, "02-hover");
  steps.push({ step: "hover expands" });

  // 4. Typing in the inline reply.
  const field = centreOf(await screenBox(app, island, REPLY));
  desktop.move(field.x, field.y);
  desktop.click();
  await until(
    async () =>
      await app.eval("island", `document.activeElement?.matches(${JSON.stringify(REPLY)}) === true`, decodeBoolean),
    "the focused reply field",
  );
  await desktop.type("Yes, open it");
  await until(
    async () =>
      (await app.eval("island", `document.querySelector(${JSON.stringify(REPLY)})?.value ?? ''`, decodeString)) ===
      "Yes, open it",
    "the typed reply",
  );
  await settle(app);
  screenshot(session, "03-typed");
  desktop.key("Return");
  await until(
    async () =>
      (await app.stats()).actions.some((action) => action.type === "send-message" && action.text === "Yes, open it"),
    "the sent reply",
  );
  await until(async () => !(await app.eval("island", EXPANDED, decodeBoolean)), "the island shuts after the reply");
  const keyboard = (await app.stats()).interactive.some((entry) => entry.keyboard);
  assert.equal(keyboard, true, "the reply field asked for key input");
  steps.push({ step: "typing sends the reply" });

  // 5. Approve a request.
  await leave(app, desktop);
  await app.publish(APPROVAL);
  await until(
    async () =>
      await app.eval(
        "island",
        "document.querySelector('[data-slot=\"dynamic-island\"]')?.textContent?.includes('Ada') === true",
        decodeBoolean,
      ),
    "the approval",
  );
  await hoverOpen(app, desktop, island);
  const approve = centreOf(await screenBoxOf(app, island, buttonByText("Approve"), "the Approve button"));
  desktop.move(approve.x, approve.y);
  await settle(app);
  screenshot(session, "04-approval");
  desktop.click();
  await until(
    async () => (await app.stats()).actions.some((action) => action.type === "respond-approval"),
    "the approval answer",
  );
  steps.push({ step: "click on Approve answers the request" });

  // 6. Another workspace.
  await leave(app, desktop);
  await checkOtherWorkspace(session, desktop, island.xid, "05-workspace-2");
  steps.push({ step: "all workspaces" });

  // 7. CPU with the pointer away: an agent at work, then idle.
  await app.publish(WORKING);
  await sleep(2_000);
  screenshot(session, "06-working");
  cpu.working = await cpuOf(island.mainPid, IDLE_SECONDS);
  await app.publish(IDLE);
  await until(
    async () =>
      await app.eval(
        "island",
        "document.querySelector('.dynamic-island-surface-idle-greeting') !== null",
        decodeBoolean,
      ),
    "the idle island",
  );
  // The image has no emoji font: the greeting draws with the font of the app. A missing glyph draws a
  // grey box; an emoji has colors.
  const greetingColorPixels = await app.eval("island", GREETING_COLOR_PIXELS, decodeNumber);
  assert.ok(greetingColorPixels > 100, `the greeting emoji has colors (${greetingColorPixels} pixels)`);
  steps.push({ step: "greeting emoji in color", detail: { pixels: greetingColorPixels } });
  await settle(app);
  screenshot(session, "07-idle");
  // The screenshot and the change to idle end before the measure.
  await settle(app);
  // The greeting changes and the blinks of the logo.
  await app.eval(
    "island",
    "(() => { window.e2eGreetingChanges = []; window.e2eBlinks = []; new MutationObserver(() => e2eGreetingChanges.push(Date.now())).observe(document.querySelector('.dynamic-island-surface-idle-greeting'), { attributes: true, attributeFilter: ['data-active-slot'] }); new MutationObserver(() => e2eBlinks.push(Date.now())).observe(document.querySelector('.dynamic-island-surface-logo'), { attributes: true, attributeFilter: ['data-blink'] }); return true; })()",
    decodeBoolean,
  );
  const regionsBefore = (await app.stats()).regions.length;
  const usage = await cpuOf(island.mainPid, IDLE_SECONDS);
  const regionsAfter = (await app.stats()).regions.length;
  cpu.idle = usage;
  const away = {
    greetingChanges: (await app.eval("island", "e2eGreetingChanges", decodeNumbers)).length,
    blinks: (await app.eval("island", "e2eBlinks", decodeNumbers)).length,
  };
  steps.push({ step: "CPU", detail: { cpu, away } });
  assert.equal(regionsAfter, regionsBefore, "an idle island sends no shape");
  assert.deepEqual(away, { greetingChanges: 0, blinks: 0 }, "with the pointer away, the idle island stays still");
  const steady = usage.perSecond.slice(IDLE_SECONDS / 2);
  const steadyPercent = steady.reduce((sum, value) => sum + value, 0) / steady.length;
  assert.ok(
    steadyPercent < IDLE_CPU_LIMIT_PERCENT,
    `steady idle CPU ${steadyPercent.toFixed(2)}% is under ${IDLE_CPU_LIMIT_PERCENT}% (all: ${usage.percent.toFixed(2)}%)`,
  );

  // 8. The pointer on the idle island: the greetings change and the logo blinks again.
  const idleShell = centreOf(await screenBox(app, island, ".dynamic-island-shell"));
  desktop.move(idleShell.x, idleShell.y);
  await until(
    async () => (await app.eval("island", "e2eGreetingChanges.length", decodeNumber)) > 0,
    "a greeting change with the pointer on the island",
  );
  await until(async () => (await app.eval("island", "e2eBlinks.length", decodeNumber)) > 0, "a blink");
  desktop.move(AWAY.x, AWAY.y);
  steps.push({ step: "the pointer on the idle island moves it again" });

  stats = await app.stats();
  assert.deepEqual(stats.unhandled, [], "the island renderer calls no missing IPC channel");
  assert.equal(stats.aboveAppsWindows, 1, "the app has one island window: one display");
  await app.quit();

  // A self-hosted or hosted server, and native Wayland windows on a Wayland desktop: the same app, with a
  // message, opens no island window.
  for (const mode of NO_WINDOW_MODES) {
    const other = islandApp(startHarness<Command>(session, bundle, mode));
    started = other;
    await other.ready;
    await other.publish(MESSAGE);
    // A window can open after the start. The app above has its window in much less time.
    await sleep(NO_WINDOW_WAIT_MS);
    const { aboveAppsWindows, x11 } = await other.stats();
    assert.equal(x11, mode !== "wayland", `${mode}: the app uses the expected windows`);
    assert.equal(aboveAppsWindows, 0, `${mode}: the app opens no island window`);
    assert.equal(
      await other.eval("main", "document.readyState === 'complete'", decodeBoolean),
      true,
      `${mode}: the app runs`,
    );
    steps.push({ step: `${mode}: no window`, detail: { windows: aboveAppsWindows } });
    await other.quit();
  }
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
  screenshot(session, "failure");
  stats = await started?.stats().catch(() => undefined);
  islandPage = await started
    ?.eval("island", "({ url: location.href, html: document.body.innerHTML.slice(0, 3000) })", decodePage)
    .catch((reason: unknown) => String(reason));
} finally {
  await closeSession(session);
  await writeFile(
    join(session.out, "report.json"),
    `${JSON.stringify({ passed, steps, cpu, stats, islandPage, error }, null, 2)}\n`,
  );
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(session.out, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}

interface App {
  ready: Promise<void>;
  island: () => Promise<IslandInfo>;
  stats: () => Promise<Stats>;
  publish: (presentation: DynamicIslandPresentation) => Promise<void>;
  /** Runs `js` in a window of the app and decodes its result. */
  eval: <A>(target: "island" | "main", js: string, decode: (value: unknown) => A) => Promise<A>;
  quit: () => Promise<void>;
}

type Command =
  | { op: "island" }
  | { op: "stats" }
  | { op: "publish"; presentation: DynamicIslandPresentation }
  | { op: "eval"; target: "island" | "main"; js: string };

function islandApp(harness: Harness<Command>): App {
  return {
    ready: harness.ready,
    island: () => harness.send({ op: "island" }, decodeIsland),
    stats: () => harness.send({ op: "stats" }, decodeStats),
    publish: (presentation) => harness.send({ op: "publish", presentation }, () => undefined),
    eval: (target, js, decode) => harness.send({ op: "eval", target, js }, decode),
    quit: harness.quit,
  };
}

/** Moves the pointer onto the island shell and waits for the expanded island. */
async function hoverOpen(app: App, desktop: Desktop, island: IslandInfo): Promise<void> {
  const shell = centreOf(await screenBox(app, island, ".dynamic-island-shell"));
  desktop.move(shell.x, shell.y);
  await until(async () => await app.eval("island", EXPANDED, decodeBoolean), "the expanded island");
  await settle(app);
}

/** Moves the pointer away and waits for the shut island and its compact shape. */
async function leave(app: App, desktop: Desktop): Promise<void> {
  desktop.move(AWAY.x, AWAY.y);
  await until(async () => !(await app.eval("island", EXPANDED, decodeBoolean)), "the shut island");
  await until(async () => {
    const last = (await app.stats()).interactive.at(-1);
    return last !== undefined && !last.interactive;
  }, "the island lets the pointer go");
  await sleep(1_000);
}

/** The renderer applies the last change, its motion ends, and it draws a frame. */
async function settle(app: App): Promise<void> {
  await app.eval("island", TWO_FRAMES, () => undefined);
  await until(async () => await app.eval("island", MOTION_DONE, decodeBoolean), "the end of the island motion");
  await app.eval("island", TWO_FRAMES, () => undefined);
}

/** A script that gives the box of the first button whose text is `text`. */
function buttonByText(text: string): string {
  return `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === ${JSON.stringify(text)})`;
}

function screenBox(app: App, island: IslandInfo, selector: string): Promise<Rect> {
  return screenBoxOf(app, island, `document.querySelector(${JSON.stringify(selector)})`, selector);
}

/** The screen box of the element that `find` gives in the island window. */
async function screenBoxOf(app: App, island: IslandInfo, find: string, what: string): Promise<Rect> {
  const box = await app.eval(
    "island",
    `(() => { const r = (${find})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`,
    decodeBox,
  );
  assert.ok(box, `the island shows ${what}`);
  return { x: island.bounds.x + box.x, y: island.bounds.y + box.y, width: box.width, height: box.height };
}

function centreOf(box: Rect): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function latestRegion(current: Stats): readonly Rect[] {
  const last = current.regions.at(-1);
  assert.ok(last, "the island sent a shape");
  return last.rects;
}
