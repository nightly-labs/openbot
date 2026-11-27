import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import QRCode from "qrcode";
import { z } from "zod";

const NAME = "openbot-cli-control-replies-e2e";
const ROOT = resolve(import.meta.dirname, "..", "..");
const OUT = join(ROOT, ".openbot-build", NAME);
const HOSTING = join(ROOT, "scripts", "hosting");
const DEADLINE_MS = 30_000;
const ESC = "\u001b";
const BEL = "\u0007";
const CSI_C1 = "\u009b";
const OSC_C1 = "\u009d";
const QR_COLORS = new RegExp(`${ESC}\\[(0|3[07]|4[07])m`, "gu");
const NAMESPACE_FLAG = "--in-namespace";
const ROOT_CASES_START = "openbot-cli-root-cases:";
const logger = createOpenBotLogger(NAME);

function copyWithLines(source: string, target: string, swaps: Record<string, string>) {
  const lines = readFileSync(join(HOSTING, source), "utf8").split("\n");
  for (const line of Object.keys(swaps)) {
    assert.equal(lines.filter((entry) => entry === line).length, 1, `${source} does not have the line ${line}.`);
  }
  writeFileSync(target, lines.map((entry) => swaps[entry] ?? entry).join("\n"));
  chmodSync(target, 0o755);
}

const rootExpectationSchema = z.object({
  name: z.string(),
  exitCode: z.number(),
  stdout: z.array(z.string()),
  stderr: z.array(z.string()),
  absent: z.array(z.string()),
});
const rootResultSchema = rootExpectationSchema.extend({
  actual: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number(), commandRan: z.boolean() }),
});
type RootExpectation = z.infer<typeof rootExpectationSchema>;
type RootResult = z.infer<typeof rootResultSchema>;

const STATUS_BODY = [
  "const body = (name, payload) => ['version=0.62.0', 'account=signed_out', 'server=online', 'server_name=' + name,",
  "  'memory_level=ok', 'memory_limit=' + (payload || '2147483648'), 'memory_available=1073741824', 'turn_limit=4', '']",
  "  .join(String.fromCharCode(10));",
];
const FAKE_APP = [
  ...STATUS_BODY,
  "const [socket, name, payload] = process.argv.slice(2);",
  "require('node:fs').rmSync(socket, { force: true });",
  "Bun.serve({ unix: socket, fetch: () => new Response(body(name, payload)) });",
  "console.log('ready');",
].join("\n");
const INHERITING_APP = [
  ...STATUS_BODY,
  "const text = body(process.argv[2]);",
  "const reply = ['HTTP/1.1 200 OK', 'connection: close', 'content-length: ' + Buffer.byteLength(text), '', text]",
  "  .join(String.fromCharCode(13, 10));",
  "const server = require('node:net').createServer((socket) => {",
  "  socket.on('error', () => {});",
  "  socket.once('data', () => socket.end(reply));",
  "});",
  "server.listen({ fd: 3 }, () => {",
  "  const binary = process.argv[3] || process.execPath;",
  "  const child = Bun.spawn([binary, '-e', 'setInterval(() => {}, 1 << 30)'], { stdio: ['ignore', 'ignore', 'ignore', 3] });",
  "  console.log('ready ' + child.pid);",
  "});",
].join("\n");
const IDLE_APP = "console.log('ready'); setInterval(() => {}, 1 << 30);";
const FAKE_SYSTEMCTL = [
  "#!/bin/bash",
  "case $1 in",
  '  show) awk -F: \'($1 == "0" && $2 == "") || $2 == "name=systemd" { print $3; exit }\' /proc/self/cgroup ;;',
  "  *) exit 0 ;;",
  "esac",
  "",
].join("\n");

