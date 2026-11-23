import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import type { McpKeyFlow } from "@openbot/contracts/mcp-connect-flows";
import { Button, Text } from "@openbot/ui";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import type { MarketplacePluginApp } from "@openbot/ui/features/settings/marketplace-plugins";
import { holdFlag } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { createPluginAppConfig } from "../src/features/settings/marketplace-plugin-catalog";
import { STORY_MARKETPLACE_PLUGINS } from "../src/preview/fixtures";

function app(slug: string): MarketplacePluginApp {
  const plugin = STORY_MARKETPLACE_PLUGINS.find((entry) => entry.slug === slug);
  const found = plugin?.apps[0];
  if (!found) throw new Error(`The story fixtures must carry the ${slug} plugin with an app.`);
  return found;
}

export const RESEND = app("resend");
export const LINEAR = app("linear");
export const AAVE = app("aave");

export function subjectFor(entry: MarketplacePluginApp): McpConnectSubject {
  return { name: entry.name, iconUrl: entry.iconUrl, config: createPluginAppConfig(entry) };
}

export function keyFlowFor(entry: MarketplacePluginApp): McpKeyFlow {
  const found = (entry.server.auth ?? []).find((one): one is McpKeyFlow => one.kind === "key");
  if (!found) throw new Error(`${entry.name} must declare a key flow.`);
  return found;
}

const GOOD_KEY = "good-key";

export type ConnectOutcome = "connects" | "refuses" | "unreachable" | "never answers";

export const CONNECT_OUTCOMES: ConnectOutcome[] = ["connects", "refuses", "unreachable", "never answers"];

export function connectAs(outcome: ConnectOutcome, name: string) {
  return async (config: McpServerConfig): Promise<McpTestResult> => {
    if (outcome === "never answers") return new Promise<McpTestResult>(() => {});
    if (outcome === "unreachable") throw new Error(`${name} did not answer at that address.`);
    const sent = (config.transport === "stdio" ? config.env[0]?.value : config.headers[0]?.value) ?? "";
    if (outcome === "refuses" || (sent !== "" && !sent.endsWith(GOOD_KEY)))
      return { toolCount: 0, error: `${name} refused the credential: 401 Unauthorized.` };
    return { toolCount: 14, error: null };
  };
}

export const CONNECT_PARAMETERS = {
  layout: "fullscreen",
  a11y: { test: "error" },
  viewport: {
    options: {
      connectDesktop: { name: "Connect — 1120 × 760", styles: { width: "1120px", height: "760px" } },
      connectNarrow: { name: "Connect — 420 × 760", styles: { width: "420px", height: "760px" } },
    },
  },
} as const;

export const CONNECT_GLOBALS = { viewport: { value: "connectDesktop", isRotated: false } } as const;

export function ConnectStage(props: {
  connected: string | null;
  openLabel: string;
  onOpen: () => void;
  children: JSX.Element;
}) {
  onCleanup(holdFlag(document.body, "skills-marketplace"));
  return (
    <main class="foundation-story skills-marketplace">
      <div class="foundation-story-row">
        <Button type="button" variant="secondary" onClick={props.onOpen}>
          {props.openLabel}
        </Button>
        <Text as="span" tone="muted">
          <Show when={props.connected} fallback="Not connected.">
            {(report) => report()}
          </Show>
        </Text>
      </div>
      {props.children}
    </main>
  );
}

export function createConnectStage() {
  const [open, setOpen] = createSignal(true);
  const [connected, setConnected] = createSignal<string | null>(null);
  return {
    open,
    connected,
    reopen() {
      setConnected(null);
      setOpen(true);
    },
    close: () => setOpen(false),
    onConnected(config: McpServerConfig) {
      const credential = config.transport === "stdio" ? config.env[0]?.value : config.headers[0]?.value;
      setConnected(`Connected. ${credential ? `Credential sent: ${credential}` : "No credential was needed."}`);
      setOpen(false);
    },
  };
}
