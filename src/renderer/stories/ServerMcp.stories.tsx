import { createSignal } from "solid-js";
import { expect, fireEvent, fn, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { McpServerConfig } from "../src/features/servers/mcp-servers";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import {
  STORY_HOST_STATUS,
  STORY_INVITES,
  STORY_MCP_SERVERS,
  STORY_PRESENCE,
  STORY_SERVERS,
} from "../src/preview/fixtures";

/**
 * Story args never change, so the panel would answer a switch with the same row. This owner keeps
 * the list in a signal and still calls the spy args, which is what the play functions assert on.
 */
function McpSettingsHost(props: ServerSettingsModalProps) {
  const [servers, setServers] = createSignal<McpServerConfig[]>(props.mcpServers ?? []);

  return (
    <ServerSettingsModal
      {...props}
      mcpServers={servers()}
      onSaveMcpServer={async (config) => {
        await props.onSaveMcpServer?.(config);
        setServers((current) =>
          current.some((server) => server.id === config.id)
            ? current.map((server) => (server.id === config.id ? config : server))
            : [...current, config],
        );
      }}
      onRemoveMcpServer={async (id) => {
        await props.onRemoveMcpServer?.(id);
        setServers((current) => current.filter((server) => server.id !== id));
      }}
      onSetMcpServerEnabled={async (id, enabled) => {
        await props.onSetMcpServerEnabled?.(id, enabled);
        setServers((current) => current.map((server) => (server.id === id ? { ...server, enabled } : server)));
      }}
    />
  );
}

const localServer = STORY_SERVERS.find((server) => server.kind === "local") ?? STORY_SERVERS[0];

const meta = {
  title: "Settings/ServerMcp",
  component: ServerSettingsModal,
  render: (args) => <McpSettingsHost {...args} />,
  args: {
    open: true,
    onOpenChange: fn(),
    platform: "darwin",
    server: localServer,
    hostStatus: STORY_HOST_STATUS,
    members: STORY_PRESENCE.members,
    invites: STORY_INVITES,
    loading: false,
    loadError: null,
    onRetry: fn(async () => undefined),
    onSaveIdentity: fn(async () => undefined),
    onSetPublished: fn(async () => undefined),
    onCreateInvite: fn(async (input) => ({
      id: "invite-story",
      inviteUrl: "https://team.example.com/invite/story",
      expiresAt: "2026-08-29T10:00:00.000Z",
      role: input.role,
      usedAt: null,
      email: input.email ?? null,
    })),
    onUpdateMember: fn(async () => undefined),
    onRemoveMember: fn(async () => undefined),
    onRevokeInvite: fn(async () => undefined),
    mcpServers: STORY_MCP_SERVERS,
    onSaveMcpServer: fn(async () => undefined),
    onRemoveMcpServer: fn(async () => undefined),
    onSetMcpServerEnabled: fn(async () => undefined),
    // A test answers for the configuration given, so the one whose command is not on this machine
    // fails even though every other field is filled in.
    onTestMcpServer: fn(async (config: McpServerConfig) =>
      config.command.startsWith("bunx")
        ? { toolCount: 0, error: "Command not found: bunx" }
        : { toolCount: 12, error: null },
    ),
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        serverDesktop: { name: "Server settings — 1200 × 820", styles: { width: "1200px", height: "820px" } },
        serverMinimum: { name: "Server settings — 960 × 640", styles: { width: "960px", height: "640px" } },
        serverMobile: { name: "Server settings — 640 × 720", styles: { width: "640px", height: "720px" } },
        serverNarrow: { name: "Server settings — 480 × 720", styles: { width: "480px", height: "720px" } },
      },
    },
  },
} satisfies Meta<typeof ServerSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every story starts on General, so each one opens the MCP section the way a user would. */
async function openMcp(userEvent: { click: (element: Element) => Promise<void> }) {
  const body = within(document.body);
  await body.findByRole("dialog", { name: "General" });
  await userEvent.click(body.getByRole("tab", { name: "MCP" }));
  return body;
}

async function openForm(userEvent: { click: (element: Element) => Promise<void> }) {
  const body = await openMcp(userEvent);
  await userEvent.click(body.getByRole("button", { name: "Connect a custom MCP" }));
  return body;
}

/**
 * Text entry goes through `fireEvent.input`, the way the other server settings stories do:
 * `userEvent.type` drops characters on these controlled inputs.
 */
async function enter(field: Element, value: string) {
  await fireEvent.input(field, { target: { value } });
}

/** The modal fades in, so an element can be in the document before it is visible. */
async function expectVisible(element: Element) {
  await waitFor(() => expect(element).toBeVisible());
}

/**
 * The rows report what the user set, not a connection: OpenBot connects only when the user asks for
 * a test, so a row that was never tested says only whether its tools are offered to the agents.
 */
