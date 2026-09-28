/**
 * The connect step for a server another app on this computer runs: the steps that turn it on in
 * that app, what the server can do, and one connect that proves it answers.
 *
 * The story reads the real Figma listing, so the steps and the note under review are the ones users
 * see. "unreachable" is the answer when the server is not on yet.
 */

import { McpLocalDialog } from "@openbot/ui/features/settings/McpLocalDialog";
import type { McpLocalFlow } from "@openbot/ui/features/settings/mcp-connect-auth";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MARKETPLACE_PLUGINS } from "../src/features/settings/marketplace-plugin-catalog";
import {
  CONNECT_GLOBALS,
  CONNECT_OUTCOMES,
  CONNECT_PARAMETERS,
  type ConnectOutcome,
  ConnectStage,
  connectAs,
  createConnectStage,
  subjectFor,
} from "./mcp-connect-stage";

function figmaListing() {
  const app = MARKETPLACE_PLUGINS.find((plugin) => plugin.slug === "figma")?.apps[0];
  const flow = app?.server.auth?.find((one): one is McpLocalFlow => one.kind === "local");
  if (!app || !flow) throw new Error("The catalog must carry the Figma plugin with a local flow.");
  return { subject: subjectFor(app), flow };
}

const { subject: FIGMA_SUBJECT, flow: FIGMA_FLOW } = figmaListing();

interface LocalPlaygroundProps {
  /** What the server answers once the dialog connects. */
  outcome: ConnectOutcome;
  /** The listing names the app's setup page, and the caller can open it. */
  showsTheSetupPage: boolean;
}

function LocalPlayground(props: LocalPlaygroundProps) {
  const stage = createConnectStage();
  return (
    <ConnectStage connected={stage.connected()} openLabel={`Connect ${FIGMA_SUBJECT.name}`} onOpen={stage.reopen}>
      <McpLocalDialog
        open={stage.open()}
        subject={FIGMA_SUBJECT}
        flow={FIGMA_FLOW}
        onTest={connectAs(props.outcome, FIGMA_SUBJECT.name)}
        onConnected={stage.onConnected}
        onCancel={stage.close}
        {...(props.showsTheSetupPage ? { onOpenUrl: fn() } : {})}
      />
    </ConnectStage>
  );
}

const meta = {
  title: "Settings/McpLocalDialog",
  component: LocalPlayground,
  args: { outcome: "connects", showsTheSetupPage: true },
  argTypes: {
    outcome: { control: "select", options: CONNECT_OUTCOMES },
    showsTheSetupPage: { control: "boolean" },
  },
  parameters: CONNECT_PARAMETERS,
  globals: CONNECT_GLOBALS,
} satisfies Meta<typeof LocalPlayground>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
