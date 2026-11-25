import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { CuaDriverActionTap } from "../src/main/cua-driver-action-tap";
import { parseAnswerLine } from "../src/main/cua-driver-structured-text";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/cua-driver-foreground-input-e2e");
const DRIVER =
  process.env.OPENBOT_CUA_DRIVER_PATH ?? join(ROOT, "build/cua-driver", process.platform, process.arch, "cua-driver");
const ELECTRON = join(ROOT, "node_modules/electron/dist/electron");
const WINDOW_MANAGER = join(ROOT, "scripts/cua-driver-foreground-input-e2e-wm.py");
const WINDOW_TITLE = "OpenBot foreground input e2e";
const DEADLINE_MS = 20_000;

const PROBE_MAIN = `
const { app, BrowserWindow } = require("electron");
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 640, height: 360, x: 0, y: 0, title: ${JSON.stringify(WINDOW_TITLE)} });
  window.on("page-title-updated", (event) => event.preventDefault());
  await window.loadURL("data:text/html,<div id=field contenteditable=true style='width:600px;height:300px'></div><script>field.focus()</script>");
  window.focus();
  setInterval(async () => {
    const text = await window.webContents.executeJavaScript("field.textContent");
    process.stdout.write("TEXT " + JSON.stringify(text) + "\\n");
  }, 200);
});
`;

interface Report {
  display: string;
  driver: string;
  hiddenTools: string[];
  deliveryModeTools: string[];
  calls: {
    name: string;
    sent: DynamicRecord;
    mode: unknown;
    path: unknown;
    ok: unknown;
    typed: string;
    answer: string;
  }[];
  masterDevices: string[];
  passed: boolean;
}

function waitFor<T>(read: () => T | null, what: string): Promise<T> {
  return new Promise((done, fail) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const value = read();
      if (value !== null) {
        clearInterval(timer);
        done(value);
      } else if (Date.now() - started > DEADLINE_MS) {
        clearInterval(timer);
        fail(new Error(`Timed out waiting for ${what}.`));
      }
    }, 50);
  });
}

class LineClient {
  readonly #socket: Socket;
  #buffer = "";
  readonly #lines: string[] = [];

  constructor(path: string) {
    this.#socket = connect(path);
    this.#socket.on("data", (chunk) => {
      this.#buffer += chunk.toString("utf8");
      let newline = this.#buffer.indexOf("\n");
      while (newline >= 0) {
        this.#lines.push(this.#buffer.slice(0, newline));
        this.#buffer = this.#buffer.slice(newline + 1);
        newline = this.#buffer.indexOf("\n");
      }
    });
  }

  async request(body: DynamicRecord): Promise<DynamicRecord> {
    this.#socket.write(`${JSON.stringify(body)}\n`);
    const line = await waitFor(() => this.#lines.shift() ?? null, `an answer to ${JSON.stringify(body).slice(0, 80)}`);
    const parsed = parseAnswerLine(line);
    assert.ok(parsed, "The driver answer is not an object.");
    return parsed;
  }

  close(): void {
    this.#socket.destroy();
  }
}

function onLines(stream: Readable | null, read: (line: string) => void): void {
  let buffer = "";
  stream?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      read(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });
}

async function startXvfb(children: ChildProcess[]): Promise<string> {
  const xvfb = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", "1280x800x24", "-nolisten", "tcp"], {
    stdio: ["ignore", "ignore", "ignore", "pipe"],
  });
  children.push(xvfb);
  let display: string | null = null;
  let exited = false;
  xvfb.once("exit", () => {
    exited = true;
  });
  const displayPipe = xvfb.stdio[3];
  onLines(displayPipe instanceof Readable ? displayPipe : null, (line) => {
    display = `:${line.trim()}`;
  });
  const started = await waitFor(() => (exited ? "exited" : display), "Xvfb");
  assert.notEqual(started, "exited", "Xvfb exited before it chose a display.");
  return started;
}

function structured(answer: DynamicRecord): DynamicRecord {
  const result = isDynamicRecord(answer.result) ? answer.result : {};
  return isDynamicRecord(result.structuredContent) ? result.structuredContent : {};
}

function deliveryOf(answer: DynamicRecord): { mode: unknown; path: unknown } {
  const content = structured(answer);
  const delivery = isDynamicRecord(content.delivery) ? content.delivery : {};
  return { mode: delivery.mode ?? content.delivery_mode ?? null, path: delivery.path ?? content.path ?? null };
}