export const McpList: Story = {
  play: async ({ userEvent }) => {
    const body = await openMcp(userEvent);
    await expectVisible(await body.findByText("Disabled"));
    await expect(body.getAllByText("Enabled")).toHaveLength(3);
    await expect(body.getByRole("switch", { name: "Enable Figma" })).not.toBeChecked();
  },
};

export const TestFromRowMenu: Story = {
  play: async ({ args, userEvent }) => {
    const body = await openMcp(userEvent);
    await userEvent.click(body.getByRole("button", { name: "Actions for Local SQLite" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "Test connection" }));
    await expectVisible(await body.findByText("Connected · 12 tools"));
    await expect(args.onTestMcpServer).toHaveBeenCalledWith(expect.objectContaining({ id: "mcp-sqlite" }));
  },
};

/** A failed test says why on the row, and the server stays exactly as it was. */
export const TestFails: Story = {
  play: async ({ args, userEvent }) => {
    const body = await openMcp(userEvent);
    await userEvent.click(body.getByRole("button", { name: "Actions for Playwright" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "Test connection" }));
    await expectVisible(await body.findByText("Command not found: bunx"));
    await expect(body.getByRole("switch", { name: "Enable Playwright" })).toBeChecked();
    await expect(args.onSetMcpServerEnabled).not.toHaveBeenCalled();
  },
};

/** The form tests the draft on screen, which is the answer a user wants before they save it. */
export const TestDraftBeforeSaving: Story = {
  play: async ({ args, userEvent }) => {
    const body = await openForm(userEvent);
    await enter(body.getByRole("textbox", { name: "Name" }), "Local SQLite");
    await enter(body.getByRole("textbox", { name: "Command to launch" }), "openai-dev-mcp");
    await userEvent.click(body.getByRole("button", { name: "Test connection" }));
    await expectVisible(await body.findByText("Connected · 12 tools"));
    await expect(args.onTestMcpServer).toHaveBeenCalledWith(expect.objectContaining({ id: "", name: "Local SQLite" }));
    await expect(args.onSaveMcpServer).not.toHaveBeenCalled();
  },
};

export const McpEmpty: Story = {
  args: { mcpServers: [] },
  play: async ({ userEvent }) => {
    const body = await openMcp(userEvent);
    await expectVisible(await body.findByText("No MCP servers yet."));
    await expectVisible(body.getByRole("button", { name: "Connect a custom MCP" }));
  },
};

/** A read that failed, which is not the same statement as a server that holds no MCP servers. */
export const McpLoadFailed: Story = {
  args: {
    mcpServers: [],
    mcpLoadError: "The MCP servers could not load.",
    onRetryMcpServers: fn(),
  },
  play: async ({ args, userEvent }) => {
    const body = await openMcp(userEvent);
    await expectVisible(await body.findByText("The MCP servers could not load."));
    await expect(body.queryByText("No MCP servers yet.")).toBeNull();
    await userEvent.click(body.getByRole("button", { name: "Retry" }));
    await expect(args.onRetryMcpServers).toHaveBeenCalled();
  },
};

export const ToggleServer: Story = {
  play: async ({ args, userEvent }) => {
    const body = await openMcp(userEvent);
    await userEvent.click(body.getByRole("switch", { name: "Enable Linear" }));
    await expect(args.onSetMcpServerEnabled).toHaveBeenCalledWith("mcp-linear", false);
  },
};

export const AddCustomStdio: Story = {
  play: async ({ args, userEvent }) => {
    const body = await openForm(userEvent);
    await enter(body.getByRole("textbox", { name: "Name" }), "Local SQLite");
    await enter(body.getByRole("textbox", { name: "Command to launch" }), "openai-dev-mcp");
    // The command names the program alone. Each word after it is an argument of its own, which is
    // what the launch makes of this configuration.
    await enter(body.getByRole("textbox", { name: "Argument 1" }), "serve-sqlite");
    await userEvent.click(body.getByRole("button", { name: "Add argument" }));
    await enter(await body.findByRole("textbox", { name: "Argument 2" }), "--database");
    await userEvent.click(body.getByRole("button", { name: "Add argument" }));
    await enter(await body.findByRole("textbox", { name: "Argument 3" }), "./openbot.db");
    await enter(body.getByRole("textbox", { name: "Environment variable 1 key" }), "SQLITE_READONLY");
    await enter(body.getByRole("textbox", { name: "Environment variable 1 value" }), "1");
    await enter(body.getByRole("textbox", { name: "Working directory" }), "~/code");

    const save = await body.findByRole("button", { name: "Save" });
    await expect(save).toBeEnabled();
    await userEvent.click(save);
    await expect(args.onSaveMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        // A new server is saved with no id: the store mints it. A client-minted id reads to the
        // store as an edit of a row that is not there, and every add fails.
        id: "",
        name: "Local SQLite",
        transport: "stdio",
        command: "openai-dev-mcp",
        args: ["serve-sqlite", "--database", "./openbot.db"],
        env: [{ key: "SQLITE_READONLY", value: "1" }],
        workingDirectory: "~/code",
        url: "",
      }),
    );
  },
};

