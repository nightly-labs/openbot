/**
 * The stage both connect dialogs are reviewed on.
 *
 * One story each, driven by controls, rather than a story per state: the dialog's states are what a
 * server answers with, so answering differently is the whole difference between them. The connection
 * reads the configuration it is given - a wrong key fails, no key passes where none is asked for -
 * so the header and environment writes are under review here as much as the layout.
 *
 * A sign-in has no separate answer to give here. The browser round trip belongs to the bridge the
 * listing installs, behind the same connect attempt, so "never answers" is what waiting looks like.
 */

import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import { Button, Text } from "@openbot/ui";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import type { MarketplacePluginApp } from "@openbot/ui/features/settings/marketplace-plugins";
import type { McpKeyFlow } from "@openbot/ui/features/settings/mcp-connect-auth";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { createPluginAppConfig } from "../src/features/settings/marketplace-plugin-catalog";
import { STORY_MARKETPLACE_PLUGINS } from "../src/preview/fixtures";

function app(slug: string): MarketplacePluginApp {
  const plugin = STORY_MARKETPLACE_PLUGINS.find((entry) => entry.slug === slug);
  const found = plugin?.apps[0];
  if (!found) throw new Error(`The story fixtures must carry the ${slug} plugin with an app.`);
  return found;
}

/** Figma asks for a token; Linear signs in and also issues keys; Aave asks for nothing. */
export const FIGMA = app("figma");
export const LINEAR = app("linear");
export const AAVE = app("aave");

/** The subject the plugin page hands over: the listing's app, as the configuration it installs as. */
export function subjectFor(entry: MarketplacePluginApp): McpConnectSubject {
  return { name: entry.name, iconUrl: entry.iconUrl, config: createPluginAppConfig(entry) };
}

/** The key flow the listing declares, which the caller picked before opening the key dialog. */
export function keyFlowFor(entry: MarketplacePluginApp): McpKeyFlow {
  const found = (entry.server.auth ?? []).find((one): one is McpKeyFlow => one.kind === "key");
  if (!found) throw new Error(`${entry.name} must declare a key flow.`);
  return found;
}

/** The key the story server accepts. Anything else is a key the server refuses. */
const GOOD_KEY = "good-key";

/** What the server does with this attempt. Every state of the dialog is one of these answers. */
export type ConnectOutcome = "connects" | "refuses" | "unreachable" | "never answers";

export const CONNECT_OUTCOMES: ConnectOutcome[] = ["connects", "refuses", "unreachable", "never answers"];

/**
 * A server that reads the credential it was sent, and answers the way the control says. The key goes
 * into a header over http and into the environment over a command, so both are read back here.
 */
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

/**
 * What the dialog opens over and closes back to: the marketplace surface it really sits on, with the
 * page's own report of the connection. A connection that works closes the dialog and is read here,
 * which is the whole reason the dialog says nothing about it.
 */
export function ConnectStage(props: {
  /** What the page reports once a connection worked, or null while there is none. */
  connected: string | null;
  openLabel: string;
  onOpen: () => void;
  children: JSX.Element;
}) {
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

/** Holds what the page knows, so a story only says how the server answers. */
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
