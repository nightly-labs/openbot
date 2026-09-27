import type { ProviderCodeLoginStart } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentClient } from "./../agent-client";
import { type CodexCliInfo, resolveCodexCli } from "./../cli";
import {
  type AccountLoginCompletedResult,
  type AccountReadResult,
  decodeAccountDeviceCodeLoginStartResult,
  decodeAccountLoginStartResult,
  decodeAccountReadResult,
  decodeRecordResponse,
} from "./../protocol";
import { recordRestartActivity } from "../restart-activity";

const CODEX_LOGIN_TIMEOUT_MS = 10 * 60_000;
const UNVERIFIED_MESSAGE = "OpenBot could not verify the ChatGPT connection. Try again.";

interface PendingCodexLogin {
  client: AgentClient;
  cli: CodexCliInfo;
  loginId: string;
  timer: NodeJS.Timeout;
  completing: boolean;
}

/** What the ChatGPT sign-in needs from the provider runtime that owns the Codex status and client. */
export interface CodexLoginHost {
  bundledExecutable(): string | null | undefined;
  /** A new Codex client, bound to the runtime's events but not started. */
  createClient(cli: CodexCliInfo): AgentClient;
  /** True when this client, or any client when none is given, is the active Codex client. */
  hasActiveClient(client?: AgentClient): boolean;
  activate(
    client: AgentClient,
    cli: CodexCliInfo,
    account: NonNullable<AccountReadResult["account"]>,
    options?: { isCurrent?: () => boolean },
  ): Promise<void>;
  setConnecting(): void;
  isConnecting(): boolean;
  clearConnectionState(): void;
  setFailure(error: unknown, version?: string | null): void;
}

/**
 * The ChatGPT sign-in of the Codex provider, in its browser and its code shapes. At most one is
 * pending. Its client stays running until the provider reports the end, so the token it issues
 * stays with that client.
 */
export class CodexLoginFlow {
  readonly #host: CodexLoginHost;
  #pending: PendingCodexLogin | null = null;

  constructor(host: CodexLoginHost) {
    this.#host = host;
  }

  get pending(): boolean {
    return this.#pending !== null;
  }

  /** Stops the timer and returns the pending login's client, which the caller stops. */
  dispose(): AgentClient | null {
    const pending = this.#pending;
    this.#pending = null;
    if (!pending) return null;
    clearTimeout(pending.timer);
    return pending.client;
  }

