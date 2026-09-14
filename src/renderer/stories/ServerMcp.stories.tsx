import { createSignal } from "solid-js";
import { expect, fireEvent, fn, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { McpServerEntry } from "../src/features/servers/mcp-servers";
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
  const [servers, setServers] = createSignal<McpServerEntry[]>(props.mcpServers ?? []);

  return (
    <ServerSettingsModal
      {...props}
      mcpServers={servers()}
      onSaveMcpServer={async (config) => {
        await props.onSaveMcpServer?.(config);
        setServers((current) => {
          const saved = current.find((entry) => entry.config.id === config.id);
          const entry: McpServerEntry = {
            config,
            state: config.enabled ? "connected" : "disabled",
            toolCount: saved?.toolCount ?? 0,
            error: null,
          };
          return saved ? current.map((item) => (item.config.id === config.id ? entry : item)) : [...current, entry];
        });
      }}
      onRemoveMcpServer={async (id) => {
        await props.onRemoveMcpServer?.(id);
        setServers((current) => current.filter((entry) => entry.config.id !== id));
      }}
      onSetMcpServerEnabled={async (id, enabled) => {
        await props.onSetMcpServerEnabled?.(id, enabled);
        setServers((current) =>
          current.map((entry) =>
            entry.config.id === id
              ? {
                  ...entry,
                  config: { ...entry.config, enabled },
                  state: enabled ? (entry.state === "disabled" ? "connected" : entry.state) : "disabled",
                }
              : entry,
          ),
        );
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

export const McpList: Story = {
  play: async ({ userEvent }) => {
    const body = await openMcp(userEvent);
    await expectVisible(await body.findByText("Connected · 12 tools"));
    await expectVisible(body.getByText("Connected · 1 tool"));
    await expectVisible(body.getByText("Disabled"));
    await expectVisible(body.getByText("The command exited before it answered the handshake."));
    await expect(body.getByRole("switch", { name: "Enable Figma" })).not.toBeChecked();
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
    await enter(body.getByRole("textbox", { name: "Command to launch" }), "openai-dev-mcp serve-sqlite");
    await enter(body.getByRole("textbox", { name: "Argument 1" }), "--database");
    await userEvent.click(body.getByRole("button", { name: "Add argument" }));
    await enter(await body.findByRole("textbox", { name: "Argument 2" }), "./openbot.db");
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
        command: "openai-dev-mcp serve-sqlite",
        args: ["--database", "./openbot.db"],
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
    await expect(body.getByRole("textbox", { name: "Command to launch" })).toHaveValue("openai-dev-mcp serve-sqlite");
    await expect(body.getByRole("textbox", { name: "Argument 2" })).toHaveValue("./openbot.db");
    await expect(body.getByRole("textbox", { name: "Environment variable 1 key" })).toHaveValue("SQLITE_READONLY");
  },
};

/** The save bar only appears once the form holds a change, so this one types the command first. */
export const ValidationErrors: Story = {
  play: async ({ userEvent }) => {
    const body = await openForm(userEvent);
    await expect(body.queryByRole("button", { name: "Save" })).toBeNull();
    await enter(body.getByRole("textbox", { name: "Command to launch" }), "openai-dev-mcp serve-sqlite");
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
    await enter(body.getByRole("textbox", { name: "Command to launch" }), "openai-dev-mcp serve-sqlite");
    await enter(body.getByRole("textbox", { name: "Argument 1" }), "--database");
    await enter(body.getByRole("textbox", { name: "Environment variable 1 key" }), "SQLITE_READONLY");
    await enter(body.getByRole("textbox", { name: "Environment variable 1 value" }), "1");
    await expectVisible(body.getByRole("button", { name: "MCP" }));
  },
};