async function runRootCasesInNamespace(): Promise<RootResult[]> {
  const base = mkdtempSync(join(tmpdir(), "openbot-cli-root-"));
  const runtime = join(base, "run");
  const socket = join(runtime, "openbot", "control.sock");
  const install = join(base, "install");
  const app = join(install, "app", "openbot");
  const mode = join(install, "hosted", "mode");
  const bin = join(base, "bin");
  const cli = join(base, "openbot");
  const marker = join(base, "command-ran");
  const fakeApp = join(base, "fake-app.js");
  const inheritingApp = join(base, "inheriting-app.js");
  mkdirSync(join(runtime, "openbot"), { recursive: true, mode: 0o700 });
  mkdirSync(join(install, "app"), { recursive: true });
  mkdirSync(join(install, "hosted"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "systemctl"), FAKE_SYSTEMCTL, { mode: 0o755 });
  copyFileSync(process.execPath, app);
  chmodSync(app, 0o755);
  writeFileSync(fakeApp, FAKE_APP);
  writeFileSync(inheritingApp, INHERITING_APP);
  copyWithLines("openbot", cli, { "SOCKET=/run/openbot/control.sock": `SOCKET=${socket}` });
  copyWithLines("openbot-hosted-update", join(base, "openbot-hosted-update"), {
    "INSTALL=/opt/OpenBot": `INSTALL=${install}`,
  });
  const path = `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`;
  const children: { kill(signal: NodeJS.Signals): void }[] = [];
  const firstLine = async (stream: ReadableStream<Uint8Array>) => {
    const { value } = await stream.getReader().read();
    return new TextDecoder().decode(value);
  };
  const start = async (binary: string, args: string[]) => {
    const child = Bun.spawn([binary, ...args], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
    children.push(child);
    assert.match(await firstLine(child.stdout), /ready/u, `${binary} ${args.join(" ")} did not start.`);
    return child;
  };
  const stop = async (child: { kill(signal: NodeJS.Signals): void; exited: Promise<number> }) => {
    child.kill("SIGKILL");
    await child.exited;
  };
  const results: RootResult[] = [];
  const check = async (expected: RootExpectation) => {
    rmSync(marker, { force: true });
    const child = Bun.spawn(["bash", cli, "status"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: path, HOME: base },
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), DEADLINE_MS);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    clearTimeout(timer);
    results.push({ ...expected, actual: { stdout, stderr, exitCode, commandRan: existsSync(marker) } });
  };
  const injection = `UNIT[$(touch ${marker})]`;
  const refused = "A program that is not OpenBot holds the control socket, so this command stops.";
  try {
    const real = await start(app, [fakeApp, socket, "Real server"]);
    await check({
      name: "root: the oldest OpenBot process of the service holds the socket",
      exitCode: 0,
      stdout: ["Server: Real server (online)", "Memory: 1024 MiB free of 2048 MiB (ok)"],
      stderr: [],
      absent: [],
    });
    const helper = await start(app, ["-e", IDLE_APP]);
    await check({
      name: "root: a younger OpenBot process that does not listen changes nothing",
      exitCode: 0,
      stdout: ["Server: Real server (online)"],
      stderr: [],
      absent: [],
    });
    const younger = await start(app, [fakeApp, socket, "Fake server", injection]);
    await check({
      name: "root: a younger OpenBot process that replaced the socket is refused",
      exitCode: 1,
      stdout: [],
      stderr: [refused, "Restart OpenBot with: sudo openbot restart"],
      absent: ["Fake server", "Memory:"],
    });
    writeFileSync(mode, "container\n");
    await check({
      name: "root in a container: no process check, but the reply checks still stop the command",
      exitCode: 1,
      stdout: ["Server: Fake server (online)"],
      stderr: ["OpenBot sent an invalid memory limit."],
      absent: [refused, "Memory:"],
    });
    rmSync(mode);
    await stop(younger);
    const other = await start(process.execPath, [fakeApp, socket, "Other program", injection]);
    await check({
      name: "root: a program that is not the OpenBot binary is refused",
      exitCode: 1,
      stdout: [],
      stderr: [refused],
      absent: ["Other program", "Memory:"],
    });
    await stop(other);
    await check({
      name: "root: a socket file with no listener does not answer",
      exitCode: 1,
      stdout: [],
      stderr: ["OpenBot does not answer. Read the log with: openbot logs"],
      absent: [refused],
    });
    await stop(real);
    await stop(helper);
    const inheriting = async (name: string, childBinary: string) => {
      rmSync(socket, { force: true });
      const activator = Bun.spawn(["systemd-socket-activate", "-l", socket, app, inheritingApp, name, childBinary], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      children.push(activator);
      const deadline = Date.now() + DEADLINE_MS;
      while (!existsSync(socket) && Date.now() < deadline) await Bun.sleep(20);
      const trigger = Bun.spawn(["curl", "-s", "--max-time", "10", "--unix-socket", socket, "http://openbot/"], {
        stdout: "ignore",
      });
      await trigger.exited;
      const inheritor = Number((await firstLine(activator.stdout)).match(/ready (\d+)/u)?.[1]);
      return async () => {
        if (inheritor > 0) process.kill(inheritor, "SIGKILL");
        await stop(activator);
      };
    };
    const stopForked = await inheriting("Forked server", app);
    await check({
      name: "root: a child of the app that still holds a copy of the socket is accepted",
      exitCode: 0,
      stdout: ["Server: Forked server (online)"],
      stderr: [],
      absent: [refused],
    });
    await stopForked();
    const stopShared = await inheriting("Shared server", process.execPath);
    await check({
      name: "root: a child that runs another program and holds the socket is refused",
      exitCode: 1,
      stdout: [],
      stderr: [refused],
      absent: ["Shared server"],
    });
    await stopShared();
    const restarted = await start(app, [fakeApp, socket, "Restarted server"]);
    await check({
      name: "root: after a restart, the new OpenBot process holds the socket",
      exitCode: 0,
      stdout: ["Server: Restarted server (online)"],
      stderr: [],
      absent: [],
    });
    await stop(restarted);
    const pins = readdirSync(runtime).filter((entry) => entry.startsWith("openbot-cli."));
    results.push({
      name: "root: the CLI removes its pinned socket links",
      exitCode: 0,
      stdout: [],
      stderr: [],
      absent: [],
      actual: { stdout: pins.join(" "), stderr: "", exitCode: pins.length, commandRan: false },
    });
  } finally {
    for (const child of children) child.kill("SIGKILL");
    rmSync(base, { recursive: true, force: true });
  }
  return results;
}

if (process.argv[2] === NAMESPACE_FLAG) {
  process.stdout.write(`${ROOT_CASES_START}${JSON.stringify(await runRootCasesInNamespace())}\n`);
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "openbot-cli-"));
const socket = join(work, "control.sock");
const install = join(work, "install");
const marker = join(work, "command-ran");
const cli = join(work, "openbot");
mkdirSync(join(install, "hosted"), { recursive: true });

