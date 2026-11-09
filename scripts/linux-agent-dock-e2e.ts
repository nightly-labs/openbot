// Runs the real agent dock on a Linux X11 desktop (#5935) and drives it with the real pointer and keyboard:
// 1. The dock is a DOCK window at the right edge of the screen, above other windows and on all workspaces.
// 2. A click outside the shape of the dock goes to the window under it.
// 3. The pointer on a seat hovers it, and a click on the seat opens the chat.
// 4. Text typed in the chat composer is sent with Return.
// 5. A drag of the handle moves the dock.
// 6. A switch to another workspace keeps the dock on the screen.
// 7. An idle dock uses almost no CPU and does not send a new input region.
//
// Build the app first (`bun run build`), then run on Linux: bun scripts/linux-agent-dock-e2e.ts
// `scripts/linux-above-apps-e2e.ts` starts the desktop and records the video (see there).
// It writes .openbot-build/linux-agent-dock-e2e/<desktop>/report.json, screenshots and video.mp4.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Schema } from "effect";
import {
  buildHarness,
  checkOtherWorkspace,
  closeSession,
  cpuOf,
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
  SCALE,
  SCREEN,
  screenshot,
  startDesktopAndRecorder,
  startHarness,
  TWO_FRAMES,
  until,
  windowManagerProperties,
} from "./linux-above-apps-e2e";

const IDLE_SECONDS = 10;
/** One percent of one core. The idle dock must stay under it. */
const IDLE_CPU_LIMIT_PERCENT = 1;

const DockInfoSchema = Schema.Struct({
  bounds: RectSchema,
  xid: Schema.Number,
  visible: Schema.Boolean,
  allWorkspaces: Schema.Boolean,
  mainPid: Schema.Number,
});
type DockInfo = typeof DockInfoSchema.Type;
const StatsSchema = Schema.Struct({
  sent: Schema.Array(Schema.String),
  regions: Schema.Array(Schema.Struct({ at: Schema.Number, rects: Schema.Array(RectSchema) })),
  rendererErrors: Schema.Array(Schema.String),
  unhandled: Schema.Array(Schema.String),
  x11: Schema.Boolean,
  aboveAppsWindows: Schema.Number,
});
type Stats = typeof StatsSchema.Type;
const decodeDock = Schema.decodeUnknownSync(DockInfoSchema);
const decodeStats = Schema.decodeUnknownSync(StatsSchema);

const steps: { step: string; detail?: unknown }[] = [];
const session = await openSession("linux-agent-dock-e2e");
let passed = false;
let error: string | undefined;
let stats: Stats | undefined;
let cpu: Awaited<ReturnType<typeof cpuOf>> | undefined;
let started: App | undefined;
let dockPage: { url: string; html: string } | string | undefined;

