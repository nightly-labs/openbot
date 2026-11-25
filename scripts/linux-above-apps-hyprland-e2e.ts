import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Schema } from "effect";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";
import { once, until } from "./linux-above-apps-e2e";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "linux-above-apps-hyprland");
const SIGNATURE = "e2e_hyprland";
const DISPLAY = ":97";
const OVERLAY = "abc123";
const MAIN_WINDOW = "cafe01";
const OTHER_APP = "beef02";

const decodeShown = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, width: Schema.Number, height: Schema.Number })),
);
const decodeRecord = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      role: Schema.Literals(["parent", "child"]),
      restarted: Schema.optional(Schema.Boolean),
      reason: Schema.optional(Schema.String),
      platform: Schema.String,
      argv: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
);
type RestartRecord = typeof decodeRecord extends (input: unknown) => infer A ? A : never;

function electronPath(): string {
  return join(
    ROOT,
    "node_modules",
    "electron",
    "dist",
    readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
  );
}

function buildHarness(): string {
  const bundle = join(OUT, "harness.cjs");
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "linux-above-apps-hyprland-harness.ts"),
    "--target=node",
    "--format=cjs",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);
  return bundle;
}

function readRecords(file: string): RestartRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => decodeRecord(line));
}

async function restartScenario(
  bundle: string,
  environment: NodeJS.ProcessEnv,
  name: string,
  markers: readonly string[],
): Promise<RestartRecord[]> {
  const userData = join(OUT, `user-data-${name}`);
  await mkdir(userData, { recursive: true });
  for (const marker of markers) await writeFile(join(userData, marker), "");
  const report = join(OUT, `restart-${name}.jsonl`);
  const parent = spawn(
    electronPath(),
    [bundle, `--user-data-dir=${userData}`, "--no-sandbox", "--ozone-platform=wayland"],
    {
      env: { ...environment, OPENBOT_E2E_SCENARIO: "restart", OPENBOT_E2E_REPORT: report },
      stdio: "ignore",
    },
  );
  await once(parent);
  const parentRecord = await until(() => readRecords(report)[0], `the ${name} start`);
  if (parentRecord.restarted) await until(() => readRecords(report).length >= 2 && true, `the ${name} restart`);
  return readRecords(report);
}

interface FakeHyprland {
  requests: string[];
  events: Socket[];
  clients: unknown[];
  refuse: Set<string>;
  close: () => Promise<void>;
}

async function startFakeHyprland(directory: string): Promise<FakeHyprland> {
  await mkdir(directory, { recursive: true });
  const fake: FakeHyprland = { requests: [], events: [], clients: [], refuse: new Set(), close: async () => {} };
  const commands = createServer((socket) => {
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk.toString("utf8");
    });
    socket.on("end", () => {
      fake.requests.push(text);
      if (text === "j/clients") socket.end(JSON.stringify(fake.clients));
      else socket.end(fake.refuse.has(text) ? "error: refused by the test" : "ok");
    });
  });
  const events = createServer((socket) => {
    fake.events.push(socket);
    socket.on("error", () => undefined);
  });
  const listen = (server: Server, path: string) => new Promise<void>((done) => server.listen(path, () => done()));
  await listen(commands, join(directory, ".socket.sock"));
  await listen(events, join(directory, ".socket2.sock"));
  fake.close = async () => {
    for (const socket of fake.events) socket.destroy();
    await new Promise((done) => commands.close(done));
    await new Promise((done) => events.close(done));
  };
  return fake;
}

function client(address: string, pid: number, size: readonly [number, number], pinned: boolean) {
  return { address: `0x${address}`, pid, xwayland: true, pinned, size, at: [100, 100], class: "openbot" };
}

