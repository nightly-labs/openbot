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
  mcpSignInAddress,
  mcpTestMessage,
} from "./mcp-servers";

export interface McpServerTools {
  servers: () => readonly McpServerConfig[];
  signIns: () => Record<string, McpSignInState>;
  save: (config: McpServerConfig) => Promise<McpServerConfig>;
  test: (config: McpServerConfig) => Promise<McpTestResult>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  toolRuntimeNote: () => string | null;
  signIn: () => McpServerSignIn | undefined;
  signInRequest: () => string | null;
  endSignInRequest: () => void;
}

export interface McpServerSignIn {
  start: (config: McpServerConfig) => Promise<McpTestResult>;
  cancel: (url: string) => Promise<void>;
  signOut: (id: string) => Promise<void>;
  relay?: McpServerRelay | undefined;
  hostTab?: McpServerHostTab | undefined;
  app?: McpPanelSignInApp | undefined;
}

interface McpServerRelay {
  hostName: string;
  page: (url: string) => McpSignInRelaySource | undefined;
  open: (url: string) => Promise<void>;
  paste: (url: string, address: string) => Promise<void>;
}

interface McpServerHostTab {
  hostName: string;
  page: (url: string) => McpSignInPageSource | undefined;
}

export type SettledTest = Exclude<McpTestState, { status: "testing" } | { status: "signing-in" }>;

export function useMcpRuns(tools: () => McpServerTools) {
  const { t, sourceText, errorMessage } = useText();

  function failureText(error: string): string {
    return tools().signIn() && isMcpSignInOnHost(error) ? t("error.backend.mcpSignInRequired") : sourceText(error);
  }

  function settled(result: McpTestResult): SettledTest {
    if (result.error) {
      const address = mcpSignInAddress(result.error);
      return {
        status: "failed",
        error: failureText(result.error),
        kind: mcpFailureKind(result.error),
        ...(address ? { address } : {}),
      };
    }
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

  async function runTest(config: McpServerConfig): Promise<SettledTest> {
    try {
      return settled(await tools().test(config));
    } catch (error) {
      return thrown(error);
    }
  }

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

  const canSignIn = (config: McpServerConfig) => Boolean(tools().signIn()) && config.transport === "http";

  const testMessage = (test: McpTestState) => mcpTestMessage(test, t);

  return { runTest, runSignIn, canSignIn, testMessage };
}

export function mcpTestTone(test: McpTestState): "danger" | "success" | "muted" {
  if (test.status === "failed") return "danger";
  return test.status === "passed" ? "success" : "muted";
}

export function asksForSignIn(test: McpTestState): boolean {
  return test.status === "failed" && test.kind === "sign-in";
}