copyWithLines("openbot", cli, { "SOCKET=/run/openbot/control.sock": `SOCKET=${socket}` });
copyWithLines("openbot-hosted-update", join(work, "openbot-hosted-update"), {
  "INSTALL=/opt/OpenBot": `INSTALL=${install}`,
});

type Field = string | Uint8Array;

interface Reply {
  status: number;
  lines: Record<string, Field>;
}

const bytes = (...parts: Field[]) =>
  Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part, "utf8") : part)));
const LONE_C2 = Uint8Array.of(0xc2);
const LONE_CSI = Uint8Array.of(0x9b);

const injection = `UNIT[$(touch ${marker})]`;
const statusLines = (lines: Record<string, Field>): Record<string, Field> => ({
  version: "0.62.0",
  account: "signed_out",
  server: "online",
  server_name: "Office",
  memory_level: "ok",
  memory_limit: "2147483648",
  memory_available: "1073741824",
  turn_limit: "4",
  ...lines,
});

const realQr = await QRCode.toString("openbot-mobile-connect:e2e", { type: "terminal", small: true });
const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const expiresAt = String(Date.now() + 120_000);

interface Case {
  name: string;
  args: string[];
  replies: Reply[];
  exitCode: number;
  stdout?: string[];
  stderr?: string[];
  absent?: string[];
  qrColors?: boolean;
  stdin?: string;
}

