// End-to-end check of Hermes Agent on a self-hosted server (#4881). It makes a test image from the
// OpenBot release image with the packages of this checkout's `scripts/hosting/packages.txt`, and
// points Hermes at a mock OpenAI-compatible model on this computer. Then:
//
//   1. The `HermesInstaller` of this checkout, which the Hermes row's Download runs, installs Hermes
//      in the container as the service user `openbot` (`--install`). A Cancel during the install
//      stops it with no installer process left, and the next Download installs Hermes to `ready`.
//   2. The real release server in the container finds Hermes, and the Hermes row is `available` with
//      the mock model.
//   3. The Hermes driver of this checkout runs in the container as `openbot` (`--inside`): model list,
//      one turn that reaches the mock model, and a resume in a new process.
//
// It needs Docker and network access for the image, the Hermes installer and Bun. No account is used.
//
//   bun run test:hermes-server [-- --image ghcr.io/nightly-labs/openbot:0.60.0]
//
// The report is `.openbot-build/hermes-server-e2e/report.json`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getString, isRecord } from "../src/backend/protocol";

const REPO = resolve(import.meta.dirname, "..");
const OUT = join(REPO, ".openbot-build/hermes-server-e2e");
const REPLY = "HERMES_SERVER_E2E_OK";
const MODEL = "mock-model";
const BUN_VERSION = "1.4.2";
const PROVIDERS_LOG = "/data/.config/OpenBot/logs/providers/providers.log";

if (process.argv.includes("--install")) {
  await install();
} else if (process.argv.includes("--inside")) {
  await inside();
} else {
  await host();
}

interface InstallResult {
  /** The phases and progress of the cancelled install, in order. */
  cancelled: string[];
  /** The status after Cancel. */
  afterCancel: string;
  /** Installer processes that were still running after Cancel. */
  leftProcesses: string[];
  /** The phases and progress of the full install, in order. */
  installed: string[];
  final: string;
}

/** In the container, as `openbot`: the Download of the Hermes row, with a Cancel first. */
async function install(): Promise<void> {
  const { Effect } = await import("effect");
  const { runCauseEffect } = await import("../src/backend/effect-boundary");
  const { requireProviderDriver } = await import("../src/backend/provider-drivers");
  const { HermesInstaller } = await import("../src/main/hermes-installer");
  const driver = requireProviderDriver("hermes");
  // The agent status of the app: the provider check after the install finds the CLI, or does not.
  const installer: InstanceType<typeof HermesInstaller> = new HermesInstaller({
    downloadRoot: join(tmpdir(), "hermes-downloads"),
    refreshProvider: () =>
      driver.resolveCli().pipe(
        Effect.match({
          onFailure: () =>
            installer.setProvider({ id: "hermes", state: "not-installed", version: null, message: null }),
          onSuccess: (cli) =>
            installer.setProvider({ id: "hermes", state: "sign-in-required", version: cli.version, message: null }),
        }),
      ),
  });
  installer.setProvider({ id: "hermes", state: "not-installed", version: null, message: null });
  const describe = () => {
    const status = installer.status();
    return status ? `${status.phase}${status.progress === null ? "" : ` ${status.progress}`}` : "none";
  };
  /** Records each status until `done` says to stop. */
  const follow = (done: (phase: string | undefined) => boolean) =>
    new Promise<string[]>((settle) => {
      const seen: string[] = [describe()];
      const listener = () => {
        const next = describe();
        if (seen.at(-1) !== next) seen.push(next);
        if (done(installer.status()?.phase)) {
          installer.off("status", listener);
          settle(seen);
        }
      };
      installer.on("status", listener);
    });
  try {
    // Cancel after the clone, while the virtual environment and the Python packages install.
    const cancelled = follow((phase) => phase !== "downloading");
    const cancelAt = new Promise<void>((settle) => {
      const listener = () => {
        if ((installer.status()?.progress ?? 0) < 17) return;
        installer.off("status", listener);
        settle();
      };
      installer.on("status", listener);
    });
    await runCauseEffect(installer.install());
    await cancelAt;
    await runCauseEffect(installer.cancel());
    const cancelledPhases = await cancelled;
    const afterCancel = describe();
    const leftProcesses = (await must("ps", ["-eo", "pid,args"]))
      .split("\n")
      .filter((line) => line.includes("hermes-install-"));

    const installed = follow((phase) => phase !== "downloading" && phase !== "finishing");
    await runCauseEffect(installer.install());
    const result: InstallResult = {
      cancelled: cancelledPhases,
      afterCancel,
      leftProcesses,
      installed: await installed,
      final: JSON.stringify(installer.status()),
    };
    process.stdout.write(`\nRESULT ${JSON.stringify(result)}\n`);
  } finally {
    await runCauseEffect(installer.stop());
  }
}

