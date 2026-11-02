import { dirname } from "node:path";
import type { CreateGrokBotAgentInput, GrokBotComputerSummary } from "@openbot/contracts/ipc";
import { IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result } from "effect";
import {
  GrokBotAccountFailed,
  GrokBotAccountStore,
  publicGrokBotStatus,
  type SecretCipher,
  startGrokBotSignIn,
} from "../backend/grok-bot/grok-bot-account";
import { GrokBotBoxComputer } from "../backend/grok-bot/grok-bot-box-computer";
import { type GrokBotBoxExec, startGrokBotBoxExec } from "../backend/grok-bot/grok-bot-box-exec";
import type { GrokBotComputerStatus } from "../backend/grok-bot/grok-bot-computer";
import {
  createGrokBotAgent,
  ensureGrokBotComputerReady,
  type GrokBotGatewayCallOptions,
  handBackGrokBotComputer,
  listGrokBotAgents,
  readGrokBotComputer,
} from "../backend/grok-bot/grok-bot-gateway";
import {
  bindGrokBotLocalHost,
  type GrokBotLocalHost,
  grokBotLocalHost,
  openBotLocalGatewaySession,
} from "../backend/grok-bot/grok-bot-local-host";
import { readGrokBotUsageSummary } from "../backend/grok-bot/grok-bot-usage";
import { readGrokBotUsageDiagnostic } from "../backend/grok-bot/grok-bot-usage-diagnostic";
import { type GrokBotImportStore, importGrokBotAgents } from "./grok-bot-agent-import";
import { GrokBotComputerWindow } from "./grok-bot-computer-window";
import { type RendererIpcWindow, sendToRenderer } from "./renderer-ipc";

const GROK_BOT_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const OFFICIAL_API = "https://api2.cursor.sh";
const diagnosticLogger = createOpenBotLogger("grok-bot-cached-usage-diagnostic");

export interface GrokBotAccountServiceOptions {
  path: string;
  cipher: SecretCipher;
  getMainWindow: () => RendererIpcWindow | null;
  /** The local roster an import writes to. Absent, import fails; Grok Bot is never written. */
  agentStore?: GrokBotImportStore;
}

/** One Grok Bot sign-in on this computer. The file and cipher come from the caller. */
export class GrokBotAccountService {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  readonly #getMainWindow: () => RendererIpcWindow | null;
  readonly #store: GrokBotAccountStore;
  readonly #host: GrokBotLocalHost;
  readonly #agentStore: GrokBotImportStore | undefined;
  #abort: AbortController | null = null;
  #computer = new GrokBotComputerWindow();
  #boxExec: GrokBotBoxExec | null = null;
  #boxAttached = false;
  #diagnosticAbort: AbortController | null = null;

