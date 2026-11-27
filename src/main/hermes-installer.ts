import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProviderStatus, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { configuredCliPath, resolveHermesCli } from "../backend/cli";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync } from "./provider-runtime-effects";
import { readLimitedBody } from "./provider-runtime-releases";

const logger = createOpenBotLogger("hermes-installer");

const HERMES_INSTALLER = {
  version: "0.22.7",
  commit: "b200f5bc60e31588ba2cb60e288029c4a54ba5fa",
  url: "https://raw.githubusercontent.com/NousResearch/hermes-agent/b200f5bc60e31588ba2cb60e288029c4a54ba5fa/scripts/install.sh",
  sha256: "abf338605dae6dd28d101673ac6aed7995c955745db46d47676bc591a7957209",
} as const;

const STAGES = [
  ["prerequisites", 2],
  ["repository", 15],
  ["venv", 8],
  ["python-deps", 40],
  ["config", 2],
  ["products", 30],
  ["complete", 3],
] as const;
type Stage = (typeof STAGES)[number][0];

const DOWNLOAD_TIMEOUT_MS = 60_000;
const STAGE_TIMEOUT_MS = 20 * 60_000;
const OUTPUT_LIMIT = 64 * 1024;
const LOGGED_OUTPUT = 2_000;
const EXIT_PIPE_WAIT_MS = 2_000;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HermesInstallerOptions {
  downloadRoot: string;
  refreshProvider: () => Effect.Effect<unknown, unknown>;
  platform?: NodeJS.Platform;
  fetchImpl?: Fetch;
}

const NOT_DOWNLOADED: ProviderRuntimeStatus = {
  phase: "not-downloaded",
  progress: null,
  message: null,
  version: null,
};

function failedStatus(message: string): ProviderRuntimeStatus {
  return { phase: "download-error", progress: null, message, version: null };
}

export class HermesInstaller extends EventEmitter<{ status: [] }> {
  readonly #downloadRoot: string;
  readonly #refreshProvider: () => Effect.Effect<unknown, unknown>;
  readonly #platform: NodeJS.Platform;
  readonly #fetch: Fetch;
  readonly #scope = Scope.makeUnsafe();
  #provider: AgentProviderStatus | undefined;
  #run: ProviderRuntimeStatus | null = null;
  #task: Fiber.Fiber<void> | null = null;
  #stopping = false;

  constructor(options: HermesInstallerOptions) {
    super();
    this.#downloadRoot = options.downloadRoot;
    this.#refreshProvider = options.refreshProvider;
    this.#platform = options.platform ?? process.platform;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  #supported(): boolean {
    return this.#platform === "darwin" || this.#platform === "linux";
  }

  status(): ProviderRuntimeStatus | undefined {
    const installable = this.#supported() && !configuredCliPath("hermes");
    if (installable && this.#run) return { ...this.#run };
    const provider = this.#provider;
    if (!provider || provider.off) return undefined;
    if (provider.state !== "not-installed")
      return { phase: "ready", progress: 100, message: null, version: provider.version ?? null };
    return installable ? { ...NOT_DOWNLOADED } : undefined;
  }

  setProvider(provider: AgentProviderStatus | undefined): void {
    const before = JSON.stringify(this.status());
    this.#provider = provider;
    if (this.#run?.phase === "download-error" && provider?.state !== "not-installed") this.#run = null;
    if (JSON.stringify(this.status()) !== before) this.emit("status");
  }

  install(): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      if (!this.#supported())
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.runtimesUnsupported")),
        });
      if (this.#stopping)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
      if (configuredCliPath("hermes"))
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.cliOverride")) });
      if (this.#task) return;
      if (this.#provider && this.#provider.state !== "not-installed") return;
      this.#set({ phase: "downloading", progress: 0, message: null, version: null });
      this.#task = yield* Effect.forkIn(this.#installAndCheck(), this.#scope);
    });
  }

  cancel(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const task = this.#task;
      if (!task || this.#run?.phase !== "downloading") return Effect.void;
      return Fiber.interrupt(task).pipe(Effect.asVoid);
    });
  }

  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.#stopping = true;
      return Scope.close(this.#scope, Exit.void);
    });
  }

  #set(run: ProviderRuntimeStatus | null): void {
    this.#run = run;
    this.emit("status");
  }

  #installAndCheck(): Effect.Effect<void> {
    return this.#runInstaller().pipe(
      Effect.andThen(
        Effect.sync(() => this.#set({ phase: "finishing", progress: null, message: null, version: null })),
      ),
      Effect.andThen(
        this.#refreshProvider().pipe(
          Effect.catch((error) =>
            Effect.sync(() => logger.warn("Hermes was not checked after its install.", toLogValue(error))),
          ),
        ),
      ),
      Effect.andThen(Effect.exit(resolveHermesCli())),
      Effect.andThen((found) =>
        Effect.sync(() =>
          this.#set(Exit.isSuccess(found) ? null : failedStatus(sourceText("error.provider.hermesInstallFailed"))),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          const message = error.cause instanceof Error ? error.cause.message : null;
          const known =
            message === sourceText("error.provider.hermesNeedsGitCurl") ||
            message === sourceText("error.provider.hermesInstallFailed");
          if (!known) logger.warn("The Hermes install failed.", toLogValue(error.cause));
          this.#set(failedStatus(known && message ? message : sourceText("error.provider.hermesInstallFailed")));
        }),
      ),
      Effect.onInterrupt(() => Effect.sync(() => this.#set(null))),
      Effect.ensuring(
        Effect.sync(() => {
          this.#task = null;
        }),
      ),
    );
  }

  #runInstaller(): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const script = yield* this.#saveInstaller();
      let progress = 0;
      for (const [stage, share] of STAGES) {
        yield* runStage(script, stage);
        progress += share;
        this.#set({ phase: "downloading", progress, message: null, version: null });
      }
    });
  }

  #saveInstaller(): Effect.Effect<string, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string, ProviderRuntimeFailure> {
      const failed = new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.hermesInstallFailed")) });
      const response = yield* runtimeIO((signal) =>
        this.#fetch(HERMES_INSTALLER.url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]),
        }),
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => logger.warn("The Hermes installer did not download.", toLogValue(error.cause))),
        ),
        Effect.mapError(() => failed),
      );
      if (!response.ok) {
        logger.warn("The Hermes installer did not download.", { status: response.status });
        yield* runtimeIO(async () => await response.body?.cancel()).pipe(Effect.ignore);
        return yield* failed;
      }
      const body = yield* readLimitedBody(response, sourceText("error.provider.hermesInstallFailed"));
      const digest = body ? createHash("sha256").update(body).digest("hex") : null;
      if (!body || digest !== HERMES_INSTALLER.sha256) {
        logger.warn("The Hermes installer does not match its pinned hash.", { digest });
        return yield* failed;
      }
      const file = join(this.#downloadRoot, `hermes-install-${HERMES_INSTALLER.version}.sh`);
      yield* runtimeIO(async () => {
        await mkdir(this.#downloadRoot, { recursive: true });
        await writeFile(file, body, { mode: 0o700 });
      });
      return file;
    });
  }
}

