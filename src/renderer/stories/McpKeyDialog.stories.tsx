/**
 * The connect step that stays here: a credential from the server's own settings page, pasted and
 * proved before an agent is given the tools.
 *
 * One story, with the server and its answer on controls. `good-key` is the credential the story
 * server accepts; anything else is refused, so a refusal is a state the dialog reached.
 */

import { McpKeyDialog } from "@openbot/ui/features/settings/McpKeyDialog";
import type { McpKeyFlow } from "@openbot/ui/features/settings/mcp-connect-auth";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  AAVE,
  CONNECT_GLOBALS,
  CONNECT_OUTCOMES,
  CONNECT_PARAMETERS,
  type ConnectOutcome,
  ConnectStage,
  connectAs,
  createConnectStage,
  FIGMA,
  keyFlowFor,
  LINEAR,
  subjectFor,
} from "./mcp-connect-stage";

/** A local command instead of an address: the same flow, written to the environment. */
const POSTGRES = {
  subject: {
    name: "Postgres",
    iconUrl: null,
    config: {
      id: "",
      name: "postgres",
      transport: "stdio" as const,
      enabled: true,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "",
      headers: [],
    },
  },
  flow: {
    id: "credentials",
    kind: "key",
    label: "Credentials",
    fields: [
      {
        id: "url",
        label: "Connection string",
        env: "DATABASE_URL",
        placeholder: "postgres://…",
        hint: "The server reads with this and never writes.",
      },
      { id: "schema", label: "Schema password", env: "PGPASSWORD", placeholder: "Paste the password" },
    ],
  } satisfies McpKeyFlow,
};

/** A server that asks for nothing still comes through a connect step, so a dead one is found now. */
const NOTHING_ASKED: McpKeyFlow = { id: "none", kind: "key", label: "Connect", fields: [] };

/** One token, the key a server issues beside its sign-in, two values over a command, and none. */
const SERVERS = {
  figma: () => ({ subject: subjectFor(FIGMA), flow: keyFlowFor(FIGMA) }),
  linear: () => ({ subject: subjectFor(LINEAR), flow: keyFlowFor(LINEAR) }),
  postgres: () => POSTGRES,
  aave: () => ({ subject: subjectFor(AAVE), flow: NOTHING_ASKED }),
};

interface KeyPlaygroundProps {
  server: keyof typeof SERVERS;
  /** What the server answers once the credential reaches it. */
  outcome: ConnectOutcome;
  /** The listing names the page the key is made on, and the caller can open it. */
  showsTheKeyPage: boolean;
}

function KeyPlayground(props: KeyPlaygroundProps) {
  const stage = createConnectStage();
  const server = () => SERVERS[props.server]();
  return (
    <ConnectStage connected={stage.connected()} openLabel={`Connect ${server().subject.name}`} onOpen={stage.reopen}>
      <McpKeyDialog
        open={stage.open()}
        subject={server().subject}
        flow={server().flow}
        onTest={connectAs(props.outcome, server().subject.name)}
        onConnected={stage.onConnected}
        onCancel={stage.close}
        onOpenUrl={props.showsTheKeyPage ? fn() : undefined}
      />
    </ConnectStage>
  );
}

const meta = {
  title: "Settings/McpKeyDialog",
  component: KeyPlayground,
  args: { server: "figma", outcome: "connects", showsTheKeyPage: true },
  argTypes: {
    server: { control: "select", options: Object.keys(SERVERS) },
    outcome: { control: "select", options: CONNECT_OUTCOMES },
    showsTheKeyPage: { control: "boolean" },
  },
  parameters: CONNECT_PARAMETERS,
  globals: CONNECT_GLOBALS,
} satisfies Meta<typeof KeyPlayground>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