  constructor(options: GrokBotAccountServiceOptions) {
    this.#path = options.path;
    this.#cipher = options.cipher;
    this.#getMainWindow = options.getMainWindow;
    this.#agentStore = options.agentStore;
    this.#store = new GrokBotAccountStore(options.path, options.cipher);
    this.#host = grokBotLocalHost(dirname(options.path));
    bindGrokBotLocalHost(dirname(options.path), this.#host);
  }

  /** The sand account the Grok Bot provider reads. The renderer does not receive this store. */
  accountStore(): GrokBotAccountStore {
    return this.#store;
  }

  readonly status = Effect.fn("GrokBotAccountService.status")(function* (this: GrokBotAccountService) {
    return publicGrokBotStatus(yield* this.#store.load());
  });

  readonly start = Effect.fn("GrokBotAccountService.start")(function* (this: GrokBotAccountService) {
    this.#diagnosticAbort?.abort();
    this.#store.forgetCachedGateway();
    this.#abort?.abort();
    const controller = new AbortController();
    this.#abort = controller;
    const apiBaseUrl = sandApiBase();
    const started = yield* startGrokBotSignIn({
      timeoutMs: GROK_BOT_SIGN_IN_TIMEOUT_MS,
      authFile: this.#path,
      cipher: this.#cipher,
      signal: controller.signal,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
    });
    void Effect.runPromise(started.done).then(
      () => {
        sendToRenderer(this.#getMainWindow(), IPC_ENDPOINTS.grokBot.account, { phase: "signed-in" });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        sendToRenderer(this.#getMainWindow(), IPC_ENDPOINTS.grokBot.account, {
          phase: "failed",
          message: failureMessage(error),
        });
      },
    );
    return { verificationUrl: started.verificationUrl };
  });

  readonly cancel = Effect.fn("GrokBotAccountService.cancel")(function* (this: GrokBotAccountService) {
    this.#abort?.abort();
    this.#abort = null;
    yield* Effect.void;
  });

  readonly signOut = Effect.fn("GrokBotAccountService.signOut")(function* (this: GrokBotAccountService) {
    this.#diagnosticAbort?.abort();
    this.#abort?.abort();
    this.#abort = null;
    this.#host.abort();
    yield* this.#host.stop().pipe(Effect.ignore);
    yield* this.#store.clear();
    sendToRenderer(this.#getMainWindow(), IPC_ENDPOINTS.grokBot.account, { phase: "signed-out" });
    return { signedIn: false };
  });

  readonly list = Effect.fn("GrokBotAccountService.list")(function* (this: GrokBotAccountService) {
    return yield* listGrokBotAgents(this.#store, this.#callOptions());
  });

  /** Lists Grok Bot agents and mirrors them locally. Read-only toward Grok Bot: no create call. */
  readonly importAgents = Effect.fn("GrokBotAccountService.importAgents")(function* (this: GrokBotAccountService) {
    const store = this.#agentStore;
    if (!store) return yield* Effect.die(new Error("Grok Bot import has no local agent store."));
    const remote = yield* listGrokBotAgents(this.#store, this.#callOptions());
    return yield* importGrokBotAgents(remote, store);
  });

  readonly usage = Effect.fn("GrokBotAccountService.usage")(function* (this: GrokBotAccountService) {
    return yield* readGrokBotUsageSummary(this.#store);
  });

  /** Native opt-in action only. This is deliberately absent from renderer IPC and the Team API. */
  readonly diagnoseCachedUsage = Effect.fn("GrokBotAccountService.diagnoseCachedUsage")(function* (
    this: GrokBotAccountService,
    optedIn: boolean,
  ) {
    if (!optedIn || this.#diagnosticAbort !== null) return;
    const controller = new AbortController();
    this.#diagnosticAbort = controller;
    yield* readGrokBotUsageDiagnostic({
      optedIn,
      cachedGateway: () => this.#store.cachedGateway(),
      signal: controller.signal,
    }).pipe(
      Effect.tap((report) =>
        Effect.sync(() => diagnosticLogger.info("Cached Grok Bot usage capability check.", report)),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.#diagnosticAbort = null;
        }),
      ),
    );
  });

  readonly create = Effect.fn("GrokBotAccountService.create")(function* (
    this: GrokBotAccountService,
    input: CreateGrokBotAgentInput,
  ) {
    return yield* createGrokBotAgent(this.#store, input, this.#callOptions());
  });

  /** The sand computer (BotAI forever box). The screen URL stays in main. */
  readonly computerStatus = Effect.fn("GrokBotAccountService.computerStatus")(function* (this: GrokBotAccountService) {
    return computerSummary(yield* readGrokBotComputer(this.#store, this.#callOptions()), this.#computer.isOpen());
  });

  /**
   * BotAI "Open computer": wake the sand desktop, connect its computer control, then show the screen.
   * Control on this machine uses the box `cua-driver` when that binary is present. Otherwise the
   * in-box host keeps click, type, and screenshot, and this window only shows the desktop.
   */
  readonly openComputer = Effect.fn("GrokBotAccountService.openComputer")(function* (this: GrokBotAccountService) {
    const status = yield* ensureGrokBotComputerReady(this.#store, this.#callOptions());
    yield* this.#connectBoxComputer();
    if (status.vncUrl) this.#computer.open(status.vncUrl, status.networkToken, "Grok Bot computer");
    return computerSummary(status, this.#computer.isOpen());
  });

  /** BotAI "I'm done, continue": give the computer back to the agent that asked for a takeover. */
  readonly handBackComputer = Effect.fn("GrokBotAccountService.handBackComputer")(function* (
    this: GrokBotAccountService,
  ) {
    const status = yield* readGrokBotComputer(this.#store, this.#callOptions());
    if (status.handoffAgentId) {
      yield* handBackGrokBotComputer(this.#store, status.handoffAgentId, this.#callOptions());
    }
    return computerSummary(yield* readGrokBotComputer(this.#store, this.#callOptions()), this.#computer.isOpen());
  });

  /**
   * Starts the private host when this computer is already signed in.
   * Other providers do not call this. A failure stays on the next Grok call.
   */
  readonly ensurePrivateHost = Effect.fn("GrokBotAccountService.ensurePrivateHost")(function* (
    this: GrokBotAccountService,
  ) {
    const record = yield* this.#store.load();
    if (!record) return;
    const ready = yield* this.#host.ensure();
    const gateway = openBotLocalGatewaySession(ready.token);
    if (record.gateway?.url === gateway.url && record.gateway.token === gateway.token) return;
    yield* this.#store.save({ ...record, gateway });
  });

  dispose(): Promise<void> {
    this.#diagnosticAbort?.abort();
    this.#store.forgetCachedGateway();
    this.#boxExec?.close();
    this.#boxExec = null;
    this.#boxAttached = false;
    this.#computer.close();
    this.#abort?.abort();
    this.#abort = null;
    this.#host.abort();
    return Effect.runPromise(this.#host.stop().pipe(Effect.ignore));
  }

  #callOptions(): GrokBotGatewayCallOptions {
    const apiBaseUrl = sandApiBase();
    return { allowLoopback: false, localHost: this.#host, ...(apiBaseUrl ? { apiBaseUrl } : {}) };
  }

  /**
   * Holds the box driver when this process can see it. A box-host port
   * (`SAND_BOX_EXEC_DAEMON_PORT`) also starts the loopback computer control server.
   */
  readonly #connectBoxComputer = Effect.fn("GrokBotAccountService.connectBoxComputer")(function* (
    this: GrokBotAccountService,
  ) {
    if (this.#boxAttached) return;
    this.#boxAttached = true;
    const computer = new GrokBotBoxComputer();
    const port = boxExecPort();
    if (!computer.configured || port == null) return;
    const started = yield* Effect.result(startGrokBotBoxExec({ computer, port }));
    if (Result.isSuccess(started)) this.#boxExec = started.success;
    else diagnosticLogger.info("Grok Bot box computer control did not start.");
  });
}

function computerSummary(status: GrokBotComputerStatus, windowOpen: boolean): GrokBotComputerSummary {
  return {
    phase: status.phase,
    screenAvailable: status.vncUrl !== null,
    windowOpen,
    pullPercent: status.pullPercent,
    imageUpdateAvailable: status.imageUpdateAvailable,
    needsYou: status.handoffAgentId !== null,
    handoffReason: status.handoffReason,
  };
}

function boxExecPort(): number | null {
  const raw = process.env.SAND_BOX_EXEC_DAEMON_PORT;
  if (raw == null || raw.length === 0) return null;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  return port;
}

function sandApiBase(): string | undefined {
  const raw = process.env.CURSOR_API_BASE_URL;
  if (!raw) return undefined;
  const base = raw.replace(/\/+$/u, "");
  return base === OFFICIAL_API ? base : undefined;
}

function failureMessage(error: unknown): string {
  const cause = error instanceof GrokBotAccountFailed ? error.cause : error;
  return cause instanceof Error ? cause.message : sourceText("error.provider.grokBotSignInEnded");
}
