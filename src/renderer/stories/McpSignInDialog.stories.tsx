/**
 * The connect step that leaves the app: the server's own page asks, and the dialog only learns
 * whether the connection that follows works.
 *
 * One story, with the server's answer on a control. A connection that works closes the dialog, and
 * the stage behind it reports it - so the story shows the hand-off as well as the dialog.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { McpSignInDialog } from "../src/features/settings/McpSignInDialog";
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

interface SignInPlaygroundProps {
  /** What Linear answers once the sign-in is done. "never answers" is the wait for the browser. */
  outcome: ConnectOutcome;
}

function SignInPlayground(props: SignInPlaygroundProps) {
  const stage = createConnectStage();
  const subject = subjectFor(LINEAR);
  return (
    <ConnectStage connected={stage.connected()} openLabel="Connect Linear" onOpen={stage.reopen}>
      <McpSignInDialog
        open={stage.open()}
        subject={subject}
        onTest={connectAs(props.outcome, subject.name)}
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
