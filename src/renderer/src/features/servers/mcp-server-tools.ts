import type { McpSignInPageSource, McpSignInRelaySource } from "@openbot/ui/features/settings/McpSignInPage";
import { useText } from "@openbot/ui/text";
import type { McpPanelSignInApp } from "./McpSignInAppSection";
import {
  isMcpSignInCancelled,
  isMcpSignInOnHost,
  type McpServerConfig,
  type McpSignInState,
  type McpTestResult,
  type McpTestState,
  mcpFailureKind,
  mcpTestMessage,
} from "./mcp-servers";

/**
 * What the custom MCP server form and controls of the Marketplace call. The Marketplace controller
 * builds it for the server on screen: this computer, or a joined server.
 */
export interface McpServerTools {
  servers: () => readonly McpServerConfig[];
  /** The host's sign-in state, by row id: whether it holds a sign-in, and whether one was lost. */
  signIns: () => Record<string, McpSignInState>;
  /** Stores the row, and gives it back as the host stored it. */
  save: (config: McpServerConfig) => Promise<McpServerConfig>;
  /** Tests a config, saved or not. Nothing is stored by asking. */
  test: (config: McpServerConfig) => Promise<McpTestResult>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /**
   * One sentence about the managed runtime a STDIO server is started with, or null. It is what the
   * download on this computer is doing now; a joined server holds its own runtime.
   */
  toolRuntimeNote: () => string | null;
  /** Browser sign-in for http servers. Absent when neither this computer nor the host can sign in here. */
  signIn: () => McpServerSignIn | undefined;
  /** A row to sign in to as soon as its page shows: the user pressed Sign in on an agent's card. */
  signInRequest: () => string | null;
  /** Called once the page started the requested sign-in, so it does not start again. */
  endSignInRequest: () => void;
}

export interface McpServerSignIn {
  /** Opens the browser when the server asks, and answers once it came back and the server took the token. */
  start: (config: McpServerConfig) => Promise<McpTestResult>;
  /** Stops the wait for the browser; the pending `start` then answers that it was cancelled. */
  cancel: (url: string) => Promise<void>;
  signOut: (id: string) => Promise<void>;
  /**
   * A joined server that relays its sign-ins (`sign-in-relay-v1`): the page opens in this computer's
   * browser. Absent when this computer signs in.
   */
  relay?: McpServerRelay | undefined;
  /**
   * A relaying joined server that opens a sign-in page in its own browser tab, for a page that only
   * the host can reach (`mcp-sign-in-v1`, `browser-view`). Absent when this client cannot show it.
   */
  hostTab?: McpServerHostTab | undefined;
  /** A pre-registered OAuth app for a server without client registration. Absent when the host has none. */
  app?: McpPanelSignInApp | undefined;
}

interface McpServerRelay {
  hostName: string;
  /** The relayed sign-in page of the address it signs in to, while it waits. */
  page: (url: string) => McpSignInRelaySource | undefined;
  /** Opens the page in the user's browser. Nothing opens it before the user saw its host name and asked. */
  open: (url: string) => Promise<void>;
  /** Sends the address that the browser shows at the end of the sign-in. */
  paste: (url: string, address: string) => Promise<void>;
}

interface McpServerHostTab {
  hostName: string;
  /** The host tab with the sign-in page of the address it signs in to, while it waits. */
  page: (url: string) => McpSignInPageSource | undefined;
}

/** A test or a sign-in that has answered. */
export type SettledTest = Exclude<McpTestState, { status: "testing" } | { status: "signing-in" }>;

/** The test and sign-in answers of the form and the controls, read the same way. */
export function useMcpRuns(tools: () => McpServerTools) {
  const { t, sourceText, errorMessage } = useText();

  /** A host tells every caller to sign in on the host; a client that can sign in to it says Sign in instead. */
  function failureText(error: string): string {
    return tools().signIn() && isMcpSignInOnHost(error) ? t("error.backend.mcpSignInRequired") : sourceText(error);
  }

  /** Read from the English main sent, before it is translated: its key names the failure kind. */
  function settled(result: McpTestResult): SettledTest {
    if (result.error) return { status: "failed", error: failureText(result.error), kind: mcpFailureKind(result.error) };
    return { status: "passed", toolCount: result.toolCount };
  }

  function thrown(error: unknown): SettledTest {
    if (!(error instanceof Error)) return { status: "failed", error: t("mcp.panel.noAnswer"), kind: "other" };
    return {
      status: "failed",
      error: errorMessage(error, t("mcp.panel.noAnswer")),
      kind: mcpFailureKind(error.message),
    };
  }

  /** Tests run without a busy latch, so a slow server never blocks a save. */
  async function runTest(config: McpServerConfig): Promise<SettledTest> {
    try {
      return settled(await tools().test(config));
    } catch (error) {
      return thrown(error);
    }
  }

  /** A sign-in, read as a test is. `null` when the user cancelled it: that is not a failure to show. */
  async function runSignIn(config: McpServerConfig): Promise<SettledTest | null> {
    const signIn = tools().signIn();
    if (!signIn) return null;
    try {
      const result = await signIn.start(config);
      return result.error && isMcpSignInCancelled(result.error) ? null : settled(result);
    } catch (error) {
      return thrown(error);
    }
  }

  /** Sign in is offered for an http server, where this computer or the joined host can sign in. */
  const canSignIn = (config: McpServerConfig) => Boolean(tools().signIn()) && config.transport === "http";

  // A relayed sign-in opens its page in this computer's browser, so the message names no host.
  const testMessage = (test: McpTestState) => mcpTestMessage(test, t);

  return { runTest, runSignIn, canSignIn, testMessage };
}

/** A failed test is the only one that reads as an error; a pass is a plain, quiet sentence. */
export function mcpTestTone(test: McpTestState): "danger" | "success" | "muted" {
  if (test.status === "failed") return "danger";
  return test.status === "passed" ? "success" : "muted";
}

/** A server that asked for a sign-in: the page offers Sign in beside the sentence. */
export function asksForSignIn(test: McpTestState): boolean {
  return test.status === "failed" && test.kind === "sign-in";
}