  async startBrowser(openExternal: (url: string) => Promise<void>): Promise<void> {
    await this.#withLoginClient(async (client, cli) => {
      const login = await client.request(
        "account/login/start",
        {
          type: "chatgpt",
          appBrand: "chatgpt",
          codexStreamlinedLogin: true,
          useHostedLoginSuccessPage: true,
        },
        decodeAccountLoginStartResult,
      );
      this.#track(client, cli, login.loginId);
      try {
        await openExternal(login.authUrl);
      } catch {
        await this.cancel("OpenBot could not open the ChatGPT connection page.");
        throw new Error(sourceText("error.provider.chatgptPageFailed"));
      }
    });
  }

  /**
   * Starts the sign-in the user finishes on another device, and reports the code to show.
   *
   * Only the code and the page it is typed on cross back: the token the provider issues for that
   * code stays with the Codex client this method leaves running, exactly as it does for the browser
   * sign-in. How this one ends reaches the renderer the same way too, through the provider's status.
   */
  async startDevice(): Promise<ProviderCodeLoginStart> {
    const started = await this.#withLoginClient(async (client, cli) => {
      const login = await client.request(
        "account/login/start",
        { type: "chatgptDeviceCode" },
        decodeAccountDeviceCodeLoginStartResult,
      );
      this.#track(client, cli, login.loginId);
      return {
        kind: "code" as const,
        userCode: login.userCode,
        verificationUrl: login.verificationUrl,
        expiresAt: Date.now() + CODEX_LOGIN_TIMEOUT_MS,
      };
    });
    return started ?? { kind: "connected" };
  }

  async complete(completion: AccountLoginCompletedResult, source: AgentClient): Promise<void> {
    const pending = this.#pending;
    if (!pending || pending.completing) return;
    if (pending.client !== source) return;
    if (completion.loginId !== null && completion.loginId !== pending.loginId) return;
    pending.completing = true;
    clearTimeout(pending.timer);

    if (!completion.success) {
      await this.#fail(pending, "ChatGPT connection was not completed. Try again.");
      return;
    }

    try {
      const account = await pending.client.request("account/read", { refreshToken: true }, decodeAccountReadResult);
      if (account.account?.type !== "chatgpt") {
        throw new Error(sourceText("error.provider.noAuthenticatedAccount", { provider: "ChatGPT" }));
      }
      if (this.#pending !== pending) return;
      await this.#host.activate(pending.client, pending.cli, account.account, {
        isCurrent: () => this.#pending === pending,
      });
      if (this.#pending === pending) this.#pending = null;
    } catch {
      await this.#fail(pending, UNVERIFIED_MESSAGE);
    }
  }

  /** Ends the pending login after a completion the runtime could not decode. */
  async failUnverified(): Promise<void> {
    const pending = this.#pending;
    if (pending) await this.#fail(pending, UNVERIFIED_MESSAGE);
  }

  async cancel(message: string | null, expected?: PendingCodexLogin): Promise<void> {
    const pending = this.#pending;
    if (!pending || (expected && pending !== expected)) return;
    this.#pending = null;
    clearTimeout(pending.timer);
    await pending.client
      .request("account/login/cancel", { loginId: pending.loginId }, decodeRecordResponse)
      .catch(() => undefined);
    await pending.client.stop().catch(() => undefined);
    if (message) this.#host.setFailure(new Error(message), pending.cli.version);
    else this.#host.clearConnectionState();
  }

  /** Keeps a login the user already finished, and cancels one they did not, before a provider refresh. */
  async settleForRefresh(): Promise<void> {
    const pending = this.#pending;
    if (!pending) {
      this.#host.clearConnectionState();
      return;
    }
    this.#pending = null;
    clearTimeout(pending.timer);
    try {
      const account = await pending.client.request("account/read", { refreshToken: true }, decodeAccountReadResult);
      if (account.account?.type === "chatgpt") {
        await this.#host.activate(pending.client, pending.cli, account.account);
        return;
      }
    } catch {
      // Fall through to cancellation and a fresh provider probe.
    }
    await pending.client
      .request("account/login/cancel", { loginId: pending.loginId }, decodeRecordResponse)
      .catch(() => undefined);
    await pending.client.stop().catch(() => undefined);
    this.#host.clearConnectionState();
  }

  /**
   * Brings a Codex client up to the point where a sign-in can start, and hands it to `run`.
   *
   * Returns null when the client turned out to be signed in already: the account was activated and
   * there is no login to start. Both sign-in shapes share this because everything before the
   * `account/login/start` call - the CLI, the handshake, the account already on this computer - and
   * everything the failure path has to undo is the same for a browser hand-off and for a code.
   */
  async #withLoginClient<T>(run: (client: AgentClient, cli: CodexCliInfo) => Promise<T>): Promise<T | null> {
    let client: AgentClient | null = null;
    let cli: CodexCliInfo | null = null;
    this.#host.setConnecting();

    try {
      cli = await resolveCodexCli({ bundledExecutable: this.#host.bundledExecutable() });
      client = this.#host.createClient(cli);
      client.start();
      await client.request(
        "initialize",
        {
          clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
          capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
        },
        decodeRecordResponse,
      );
      client.notify("initialized");

      if (!this.#host.hasActiveClient()) {
        const existingAccount = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult);
        if (existingAccount.account?.type === "chatgpt") {
          await this.#host.activate(client, cli, existingAccount.account);
          return null;
        }
      }

      return await run(client, cli);
    } catch (error) {
      if (client && this.#pending?.client !== client && !this.#host.hasActiveClient(client)) {
        await client.stop().catch(() => undefined);
      }
      if (!this.#pending && this.#host.isConnecting()) {
        this.#host.setFailure(error, cli?.version);
      }
      throw error;
    }
  }

  /**
   * Holds a started login open until the provider reports it finished, or until it times out.
   *
   * The deadline is OpenBot's, not the provider's. The code flow counts down to the same moment on
   * screen, so the number the user reads is the one this timer acts on.
   */
  #track(client: AgentClient, cli: CodexCliInfo, loginId: string): PendingCodexLogin {
    let pending: PendingCodexLogin;
    const timer = setTimeout(() => {
      void this.cancel("ChatGPT connection timed out. Try again.", pending);
    }, CODEX_LOGIN_TIMEOUT_MS);
    timer.unref?.();
    pending = { client, cli, loginId, timer, completing: false };
    this.#pending = pending;
    recordRestartActivity();
    client.once("exit", () => {
      if (this.#pending?.client === client) {
        void this.#fail(this.#pending, "ChatGPT connection stopped. Try again.");
      }
    });
    return pending;
  }

  async #fail(pending: PendingCodexLogin, message: string): Promise<void> {
    if (this.#pending !== pending) return;
    clearTimeout(pending.timer);
    this.#pending = null;
    await pending.client.stop().catch(() => undefined);
    this.#host.setFailure(new Error(message), pending.cli.version);
  }
}