export const AddCustomHttp: Story = {
  play: async ({ userEvent }) => {
    const body = await openForm(userEvent);
    await userEvent.click(body.getByRole("tab", { name: "Streamable HTTP" }));
    const url = await body.findByRole("textbox", { name: "Server URL" });
    await expectVisible(url);
    await enter(url, "https://mcp.linear.app/mcp");
    await enter(body.getByRole("textbox", { name: "Header 1 key" }), "Authorization");

    // The name is still empty, so the first save attempt reports it and blocks the button.
    await userEvent.click(await body.findByRole("button", { name: "Save" }));
    await expectVisible(await body.findByText("Enter a name for this MCP server."));
    await expect(body.getByRole("button", { name: "Save" })).toBeDisabled();

    await enter(body.getByRole("textbox", { name: "Name" }), "Linear");
    await waitFor(() => expect(body.getByRole("button", { name: "Save" })).toBeEnabled());
  },
};

export const EditExisting: Story = {
  play: async ({ userEvent }) => {
    const body = await openMcp(userEvent);
    await userEvent.click(body.getByRole("button", { name: "Actions for Local SQLite" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "Edit" }));
    await expect(await body.findByRole("textbox", { name: "Name" })).toHaveValue("Local SQLite");
    await expect(body.getByRole("textbox", { name: "Command to launch" })).toHaveValue("openai-dev-mcp");
    await expect(body.getByRole("textbox", { name: "Argument 1" })).toHaveValue("serve-sqlite");
    await expect(body.getByRole("textbox", { name: "Argument 3" })).toHaveValue("./openbot.db");
    await expect(body.getByRole("textbox", { name: "Environment variable 1 key" })).toHaveValue("SQLITE_READONLY");
  },
};

/** The save bar only appears once the form holds a change, so this one types the command first. */
export const ValidationErrors: Story = {
  play: async ({ userEvent }) => {
    const body = await openForm(userEvent);
    await expect(body.queryByRole("button", { name: "Save" })).toBeNull();
    await enter(body.getByRole("textbox", { name: "Command to launch" }), "openai-dev-mcp");
    await userEvent.click(await body.findByRole("button", { name: "Save" }));
    await expectVisible(await body.findByText("Enter a name for this MCP server."));
    await expect(body.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

/** Reset puts the form back to the stored configuration and takes the save bar away with it. */
export const ResetForm: Story = {
  play: async ({ userEvent }) => {
    const body = await openMcp(userEvent);
    await userEvent.click(body.getByRole("button", { name: "Actions for Local SQLite" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "Edit" }));
    const name = await body.findByRole("textbox", { name: "Name" });
    await enter(name, "Local SQLite copy");
    await expectVisible(await body.findByText("Changes not saved"));
    await userEvent.click(body.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(name).toHaveValue("Local SQLite"));
    await waitFor(() => expect(body.queryByRole("button", { name: "Reset" })).toBeNull());
  },
};

export const RemoveConfirmation: Story = {
  play: async ({ args, userEvent }) => {
    const body = await openMcp(userEvent);
    await userEvent.click(body.getByRole("button", { name: "Actions for Playwright" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "Remove" }));
    await expectVisible(await body.findByRole("alertdialog", { name: "Remove Playwright?" }));
    await userEvent.click(body.getByRole("button", { name: "Remove MCP server" }));
    await expect(args.onRemoveMcpServer).toHaveBeenCalledWith("mcp-playwright");
  },
};

export const McpNarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: "serverNarrow" } },
  play: McpList.play,
};

/** The repeatable rows are the risk at this width, so this one stops in the form instead of saving. */
export const McpFormNarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: "serverMobile" } },
  play: async ({ userEvent }) => {
    const body = await openForm(userEvent);
    await enter(body.getByRole("textbox", { name: "Name" }), "Local SQLite");
    await enter(body.getByRole("textbox", { name: "Command to launch" }), "openai-dev-mcp");
    await enter(body.getByRole("textbox", { name: "Argument 1" }), "--database");
    await enter(body.getByRole("textbox", { name: "Environment variable 1 key" }), "SQLITE_READONLY");
    await enter(body.getByRole("textbox", { name: "Environment variable 1 value" }), "1");
    await expectVisible(body.getByRole("button", { name: "MCP" }));
  },
};
