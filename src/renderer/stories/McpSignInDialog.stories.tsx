/**
 * The connect step that leaves the app: the server's own page asks, and the dialog only learns
 * whether the connection that follows works.
 *
 * One story, with the server's answer on a control. A connection that works closes the dialog, and
 * the stage behind it reports it - so the story shows the hand-off as well as the dialog.
 */

import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { McpSignInDialog } from "@openbot/ui/features/settings/McpSignInDialog";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  CONNECT_GLOBALS,
  CONNECT_OUTCOMES,
  CONNECT_PARAMETERS,
  type ConnectOutcome,
  ConnectStage,
  connectAs,
  createConnectStage,
  LINEAR,
  subjectFor,
} from "./mcp-connect-stage";
import { createSignInHost } from "./mcp-sign-in-host";

interface SignInPlaygroundProps {
  /** What Linear answers once the sign-in is done. "never answers" is the wait for the browser. */
  outcome: ConnectOutcome;
  /**
   * A joined server that signs in with its own browser. The dialog then shows the host's page, and
   * Allow on it stands in for the sign-in that the host took.
   */
  hostName?: string;
}

function SignInPlayground(props: SignInPlaygroundProps) {
  const stage = createConnectStage();
  const subject = subjectFor(LINEAR);
  const host = createSignInHost();
  let waiting: ((result: McpTestResult) => void) | null = null;
  const finish = (result: McpTestResult) => {
    host.close(subject.config.url);
    waiting?.(result);
    waiting = null;
  };
  const test = (config: McpServerConfig): Promise<McpTestResult> => {
    if (!props.hostName) return connectAs(props.outcome, subject.name)(config);
    return new Promise((resolve) => {
      waiting = resolve;
      host.open(config.url, subject.name, () => finish({ toolCount: 14, error: null }));
    });
  };
  const page = () => {
    const tabId = host.pages[subject.config.url];
    return tabId ? { runtime: host.runtime, tabId, clipboard: true } : undefined;
  };
  return (
    <ConnectStage connected={stage.connected()} openLabel="Connect Linear" onOpen={stage.reopen}>
      <McpSignInDialog
        open={stage.open()}
        subject={subject}
        hostName={props.hostName}
        page={page()}
        onCancelSignIn={() => finish({ toolCount: 0, error: sourceText("error.backend.mcpSignInCancelled") })}
        onTest={test}
        onConnected={stage.onConnected}
        onCancel={stage.close}
      />
    </ConnectStage>
  );
}

const meta = {
  title: "Settings/McpSignInDialog",
  component: SignInPlayground,
  args: { outcome: "connects" },
  argTypes: { outcome: { control: "select", options: CONNECT_OUTCOMES } },
  parameters: CONNECT_PARAMETERS,
  globals: CONNECT_GLOBALS,
} satisfies Meta<typeof SignInPlayground>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Catalog sign-in for a joined server: the host's browser shows the page here, and that host keeps the grant. */
export const RemoteHost: Story = {
  args: { hostName: "OpenBot team" },
};