try {
  const bundle = buildHarness("linux-agent-dock-electron.ts", "linux-agent-dock-e2e");
  const desktop = await startDesktopAndRecorder(session);

  const app = dockApp(startHarness<Command>(session, bundle));
  started = app;
  await app.ready;
  await until(
    async () =>
      (await app.eval(
        "dock",
        "document.querySelectorAll('.agent-dock-seat-button:not(.agent-dock-add)').length",
        decodeNumber,
      )) === 3,
    "three seats",
  );
  let dock = await app.dock();
  await until(async () => (await app.stats()).regions.length > 0, "the first input region");
  await settle(app);

  // 1. Placement.
  const properties = await windowManagerProperties(session, dock.xid);
  assert.equal(dock.bounds.x + dock.bounds.width, SCREEN.width / SCALE, "the dock touches the right edge");
  assert.equal(dock.visible, true);
  steps.push({ step: "placement", detail: { bounds: dock.bounds, properties: properties.trim().split("\n") } });
  screenshot(session, "01-placement");

  // 2. Click-through: a point of the dock window outside its shape. A first click away from the dock
  // shows that the pointer of the test reaches the window under it.
  await firstClick(desktop, fromPixels(300, 600), () => app.eval("main", "clicks.length", decodeNumber));
  const region = latestRegion(await app.stats());
  const outside = pointOutside(dock.bounds, region);
  const clicksBefore = await app.eval("main", "clicks.length", decodeNumber);
  desktop.move(outside.x, outside.y);
  desktop.click();
  await until(
    async () => (await app.eval("main", "clicks.length", decodeNumber)) > clicksBefore,
    "the click under the dock",
  );
  assert.equal(
    await app.eval("dock", "document.querySelector('.agent-dock-panel[data-open]') === null", decodeBoolean),
    true,
  );
  steps.push({ step: "click-through", detail: { point: outside, region } });

  // 3. Hover and click a seat.
  const seat = await screenPoint(app, ".agent-dock-seat-button");
  desktop.move(seat.x, seat.y);
  await until(
    async () =>
      (await app.eval("dock", "document.querySelector('.agent-dock-seat-button:hover') !== null", decodeBoolean)) ===
      true,
    "the hovered seat",
  );
  await settle(app);
  screenshot(session, "02-hover");
  steps.push({ step: "hover", detail: seat });
  desktop.click();
  await until(
    async () =>
      (await app.eval("dock", "document.querySelector('.agent-dock-panel[data-open]') !== null", decodeBoolean)) ===
      true,
    "the open chat",
  );
  await settle(app);
  screenshot(session, "03-chat");
  steps.push({ step: "click opens the chat" });

  // 4. Typing.
  const composer = ".agent-dock-panel [contenteditable='true'], .agent-dock-panel textarea";
  const field = await screenPoint(app, composer);
  desktop.move(field.x, field.y);
  desktop.click();
  await until(
    async () =>
      (await app.eval(
        "dock",
        `document.activeElement?.matches(${JSON.stringify(composer)}) === true`,
        decodeBoolean,
      )) === true,
    "the focused composer",
  );
  await desktop.type("Hello from Linux");
  await settle(app);
  screenshot(session, "04-typed");
  desktop.key("Return");
  await until(async () => (await app.stats()).sent.includes("Hello from Linux"), "the sent message");
  steps.push({ step: "typing sends the message" });
  desktop.key("Escape");
  await until(
    async () =>
      (await app.eval("dock", "document.querySelector('.agent-dock-panel[data-open]') === null", decodeBoolean)) ===
      true,
    "the closed chat",
  );

  // 5. Drag the handle 150 DIP to the side with more room. The dock stays on the screen: it moves as far
  // as the room lets it. A dock as tall as the screen (a small screen in DIP) has no room.
  const startY = dock.bounds.y;
  const roomAbove = startY;
  const roomBelow = SCREEN.height / SCALE - (startY + dock.bounds.height);
  const direction = roomAbove >= roomBelow ? -1 : 1;
  const expected = Math.min(100, Math.max(roomAbove, roomBelow));
  if (expected < 20) {
    steps.push({ step: "drag: no room on this screen", detail: { roomAbove, roomBelow } });
  } else {
    const handle = await screenPoint(app, ".agent-dock-handle-hit");
    desktop.move(handle.x, handle.y);
    await settle(app);
    desktop.button(true);
    for (let step = 1; step <= 10; step += 1) {
      desktop.move(handle.x, handle.y + direction * step * 15);
      await sleep(30);
    }
    desktop.button(false);
    dock = await until(async () => {
      const next = await app.dock();
      return (next.bounds.y - startY) * direction >= expected - 1 ? next : undefined;
    }, "the dragged dock");
    await settle(app);
    screenshot(session, "05-dragged");
    steps.push({ step: "drag moves the dock", detail: { from: startY, to: dock.bounds.y } });
  }

  // 6. Another workspace.
  await checkOtherWorkspace(session, desktop, dock.xid, "06-workspace-2");
  steps.push({ step: "all workspaces" });

  // 7. Idle CPU, with the pointer away from the dock.
  const away = fromPixels(200, 500);
  desktop.move(away.x, away.y);
  await sleep(2_000);
  const regionsBefore = (await app.stats()).regions.length;
  const usage = await cpuOf(dock.mainPid, IDLE_SECONDS);
  const regionsAfter = (await app.stats()).regions.length;
  cpu = usage;
  assert.equal(regionsAfter, regionsBefore, "an idle dock sends no input region");
  assert.ok(
    usage.percent < IDLE_CPU_LIMIT_PERCENT,
    `idle CPU ${usage.percent.toFixed(2)}% is under ${IDLE_CPU_LIMIT_PERCENT}%`,
  );
  steps.push({ step: "idle CPU", detail: usage });

  stats = await app.stats();
  assert.deepEqual(stats.unhandled, [], "the dock renderer calls no missing IPC channel");
  assert.equal(stats.aboveAppsWindows, 1, "the app has one dock window: one display");
  await app.quit();

  // 8. A self-hosted or hosted server, and native Wayland windows on a Wayland desktop: the same app, with
  // the same presentation, opens no dock window.
  for (const mode of NO_WINDOW_MODES) {
    const other = dockApp(startHarness<Command>(session, bundle, mode));
    started = other;
    await other.ready;
    // A window can open after the start. The app above has its window in much less time.
    await sleep(NO_WINDOW_WAIT_MS);
    const { aboveAppsWindows, x11 } = await other.stats();
    assert.equal(x11, mode !== "wayland", `${mode}: the app uses the expected windows`);
    assert.equal(aboveAppsWindows, 0, `${mode}: the app opens no dock window`);
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
  dockPage = await started
    ?.eval("dock", "({ url: location.href, html: document.body.innerHTML.slice(0, 2000) })", decodePage)
    .catch((reason: unknown) => String(reason));
} finally {
  await closeSession(session);
  await writeFile(
    join(session.out, "report.json"),
    `${JSON.stringify({ passed, steps, cpu, stats, dockPage, error }, null, 2)}\n`,
  );
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(session.out, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}

interface App {
  ready: Promise<void>;
  dock: () => Promise<DockInfo>;
  stats: () => Promise<Stats>;
  /** Runs `js` in a window of the app and decodes its result. */
  eval: <A>(target: "dock" | "main", js: string, decode: (value: unknown) => A) => Promise<A>;
  quit: () => Promise<void>;
}

type Command = { op: "dock" } | { op: "stats" } | { op: "eval"; target: "dock" | "main"; js: string };

function dockApp(harness: Harness<Command>): App {
  return {
    ready: harness.ready,
    dock: () => harness.send({ op: "dock" }, decodeDock),
    stats: () => harness.send({ op: "stats" }, decodeStats),
    eval: (target, js, decode) => harness.send({ op: "eval", target, js }, decode),
    quit: harness.quit,
  };
}

/** The renderer applies the last change, its motion ends, and it draws a frame. */
async function settle(app: App): Promise<void> {
  await app.eval("dock", TWO_FRAMES, () => undefined);
  await until(async () => await app.eval("dock", MOTION_DONE, decodeBoolean), "the end of the dock motion");
  await app.eval("dock", TWO_FRAMES, () => undefined);
}

/** The screen centre of the first element that matches `selector` in the dock window. */
async function screenPoint(app: App, selector: string): Promise<{ x: number; y: number }> {
  const current = await app.dock();
  const box = await app.eval(
    "dock",
    `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`,
    decodeBox,
  );
  assert.ok(box, `the dock shows ${selector}`);
  return { x: current.bounds.x + box.x + box.width / 2, y: current.bounds.y + box.y + box.height / 2 };
}

function latestRegion(current: Stats): readonly Rect[] {
  const last = current.regions.at(-1);
  assert.ok(last, "the dock sent an input region");
  return last.rects;
}