interface InsideResult {
  executable: string;
  version: string;
  models: string[];
  reply: string;
  status: string | null;
  resumedStatus: string | null;
}

/** In the container, as `openbot`: the Hermes driver of this checkout with the user's own Hermes. */
async function inside(): Promise<void> {
  const { runCauseEffect } = await import("../src/backend/effect-boundary");
  const { decodeModelListResponse } = await import("../src/backend/protocol");
  const { NO_PROVIDER_CREDENTIALS, requireProviderDriver } = await import("../src/backend/provider-drivers");
  const { runTurn, startThread, stopClients } = await import("./provider-fakes/host");
  const driver = requireProviderDriver("hermes");
  const cli = await runCauseEffect(driver.resolveCli());
  const clients: Awaited<ReturnType<typeof driver.createClient>>[] = [];
  const open = () => {
    const client = driver.createClient(cli, 60_000, NO_PROVIDER_CREDENTIALS);
    clients.push(client);
    client.start();
    return client;
  };
  try {
    const workspace = join(process.env.HOME ?? "/data", "e2e-workspace");
    await mkdir(workspace, { recursive: true });
    let client = open();
    const listed = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
    const models = listed.data.flatMap((model) => model.model ?? []);
    const model = models.find((id) => id.endsWith(`:${MODEL}`));
    assert.ok(model, `model/list gives the mock model: ${models.join(", ")}`);
    const thread = await startThread(client, { cwd: workspace, model });
    const turn = await runTurn(client, thread, { model, text: "Reply with the test word." });
    assert.equal(turn.error, null, "The turn has no error.");
    await runCauseEffect(client.stop());
    client = open();
    await runCauseEffect(client.request("thread/resume", { threadId: thread, cwd: workspace, model }, (v) => v));
    const resumed = await runTurn(client, thread, { model, text: "Again." });
    const result: InsideResult = {
      executable: cli.executable,
      version: cli.version,
      models,
      reply: turn.reply,
      status: turn.status,
      resumedStatus: resumed.status,
    };
    process.stdout.write(`\nRESULT ${JSON.stringify(result)}\n`);
  } finally {
    await stopClients(clients);
  }
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** Async, so that the mock model in this process can answer while a container runs. */
function run(command: string, args: string[], timeoutMs = 600_000): Promise<Run> {
  return new Promise((settle, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => settle({ status: code ?? -1, stdout, stderr }));
  });
}

async function must(command: string, args: string[], timeoutMs?: number): Promise<string> {
  const result = await run(command, args, timeoutMs);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}${result.stdout}`);
  }
  return result.stdout;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/** The mock model: an OpenAI-compatible list and chat endpoint that always gives `REPLY`. */
function startMockModel(requests: string[]) {
  const chunk = (delta: { role?: "assistant"; content?: string }, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "e2e",
      object: "chat.completion.chunk",
      created: 1,
      model: MODEL,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/models")) {
        return Response.json({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "e2e" }] });
      }
      if (!path.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
      const body = await request.json();
      requests.push(getString(body, "model") ?? "");
      if (!(isRecord(body) && body.stream === true)) {
        return Response.json({
          id: "e2e",
          object: "chat.completion",
          created: 1,
          model: MODEL,
          choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      return new Response(`${chunk({ role: "assistant", content: REPLY }, null)}${chunk({}, "stop")}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
}

