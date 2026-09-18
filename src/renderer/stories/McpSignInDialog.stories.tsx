/**
 * The connect step that leaves the app: the server's own page asks, and the dialog only learns that
 * the sign-in finished and whether the grant connects.
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
  signInAs,
  subjectFor,
} from "./mcp-connect-stage";

interface SignInPlaygroundProps {
  /** What Linear answers once the grant reaches it. */
  outcome: ConnectOutcome;
  /** The user closed the sign-in window without finishing. */
  signInCancelled: boolean;
  /** The browser has the user and has not come back yet. */
  waitingForTheBrowser: boolean;
}

function SignInPlayground(props: SignInPlaygroundProps) {
  const stage = createConnectStage();
  const subject = subjectFor(LINEAR);
  return (
    <ConnectStage connected={stage.connected()} openLabel="Connect Linear" onOpen={stage.reopen}>
      <McpSignInDialog
        open={stage.open()}
        subject={subject}
        onSignIn={signInAs(props.signInCancelled, props.waitingForTheBrowser)}
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
  args: { outcome: "connects", signInCancelled: false, waitingForTheBrowser: false },
  argTypes: {
    outcome: { control: "select", options: CONNECT_OUTCOMES },
    signInCancelled: { control: "boolean" },
    waitingForTheBrowser: { control: "boolean" },
  },
  parameters: CONNECT_PARAMETERS,
  globals: CONNECT_GLOBALS,
} satisfies Meta<typeof SignInPlayground>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