const cases: Case[] = [
  {
    name: "status with valid memory values",
    args: ["status"],
    replies: [{ status: 200, lines: statusLines({}) }],
    exitCode: 0,
    stdout: ["Server: Office (online)", "Memory: 1024 MiB free of 2048 MiB (ok)", "Turns at the same time: at most 4"],
  },
  {
    name: "status with digits that look octal",
    args: ["status"],
    replies: [{ status: 200, lines: statusLines({ memory_limit: "0002097152", memory_available: "08" }) }],
    exitCode: 0,
    stdout: ["Memory: 0 MiB free of 2 MiB (ok)"],
  },
  {
    name: "status with a command in memory_limit",
    args: ["status"],
    replies: [{ status: 200, lines: statusLines({ memory_limit: injection }) }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid memory limit."],
    absent: ["Memory:"],
  },
  {
    name: "status with a command in memory_available",
    args: ["status"],
    replies: [{ status: 200, lines: statusLines({ memory_available: injection }) }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid free memory value."],
    absent: ["Memory:"],
  },
  {
    name: "status with an empty memory_available",
    args: ["status"],
    replies: [{ status: 200, lines: statusLines({ memory_available: "" }) }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid free memory value."],
  },
  {
    name: "status with a number that is too long",
    args: ["status"],
    replies: [{ status: 200, lines: statusLines({ memory_limit: "9".repeat(19) }) }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid memory limit."],
  },
  {
    name: "login of a signed-in server with a command in memory_limit",
    args: ["login"],
    replies: [
      {
        status: 200,
        lines: statusLines({ account: "signed_in", email: "owner@example.com", memory_limit: injection }),
      },
    ],
    exitCode: 1,
    stdout: ["Account: owner@example.com"],
    stderr: ["OpenBot sent an invalid memory limit."],
  },
  {
    name: "login of a signed-in server with a command in memory_available",
    args: ["login"],
    replies: [
      {
        status: 200,
        lines: statusLines({ account: "signed_in", email: "owner@example.com", memory_available: injection }),
      },
    ],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid free memory value."],
  },
  {
    name: "status with terminal control text",
    args: ["status"],
    replies: [
      {
        status: 200,
        lines: statusLines({
          version: `${ESC}[31m0.62.0`,
          account: "signed_in",
          email: `${ESC}[8mowner@example.com`,
          server: "unconfigured",
          server_name: `${ESC}]0;owned${BEL}${ESC}[2JŁódź`,
          server_message: bytes(`${CSI_C1}2J`, LONE_C2, ESC, LONE_CSI, `H${OSC_C1}8;;x${BEL}\u007f\tend`),
          memory_level: `ok${BEL}`,
          turn_limit: `${ESC}[5m4`,
        }),
      },
    ],
    exitCode: 0,
    stdout: [
      "OpenBot ?[31m0.62.0",
      "Account: ?[8mowner@example.com",
      "Server: ?]0;owned??[2JŁódź (unconfigured)",
      "  ?2J?H?8;;x???end",
      "Memory: 1024 MiB free of 2048 MiB (ok?)",
      "Turns at the same time: at most ?[5m4",
    ],
  },
  {
    name: "status with lone 8-bit control bytes that are not UTF-8",
    args: ["status"],
    replies: [
      {
        status: 200,
        lines: statusLines({ server_name: bytes("Of", LONE_CSI, "2Jfice ", Uint8Array.of(0x9d), "Łódź") }),
      },
    ],
    exitCode: 0,
    stdout: ["Server: Of2Jfice Łódź (online)"],
  },
  {
    name: "login with a claim and terminal control text in the email",
    args: ["login", "--claim"],
    stdin: "claim-e2e\n",
    replies: [
      { status: 200, lines: statusLines({}) },
      { status: 200, lines: { email: `${ESC}[2Jowner@example.com` } },
      { status: 200, lines: statusLines({ account: "signed_in", email: `${ESC}[2Jowner@example.com` }) },
    ],
    exitCode: 0,
    stdout: ["Account: ?[2Jowner@example.com", "Sign in to OpenBot with ?[2Jowner@example.com"],
  },
  {
    name: "status with terminal control text in an unknown account state",
    args: ["status"],
    replies: [{ status: 200, lines: statusLines({ account: `${ESC}[2Jodd` }) }],
    exitCode: 0,
    stdout: ["Account: ?[2Jodd"],
  },
  {
    name: "error answer with terminal control text in the message",
    args: ["status"],
    replies: [{ status: 400, lines: { error: "invalid_request", message: `${ESC}]52;c;ZXZpbA==${BEL}denied` } }],
    exitCode: 1,
    stderr: ["?]52;c;ZXZpbA==?denied"],
  },
  {
    name: "error answer with terminal control text in the error code",
    args: ["status"],
    replies: [{ status: 400, lines: { error: `${ESC}[2Jnope` } }],
    exitCode: 1,
    stderr: ["OpenBot refused the request (?[2Jnope)."],
  },
  {
    name: "mobile-connect with a real QR code",
    args: ["mobile-connect"],
    replies: [{ status: 200, lines: { qr: base64(realQr), expires_at: expiresAt } }],
    exitCode: 0,
    stdout: [realQr.replace(/\n+$/u, ""), "In the OpenBot phone app, select Scan QR code and scan this code."],
    qrColors: true,
  },
  {
    name: "mobile-connect with an escape sequence in the QR code",
    args: ["mobile-connect"],
    replies: [{ status: 200, lines: { qr: base64(`${ESC}]52;c;ZXZpbA==${BEL}▄▀`), expires_at: expiresAt } }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid Mobile Connect code."],
    absent: ["▄▀"],
  },
  {
    name: "mobile-connect with a C1 control in the QR code",
    args: ["mobile-connect"],
    replies: [{ status: 200, lines: { qr: base64(`▄${CSI_C1}2J▀`), expires_at: expiresAt } }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid Mobile Connect code."],
  },
  {
    name: "mobile-connect with a QR code that is not UTF-8",
    args: ["mobile-connect"],
    replies: [
      {
        status: 200,
        lines: { qr: Buffer.from(bytes("▄", LONE_CSI, "2J▀")).toString("base64"), expires_at: expiresAt },
      },
    ],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid Mobile Connect code."],
  },
  {
    name: "mobile-connect with an allowed color code that hides another escape",
    args: ["mobile-connect"],
    replies: [{ status: 200, lines: { qr: base64(`${ESC}${ESC}[0m[2J▄`), expires_at: expiresAt } }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid Mobile Connect code."],
  },
  {
    name: "mobile-connect with a QR code that is not base64",
    args: ["mobile-connect"],
    replies: [{ status: 200, lines: { qr: "!!!", expires_at: expiresAt } }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid Mobile Connect code."],
  },
  {
    name: "mobile-connect with a command in expires_at",
    args: ["mobile-connect"],
    replies: [{ status: 200, lines: { qr: base64(realQr), expires_at: injection } }],
    exitCode: 1,
    stderr: ["OpenBot sent an invalid Mobile Connect code."],
  },
];

let replies: Reply[] = [];
let requests: string[] = [];
const server = Bun.serve({
  unix: socket,
  fetch(request) {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    const reply = replies.shift() ?? { status: 500, lines: { error: "no_reply_left" } };
    const body = bytes(...Object.entries(reply.lines).flatMap(([key, value]) => [`${key}=`, value, "\n"]));
    return new Response(body, { status: reply.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
});

function controlBytes(output: Buffer, qrColors: boolean): string[] {
  const data = qrColors ? Buffer.from(output.toString("latin1").replace(QR_COLORS, ""), "latin1") : output;
  const found: string[] = [];
  data.forEach((byte, index) => {
    const next = data[index + 1] ?? 0;
    if ((byte < 0x20 && byte !== 0x0a) || byte === 0x7f) found.push(`0x${byte.toString(16).padStart(2, "0")}`);
    if (byte === 0xc2 && next >= 0x80 && next <= 0x9f) found.push(`0xc2 0x${next.toString(16)}`);
  });
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    found.push("invalid UTF-8");
  }
  return found;
}

async function run(args: string[], stdin?: string) {
  const child = Bun.spawn(["bash", cli, ...args], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: work },
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), DEADLINE_MS);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr), exitCode };
}

async function runRootCases(): Promise<{ results: RootResult[]; runner: string; errors: string[] }> {
  const driver = [process.execPath, import.meta.path, NAMESPACE_FLAG];
  const runners = [
    {
      runner: "unshare",
      command: ["unshare", "--user", "--map-root-user", "--pid", "--fork", "--mount-proc", ...driver],
    },
    { runner: "sudo -n unshare", command: ["sudo", "-n", "unshare", "--pid", "--fork", "--mount-proc", ...driver] },
  ];
  const errors: string[] = [];
  for (const { runner, command } of runners) {
    const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), DEADLINE_MS * 4);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    clearTimeout(timer);
    const line = stdout.split("\n").find((entry) => entry.startsWith(ROOT_CASES_START));
    if (line)
      return {
        results: z.array(rootResultSchema).parse(JSON.parse(line.slice(ROOT_CASES_START.length))),
        runner,
        errors,
      };
    errors.push(`${runner}: exit ${exitCode}: ${stderr.trim().split("\n").slice(-3).join(" / ")}`);
  }
  return { results: [], runner: "none", errors };
}

const results = [];
try {
  for (const testCase of cases) {
    rmSync(marker, { force: true });
    replies = [...testCase.replies];
    requests = [];
    const output = await run(testCase.args, testCase.stdin);
    const { exitCode } = output;
    const stdout = output.stdout.toString("utf8");
    const stderr = output.stderr.toString("utf8");
    const commandRan = existsSync(marker);
    const control = controlBytes(Buffer.concat([output.stdout, output.stderr]), testCase.qrColors === true);
    const failures = [
      ...(exitCode === testCase.exitCode ? [] : [`exit code ${exitCode}, expected ${testCase.exitCode}`]),
      ...(commandRan ? ["the command in the reply ran"] : []),
      ...(control.length === 0 ? [] : [`control characters in the output: ${control.join(" ")}`]),
      ...(testCase.stdout ?? [])
        .filter((line) => !stdout.includes(line))
        .map((line) => `stdout misses ${JSON.stringify(line)}`),
      ...(testCase.stderr ?? [])
        .filter((line) => !stderr.includes(line))
        .map((line) => `stderr misses ${JSON.stringify(line)}`),
      ...(testCase.absent ?? [])
        .filter((line) => stdout.includes(line))
        .map((line) => `stdout has ${JSON.stringify(line)}`),
      ...(replies.length === 0 ? [] : [`${replies.length} replies were not read`]),
    ];
    results.push({
      name: testCase.name,
      args: testCase.args,
      requests,
      exitCode,
      commandRan,
      controlCharacters: control,
      stdout,
      stderr,
      passed: failures.length === 0,
      failures,
    });
    logger.info(
      `${failures.length === 0 ? "pass" : "FAIL"}  ${testCase.name}${failures.length ? `: ${failures.join("; ")}` : ""}`,
    );
  }
  const root = await runRootCases();
  for (const rootCase of root.results) {
    const { actual } = rootCase;
    const failures = [
      ...(actual.exitCode === rootCase.exitCode ? [] : [`exit code ${actual.exitCode}, expected ${rootCase.exitCode}`]),
      ...(actual.commandRan ? ["the command in the reply ran"] : []),
      ...rootCase.stdout
        .filter((line) => !actual.stdout.includes(line))
        .map((line) => `stdout misses ${JSON.stringify(line)}`),
      ...rootCase.stderr
        .filter((line) => !actual.stderr.includes(line))
        .map((line) => `stderr misses ${JSON.stringify(line)}`),
      ...rootCase.absent
        .filter((line) => actual.stdout.includes(line) || actual.stderr.includes(line))
        .map((line) => `output has ${JSON.stringify(line)}`),
    ];
    results.push({
      name: rootCase.name,
      args: ["status"],
      requests: [],
      exitCode: actual.exitCode,
      commandRan: actual.commandRan,
      controlCharacters: [],
      stdout: actual.stdout,
      stderr: actual.stderr,
      passed: failures.length === 0,
      failures: [`runner: ${root.runner}`, ...failures].slice(failures.length === 0 ? 1 : 0),
    });
    logger.info(
      `${failures.length === 0 ? "pass" : "FAIL"}  ${rootCase.name}${failures.length ? `: ${failures.join("; ")}` : ""}`,
    );
  }
  if (root.results.length === 0) {
    results.push({
      name: "root cases in a PID and user namespace",
      args: [],
      requests: [],
      exitCode: -1,
      commandRan: false,
      controlCharacters: [],
      stdout: "",
      stderr: root.errors.join("\n"),
      passed: false,
      failures: ["neither unshare nor sudo -n could start the root cases", ...root.errors],
    });
    logger.info(`FAIL  root cases did not run: ${root.errors.join(" | ")}`);
  }
} finally {
  await server.stop(true);
  rmSync(work, { recursive: true, force: true });
}

const passed = results.every((result) => result.passed);
const report = join(OUT, "report.json");
writeFileSync(report, `${JSON.stringify({ passed, cases: results }, null, 2)}\n`);
assert.ok(passed, `The openbot CLI control reply E2E test failed. Report: ${report}`);
logger.info(`The openbot CLI control reply E2E test passed. Report: ${report}`);