async function main(): Promise<void> {
  assert.equal(process.platform, "linux", "This check runs on Linux only.");
  assert.ok(existsSync(DRIVER), `Install the driver first with bun run prepare:cua-driver (${DRIVER}).`);
  mkdirSync(OUT, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "openbot-foreground-e2e-"));
  const children: ChildProcess[] = [];
  const tap = new CuaDriverActionTap(Date.now, undefined, null, true);
  const report: Report = {
    display: "",
    driver: DRIVER,
    hiddenTools: [],
    deliveryModeTools: [],
    calls: [],
    masterDevices: [],
    passed: false,
  };
  let client: LineClient | null = null;
  try {
    const display = await startXvfb(children);
    report.display = display;
    const { WAYLAND_DISPLAY: _wayland, ELECTRON_RUN_AS_NODE: _electronAsNode, ...inherited } = process.env;
    const env = { ...inherited, DISPLAY: display, CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" };
    const windowManager = spawn("python3", ["-I", WINDOW_MANAGER], { env, stdio: ["ignore", "pipe", "ignore"] });
    children.push(windowManager);
    let managerReady = false;
    onLines(windowManager.stdout, (line) => {
      if (line === "ready") managerReady = true;
    });
    await waitFor(() => (managerReady ? true : null), "the window manager stand-in");

    writeFileSync(join(work, "package.json"), JSON.stringify({ name: "foreground-probe", main: "main.js" }));
    writeFileSync(join(work, "main.js"), PROBE_MAIN);
    const probe = spawn(ELECTRON, ["--no-sandbox", "--ozone-platform=x11", work], {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    children.push(probe);
    let typed = "";
    onLines(probe.stdout, (line) => {
      if (line.startsWith("TEXT ")) typed = JSON.parse(line.slice(5));
    });

    const driverSocket = join(work, "driver.sock");
    const tapSocket = join(work, "tap.sock");
    children.push(spawn(DRIVER, ["serve", "--socket", driverSocket, "--no-overlay"], { env, stdio: "ignore" }));
    await waitFor(() => (existsSync(driverSocket) ? true : null), "the driver socket");
    await Effect.runPromise(tap.listen({ upstream: driverSocket, tap: tapSocket }));
    client = new LineClient(tapSocket);

    const listed = await client.request({ method: "list" });
    const tools = isDynamicRecord(listed.result) && Array.isArray(listed.result.tools) ? listed.result.tools : [];
    const names = tools.flatMap((tool) => (isDynamicRecord(tool) && typeof tool.name === "string" ? [tool.name] : []));
    report.hiddenTools = ["parallel_mouse_drag", "set_agent_cursor_enabled"].filter((name) => !names.includes(name));
    report.deliveryModeTools = tools.flatMap((tool) =>
      isDynamicRecord(tool) &&
      typeof tool.name === "string" &&
      isDynamicRecord(tool.input_schema) &&
      isDynamicRecord(tool.input_schema.properties) &&
      tool.input_schema.properties.delivery_mode !== undefined
        ? [tool.name]
        : [],
    );
    assert.ok(!names.includes("parallel_mouse_drag"), "parallel_mouse_drag stays hidden in foreground mode.");
    assert.ok(report.deliveryModeTools.includes("type_text"), "type_text advertises delivery_mode.");

    const windows = await client.request({ method: "call", name: "list_windows", args: {} });
    const listedWindows = structured(windows).windows;
    const window = (Array.isArray(listedWindows) ? listedWindows : []).find(
      (entry) => isDynamicRecord(entry) && entry.title === WINDOW_TITLE,
    );
    assert.ok(isDynamicRecord(window), `The probe window is listed: ${JSON.stringify(windows).slice(0, 400)}`);
    const pid = window.pid;
    const windowId = window.window_id ?? window.id;

    const calls: { name: string; args: DynamicRecord; expect: string }[] = [
      { name: "type_text", args: { pid, window_id: windowId, text: "abc" }, expect: "abc" },
      {
        name: "run_steps",
        args: {
          pid,
          window_id: windowId,
          steps: [{ tool: "type_text", args: { text: "de", delivery_mode: "background" } }],
        },
        expect: "abcde",
      },
      {
        name: "run_steps",
        args: { pid, window_id: windowId, steps: [{ tool: "type_text", args: { text: "f" } }] },
        expect: "abcdef",
      },
    ];
    for (const call of calls) {
      const answer = await client.request({ method: "call", name: call.name, args: call.args });
      const delivery = deliveryOf(answer);
      const arrived = await waitFor(() => (typed === call.expect ? typed : null), `the text ${call.expect}`).catch(
        () => typed,
      );
      report.calls.push({
        name: call.name,
        sent: call.args,
        ...delivery,
        ok: answer.ok,
        typed: arrived,
        answer: JSON.stringify(answer.result).slice(0, 1500),
      });
      assert.equal(
        arrived,
        call.expect,
        `${call.name} typed into the Electron window: ${JSON.stringify(answer).slice(0, 600)}`,
      );
    }
    report.masterDevices = execFileSync("python3", ["-I", WINDOW_MANAGER, "masters"], { env, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    assert.ok(!report.masterDevices.some((name) => name.startsWith("CUA")), "The driver added no extra master device.");
    report.passed = true;
  } finally {
    writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    client?.close();
    await Effect.runPromise(tap.close());
    for (const child of children.reverse()) child.kill();
    await rm(work, { recursive: true, force: true });
  }
}

await main();
process.stdout.write(`Wrote ${join(OUT, "report.json")}\n`);