async function host(): Promise<void> {
  const image = argument("--image") ?? "ghcr.io/nightly-labs/openbot:latest";
  const tag = randomBytes(4).toString("hex");
  const testImage = `openbot-hermes-server-e2e:${tag}`;
  const volume = `openbot-hermes-server-e2e-${tag}`;
  const server = `openbot-hermes-server-e2e-${tag}`;
  const checks: Check[] = [];
  const requests: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    process.stdout.write(`${ok ? "pass" : "FAIL"} ${name}: ${detail}\n`);
  };
  const build = await mkdtemp(join(tmpdir(), "openbot-hermes-server-e2e-"));
  const mock = startMockModel(requests);
  const baseUrl = `http://host.docker.internal:${mock.port}/v1`;
  let failure: string | undefined;
  let version = "unknown";
  await mkdir(OUT, { recursive: true });

  /** A shell command as `openbot` in a new container on the data volume. */
  const oneShot = `${server}-shell`;
  const asOpenBot = (script: string, extra: string[] = [], timeoutMs?: number) =>
    run(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        oneShot,
        "--add-host",
        "host.docker.internal:host-gateway",
        "-v",
        `${volume}:/data`,
        ...extra,
        "--entrypoint",
        "bash",
        testImage,
        "-euo",
        "pipefail",
        "-c",
        script,
      ],
      timeoutMs,
    );

  try {
    await must("docker", ["pull", "--quiet", image]);
    // The release image with the packages of this checkout, as the next release has them.
    const packages = await readFile(join(REPO, "scripts/hosting/packages.txt"), "utf8");
    await writeFile(join(build, "packages.txt"), packages);
    await writeFile(
      join(build, "Dockerfile"),
      [
        `FROM ${image}`,
        "USER root",
        "COPY packages.txt /tmp/packages.txt",
        "RUN apt-get update && sed -e '/^#/d' -e '/^$/d' -e '/^apparmor$/d' /tmp/packages.txt | xargs apt-get install --yes --no-install-recommends && rm -rf /var/lib/apt/lists/* /tmp/packages.txt",
        "USER openbot",
        "",
      ].join("\n"),
    );
    await must("docker", ["build", "--quiet", "--tag", testImage, build]);
    version = (await must("docker", ["run", "--rm", "--entrypoint", "openbot", testImage, "version"])).trim();
    check("image", true, `${image}, OpenBot ${version}`);

    // Hermes as the service user, with the Download of the Hermes row: a Cancel, then the install.
    const installed = await asOpenBot(
      `curl -fsSL https://bun.sh/install | bash -s bun-v${BUN_VERSION} >/dev/null 2>&1
      cd /src && ~/.bun/bin/bun scripts/hermes-server-e2e.ts --install
      ~/.local/bin/hermes --version
      printf 'model:\\n  provider: custom\\n  base_url: ${baseUrl}\\n  api_key: e2e-key\\n  default: ${MODEL}\\n' >~/.hermes/config.yaml`,
      ["-v", `${REPO}:/src:ro`],
      2_400_000,
    );
    const installLine = installed.stdout.match(/^RESULT (\{.*\})$/mu)?.[1];
    if (installed.status !== 0 || !installLine)
      throw new Error(`Hermes did not install:\n${installed.stdout}${installed.stderr}`);
    const steps = JSON.parse(installLine);
    const list = (key: keyof InstallResult) =>
      isRecord(steps) && Array.isArray(steps[key]) ? steps[key].map(String) : [];
    const text = (key: keyof InstallResult) => (isRecord(steps) ? (getString(steps, key) ?? "") : "");
    const cancelled = list("cancelled");
    check(
      "download progress",
      cancelled[0] === "not-downloaded" && cancelled.includes("downloading 17") && cancelled.length > 3,
      cancelled.join(", "),
    );
    check(
      "download cancel",
      text("afterCancel") === "not-downloaded" && list("leftProcesses").length === 0,
      `${text("afterCancel")}; left: ${list("leftProcesses").join(" | ") || "none"}`,
    );
    const phases = list("installed");
    const final = text("final");
    check(
      "download install",
      phases.includes("downloading 100") && phases.includes("finishing") && final.includes('"phase":"ready"'),
      `${phases.join(", ")} -> ${final}`,
    );
    check("hermes install", true, installed.stdout.trim().split("\n").at(-1) ?? "");

    // The real server: OpenBot finds Hermes and reads its model, with no sign-in of the account.
    await must("docker", [
      "run",
      "--detach",
      "--name",
      server,
      "--add-host",
      "host.docker.internal:host-gateway",
      "--security-opt",
      `seccomp=${join(REPO, "docker/seccomp.json")}`,
      "--security-opt",
      "no-new-privileges:true",
      "--shm-size",
      "1g",
      "-v",
      `${volume}:/data`,
      testImage,
    ]);
    // Waits for the Hermes state in the provider log: `available` or another end state.
    const waited = await run(
      "docker",
      [
        "exec",
        server,
        "bash",
        "-c",
        `for i in $(seq 240); do grep -q '"provider":"hermes","count"' ${PROVIDERS_LOG} 2>/dev/null && break; grep -qE '"provider":"hermes","from":"checking","to":"(not-installed|error|sign-in-required)"' ${PROVIDERS_LOG} 2>/dev/null && break; sleep 0.5; done; grep '"provider":"hermes"' ${PROVIDERS_LOG} || true`,
      ],
      180_000,
    );
    const log = waited.stdout;
    const resolved = log.match(/Resolved a provider CLI\. (\{.*\})/u)?.[1];
    check("server finds hermes", Boolean(resolved?.includes('"source":"system"')), resolved ?? "no CLI line");
    const states = [...log.matchAll(/"from":"([a-z-]+)","to":"([a-z-]+)"/gu)].map(
      (match) => `${match[1]}->${match[2]}`,
    );
    check("server hermes available", states.includes("checking->available"), states.join(", "));
    check(
      "server hermes models",
      /"provider":"hermes","count":[1-9]/u.test(log),
      log.match(/listed its models\. (\{.*\})/u)?.[1] ?? "",
    );
    await must("docker", ["stop", "--timeout", "60", server]);

    // The driver of this checkout as `openbot`, with the user's Hermes: a turn and a resume.
    const driven = await asOpenBot(
      "cd /src && ~/.bun/bin/bun scripts/hermes-server-e2e.ts --inside",
      ["-v", `${REPO}:/src:ro`],
      600_000,
    );
    const line = driven.stdout.match(/^RESULT (\{.*\})$/mu)?.[1];
    if (!line) throw new Error(`The driver run gave no result:\n${driven.stdout}${driven.stderr}`);
    const result = JSON.parse(line);
    const field = (key: keyof InsideResult) => getString(result, key) ?? "";
    check(
      "driver resolves hermes",
      field("executable") === "/data/.local/bin/hermes",
      `${field("executable")} ${field("version")}`,
    );
    check(
      "driver turn",
      field("status") === "completed" && field("reply").includes(REPLY),
      `${field("status")}: ${field("reply")}`,
    );
    check("driver resume", field("resumedStatus") === "completed", field("resumedStatus"));
    check(
      "mock model requests",
      requests.length > 0 && requests.every((model) => model === MODEL),
      requests.join(", "),
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    process.stdout.write(`FAIL ${failure}\n`);
  } finally {
    await mock.stop(true);
    await run("docker", ["rm", "--force", server, oneShot]);
    await run("docker", ["volume", "rm", "--force", volume]);
    await run("docker", ["image", "rm", "--force", testImage]);
    await rm(build, { recursive: true, force: true });
  }

  const passed = failure === undefined && checks.length > 0 && checks.every((entry) => entry.ok);
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ passed, image, version, checks, ...(failure ? { failure } : {}) }, null, 2)}\n`,
  );
  process.stdout.write(`${passed ? "passed" : "FAILED"}: ${join(OUT, "report.json")}\n`);
  process.exitCode = passed ? 0 : 1;
}