function stageFrame(stdout: string, stage: Stage): { ok: boolean; reason: string | null } | null {
  for (const line of stdout.trim().split("\n").reverse()) {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      continue; // Not the frame: a log line of the stage.
    }
    if (isDynamicRecord(frame) && frame.stage === stage && isBoolean(frame.ok))
      return { ok: frame.ok, reason: isString(frame.reason) ? frame.reason : null };
  }
  return null;
}

function forLog(text: string): string {
  return redactText(text.replaceAll(homedir(), "~")).slice(-LOGGED_OUTPUT);
}

function keepTail(text: string): string {
  return text.length > OUTPUT_LIMIT ? text.slice(-OUTPUT_LIMIT) : text;
}

const runStage = Effect.fn("HermesInstaller.runStage")(function* (script: string, stage: Stage) {
  const closed = Deferred.makeUnsafe<number | null>();
  const output = { stdout: "", stderr: "" };
  const code = yield* Effect.acquireUseRelease(
    runtimeSync((): ChildProcess => {
      const child = spawn(
        "bash",
        [
          script,
          "--stage",
          stage,
          "--json",
          "--commit",
          HERMES_INSTALLER.commit,
          "--non-interactive",
          "--skip-browser",
          "--skip-computer-use",
        ],
        {
          cwd: homedir(),
          env: { ...process.env, NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        },
      );
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        output.stdout = keepTail(output.stdout + chunk);
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
        output.stderr = keepTail(output.stderr + chunk);
      });
      child.once("error", (error) => {
        logger.warn("The Hermes installer did not start.", toLogValue(error));
        Deferred.doneUnsafe(closed, Effect.succeed(null));
      });
      child.once("close", (exitCode) => Deferred.doneUnsafe(closed, Effect.succeed(exitCode)));
      child.once("exit", (exitCode) => {
        setTimeout(() => Deferred.doneUnsafe(closed, Effect.succeed(exitCode)), EXIT_PIPE_WAIT_MS).unref();
      });
      return child;
    }),
    () =>
      Deferred.await(closed).pipe(
        Effect.timeoutOrElse({ duration: STAGE_TIMEOUT_MS, orElse: () => Effect.succeed("timeout" as const) }),
      ),
    (child) =>
      Effect.gen(function* () {
        if (Deferred.isDoneUnsafe(closed)) return;
        const signal = (value: NodeJS.Signals) =>
          Effect.sync(() => {
            try {
              if (child.pid) process.kill(-child.pid, value);
            } catch {}
          });
        yield* signal("SIGTERM");
        yield* Deferred.await(closed).pipe(
          Effect.timeoutOrElse({
            duration: 2_000,
            orElse: () => signal("SIGKILL").pipe(Effect.andThen(Deferred.await(closed))),
          }),
        );
        yield* signal("SIGKILL");
      }),
  );
  const frame = stageFrame(output.stdout, stage);
  if (code === 0 && frame?.ok) return;
  logger.warn("A Hermes installer stage failed.", {
    stage,
    code: code === null ? null : String(code),
    reason: frame?.reason ? forLog(frame.reason) : null,
    output: forLog(output.stderr || output.stdout),
  });
  return yield* new ProviderRuntimeFailure({
    cause: new Error(
      sourceText(
        stage === "prerequisites" ? "error.provider.hermesNeedsGitCurl" : "error.provider.hermesInstallFailed",
      ),
    ),
  });
});
