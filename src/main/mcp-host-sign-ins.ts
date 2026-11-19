import type {
  McpSignInAppInput,
  McpSignInAppState,
  McpSignInState,
  McpSignInStatus,
  McpTestResult,
  SaveMcpSignInAppInput,
  SignOutMcpServerInput,
  TestMcpServerInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit, Option } from "effect";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import { mcpOAuthAccountKey } from "../backend/mcp-oauth-provider";
import { HostSignInPages } from "./host-sign-in-pages";

const ERROR_LIMIT = 2_000;

export interface McpHostSignInDependencies {
  service: Pick<
    AgentService,
    | "signInMcpServer"
    | "cancelMcpSignIn"
    | "signOutMcpServer"
    | "listMcpSignIns"
    | "mcpSignInApp"
    | "saveMcpSignInApp"
    | "removeMcpSignInApp"
  >;
  browser: Pick<BrowserHost, "openPrivate" | "privateTab" | "close">;
}

export class McpHostSignIns {
  readonly #dependencies: McpHostSignInDependencies;
  readonly #pages: HostSignInPages<string, McpTestResult>;

  constructor(dependencies: McpHostSignInDependencies) {
    this.#dependencies = dependencies;
    this.#pages = new HostSignInPages(dependencies.browser);
  }

  start(input: TestMcpServerInput) {
    return this.#pages.start(
      signInKey(input.config.url),
      (openPage) => this.#dependencies.service.signInMcpServer(input, openPage),
      resultOf,
    );
  }

  startRelay(input: TestMcpServerInput, deepLinkRedirectUrl?: string) {
    return this.#pages.start(
      signInKey(input.config.url),
      (openPage) => this.#dependencies.service.signInMcpServer(input, openPage, deepLinkRedirectUrl),
      resultOf,
      "relay",
    );
  }

  relayStatus(url: string): { pageUrl: string | null; result: McpTestResult | null } {
    const key = signInKey(url);
    return { pageUrl: this.#pages.pageUrl(key), result: this.status(url).result };
  }

  status(url: string): McpSignInStatus {
    return (
      this.#pages.status(signInKey(url)) ?? {
        tabId: null,
        result: { toolCount: 0, error: sourceText("error.backend.mcpSignInAbandonedGeneric") },
      }
    );
  }

  cancel(url: string): void {
    this.#dependencies.service.cancelMcpSignIn({ url });
  }

  signOut(input: SignOutMcpServerInput) {
    return this.#dependencies.service.signOutMcpServer(input).pipe(Effect.map(onWire));
  }

  list(): McpSignInState[] {
    return onWire(this.#dependencies.service.listMcpSignIns());
  }

  app(input: McpSignInAppInput): McpSignInAppState {
    return this.#dependencies.service.mcpSignInApp(input);
  }

  saveApp(input: SaveMcpSignInAppInput) {
    return this.#dependencies.service.saveMcpSignInApp(input);
  }

  removeApp(input: McpSignInAppInput) {
    return this.#dependencies.service.removeMcpSignInApp(input);
  }

  close() {
    return this.#pages.close();
  }
}

function onWire(states: readonly McpSignInState[]): McpSignInState[] {
  return states.map(({ mcpServerId, signedIn }) => ({ mcpServerId, signedIn }));
}

function signInKey(url: string): string {
  return mcpOAuthAccountKey(url) ?? url;
}

function resultOf(exit: Exit.Exit<McpTestResult, { cause: unknown }>): McpTestResult {
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findErrorOption(exit.cause);
  return { toolCount: 0, error: failureText(Option.isSome(failure) ? failure.value.cause : undefined) };
}

function failureText(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : sourceText("error.backend.mcpSignInAbandonedGeneric");
  return text.slice(0, ERROR_LIMIT);
}