async function main(): Promise<void> {
  if (process.platform !== "linux") {
    process.stdout.write("SKIP: Linux only\n");
    return;
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "openbot-hyprland-e2e-"));
  const children: ChildProcess[] = [];
  const environment: NodeJS.ProcessEnv = { ...withoutElectronRuntimeFlags(process.env), DISPLAY };
  delete environment.WAYLAND_DISPLAY;
  delete environment.HYPRLAND_INSTANCE_SIGNATURE;
  let fake: FakeHyprland | undefined;
  try {
    const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
    children.push(xvfb);
    await until(() => existsSync(`/tmp/.X11-unix/X${DISPLAY.slice(1)}`), "the X server");
    const bundle = buildHarness();

    const launcherOnly = await restartScenario(bundle, environment, "launcher-only", ["agent-dock-xwayland"]);
    assert.deepEqual(
      launcherOnly.map((record) => [record.role, record.restarted]),
      [["parent", false]],
      "an old marker alone keeps the launcher's Wayland choice",
    );
    const afterRestartClick = await restartScenario(bundle, environment, "restart-click", [
      "agent-dock-xwayland",
      "above-apps-xwayland-over-launcher",
    ]);
    const [parent, child] = afterRestartClick;
    assert.equal(parent?.restarted, true, "the Restart choice starts OpenBot again on XWayland");
    assert.equal(child?.reason, "above-apps");
    assert.equal(child?.platform, "x11", "the new start runs on XWayland");
    assert.equal(
      child?.argv?.filter((argument) => argument.startsWith("--ozone-platform=")).join(" "),
      "--ozone-platform=wayland",
      "a later relaunch keeps the launcher option",
    );

    const runtime = join(root, "runtime");
    fake = await startFakeHyprland(join(runtime, "hypr", SIGNATURE));
    const harness = spawn(
      electronPath(),
      [bundle, `--user-data-dir=${join(OUT, "user-data-overlay")}`, "--no-sandbox", "--ozone-platform=x11"],
      {
        env: { ...environment, HYPRLAND_INSTANCE_SIGNATURE: SIGNATURE, XDG_RUNTIME_DIR: runtime },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    children.push(harness);
    let log = "";
    harness.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString("utf8");
    });
    const output = harness.stdout;
    assert.ok(output, "the harness has a stdout pipe");
    const shownLine = new Promise<string>((done) =>
      createInterface({ input: output }).on("line", (line) => {
        if (line.startsWith("@@shown ")) done(line.slice(8));
      }),
    );
    const shown = decodeShown(await shownLine);
    const events = await until(() => fake?.events[0], "the Hyprland event connection");
    const overlaySize = [shown.width, shown.height] as const;
    fake.clients = [
      client(OVERLAY, shown.pid, overlaySize, false),
      client(MAIN_WINDOW, shown.pid, [1000, 700], false),
      client(OTHER_APP, shown.pid + 1, overlaySize, false),
    ];
    events.write(`openwindow>>${OTHER_APP},1,other,Other\nopenwindow>>${MAIN_WINDOW},1,openbot,OpenBot\n`);
    await until(() => fake?.requests.filter((request) => request === "j/clients").length === 2, "two client reads");
    events.write(`openwindow>>${OVERLAY},1,openbot,OpenBot\n`);
    const firstShow = [
      `dispatch pin address:0x${OVERLAY}`,
      `dispatch setprop address:0x${OVERLAY} no_blur 1`,
      `dispatch setprop address:0x${OVERLAY} no_shadow 1`,
    ];
    await until(
      () => fake?.requests.filter((request) => request.startsWith("dispatch")).length === 3,
      "three commands",
    );
    assert.deepEqual(
      fake.requests.filter((request) => request.startsWith("dispatch")),
      firstShow,
      "only the overlay window is pinned, without blur and shadow",
    );

    fake.clients = [client(OVERLAY, shown.pid, overlaySize, true)];
    fake.refuse.add(`dispatch setprop address:0x${OVERLAY} no_shadow 1`);
    events.write(`openwindow>>${OVERLAY},1,openbot,OpenBot\n`);
    await until(
      () => fake?.requests.filter((request) => request.startsWith("dispatch")).length === 5,
      "two more commands",
    );
    const secondShow = fake.requests.filter((request) => request.startsWith("dispatch")).slice(3);
    assert.deepEqual(
      secondShow,
      [`dispatch setprop address:0x${OVERLAY} no_blur 1`, `dispatch setprop address:0x${OVERLAY} no_shadow 1`],
      "a pinned window is not unpinned",
    );
    await until(() => log.includes("Hyprland refused"), "the refused command in the log");
    assert.equal(harness.exitCode, null, "a refused command does not stop OpenBot");

    harness.stdin?.end();
    assert.equal(await once(harness), 0);
    await until(() => fake?.events[0]?.destroyed || fake?.events[0]?.readableEnded, "the event connection to close");

    const report = { launcherOnly, afterRestartClick, requests: fake.requests, passed: true };
    await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`PASS: ${join(OUT, "report.json")}\n`);
  } finally {
    await fake?.close();
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child);
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

await main();
