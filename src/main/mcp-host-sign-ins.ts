// MCP sign-ins that an administrator starts on this host from another computer (`mcp-sign-in-v1`, and
// `sign-in-relay-v1` through `SignInRelayHost`).

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
import { normalizeResource } from "../backend/mcp-oauth-provider";
import { HostSignInPages } from "./host-sign-in-pages";

/** The bound of an error on the wire, as `mcp-sign-in-v1` reads it. */
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

/**
 * A sign-in for an administrator who is not at this computer.
 *
 * The grant comes back to this host's loopback listener, and only a browser here can reach it. So the
 * page opens in a private tab of this host's browser, and the administrator signs in through the live
 * view of that tab. `start` returns at once; the client reads `status` until the sign-in ends. One
 * sign-in runs for each server address, as on this computer: a second start replaces the first.
 */
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

  /**
   * The same sign-in, with no tab: the page address waits in `relayPage` for the administrator's own
   * computer to open, and the grant comes back through `SignInRelayHost`.
   */
  startRelay(input: TestMcpServerInput) {
    return this.#pages.start(
      signInKey(input.config.url),
      (openPage) => this.#dependencies.service.signInMcpServer(input, openPage),
      resultOf,
      "relay",
    );
  }

  /** The page address of a relayed sign-in, and how it ended. */
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

  /** The sign-in app of one row (`mcp-sign-in-app-v1`). The next `start` uses it. */
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

/** The states as `mcp-sign-in-v1` states them: `signedIn` and nothing more. */
function onWire(states: readonly McpSignInState[]): McpSignInState[] {
  return states.map(({ mcpServerId, signedIn }) => ({ mcpServerId, signedIn }));
}

function signInKey(url: string): string {
  return normalizeResource(url) ?? url;
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
