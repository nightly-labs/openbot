import type {
  HostStatus,
  McpServerConfig,
  ProviderRuntimeStatus,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
} from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "../../components/ui";
import { mcpToolRuntimeNote as note } from "./mcp-servers";
import { ServerSettingsModal, type ServerSettingsModalProps } from "./ServerSettingsModal";

const localServer: ServerSummary = {
  id: "local",
  name: "Local",
  logoUrl: null,
  notificationsMuted: false,
  kind: "local",
  state: "online",
  apiUrl: null,
  remoteDesktopAvailable: false,
  role: null,
  active: true,
};

const remoteServer: ServerSummary = {
  id: "remote-1",
  name: "Studio Team",
  logoUrl: null,
  notificationsMuted: false,
  kind: "remote",
  state: "online",
  apiUrl: "https://studio.example.com",
  remoteDesktopAvailable: true,
  role: "admin",
  active: false,
};

const unconfiguredHost: HostStatus = {
  phase: "unconfigured",
  configured: false,
  enabledOnLaunch: false,
  serverId: null,
  serverName: null,
  logoUrl: null,
  apiUrl: null,
  apiOnline: false,
  remoteDesktopReady: false,
  remoteDesktopScreenRecordingDenied: false,
  remoteDesktopUnattended: false,
  remoteDesktopActiveSessions: 0,
  remoteDesktopMaxSessions: 4,
  message: null,
};

const configuredHost: HostStatus = {
  ...unconfiguredHost,
  phase: "online",
  configured: true,
  enabledOnLaunch: true,
  serverId: "local",
  serverName: "Local",
  apiUrl: "https://team.example.com",
  apiOnline: true,
};

const members: TeamPresenceMember[] = [
  {
    id: "owner-1",
    username: "owner@example.com",
    email: "owner@example.com",
    name: "Server Owner",
    role: "owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    disabled: false,
    online: true,
    typingAgentId: null,
  },
  {
    id: "alice-1",
    username: "alice",
    email: "alice@example.com",
    name: "Alice Chen",
    role: "member",
    createdAt: "2026-02-01T00:00:00.000Z",
    disabled: false,
    online: false,
    typingAgentId: null,
  },
];

const mcpServer: McpServerConfig = {
  id: "mcp-1",
  name: "Filesystem",
  transport: "stdio",
  enabled: true,
  command: "npx",
  args: [],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [],
};

function props(overrides: Partial<ServerSettingsModalProps> = {}): ServerSettingsModalProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    platform: "darwin",
    server: localServer,
    hostStatus: unconfiguredHost,
    members: [],
    invites: [],
    loading: false,
    loadError: null,
    onRetry: vi.fn(async () => undefined),
    onSaveIdentity: vi.fn(async () => undefined),
    onSetPublished: vi.fn(async () => undefined),
    onSetMuted: vi.fn(async () => undefined),
    onCreateInvite: vi.fn(async (input) => ({
      id: "invite-new",
      role: input.role,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      inviteUrl: "https://studio.example.com/invite/new",
      email: input.email ?? null,
      permanent: input.permanent ?? false,
      useCount: 0,
    })),
    onUpdateMember: vi.fn(async () => undefined),
    onRemoveMember: vi.fn(async () => undefined),
    onRevokeInvite: vi.fn(async () => undefined),
    onOpenScreenRecordingSettings: vi.fn(async () => undefined),
    onRecheckScreenRecording: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ServerSettingsModal", () => {
  it.each([true, false])("does not request an update for a compatible host with availability %s", async (ready) => {
    render(() => (
      <ServerSettingsModal
        {...props({
          server: {
            ...remoteServer,
            remoteDesktopAvailable: ready,
            compatibility: {
              localAppVersion: "0.5.0",
              hostAppVersion: "0.5.0",
              localProtocol: { minimum: 1, maximum: 3 },
              hostProtocol: { minimum: 1, maximum: 3 },
              negotiatedProtocol: 3,
              capabilities: ["remote-desktop"],
            },
          },
        })}
      />
    ));
    await fireEvent.click(screen.getByRole("tab", { name: "Remote desktop" }));
    expect(await screen.findByText(ready ? "Service available" : "Service not ready")).toBeInTheDocument();
    expect(screen.queryByText(/update required/iu)).not.toBeInTheDocument();
  });

  it.each(["client_update_required", "host_update_required"] as const)(
    "identifies the end that needs an update: %s",
    async (code) => {
      const message = code === "client_update_required" ? "Update this OpenBot app." : "Update OpenBot on the host.";
      render(() => (
        <ServerSettingsModal
          {...props({
            server: {
              ...remoteServer,
              state: "incompatible",
              remoteDesktopAvailable: false,
              issue: { code, message, retryable: true },
            },
          })}
        />
      ));
      await fireEvent.click(screen.getByRole("tab", { name: "Remote desktop" }));
      expect(
        await screen.findByText(code === "client_update_required" ? "Client update required" : "Host update required"),
      ).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
    },
  );

  // The member who is refused cannot fix this: the grant lives on the host, so the host owner is the
  // one who is told, and only after a member was actually refused.
  it.each([true, false])("offers the screen recording settings to a refused host: %s", async (denied) => {
    const onOpenScreenRecordingSettings = vi.fn(async () => undefined);
    render(() => (
      <ServerSettingsModal
        {...props({
          hostStatus: { ...configuredHost, remoteDesktopScreenRecordingDenied: denied },
          onOpenScreenRecordingSettings,
        })}
      />
    ));
    await fireEvent.click(screen.getByRole("tab", { name: "Remote desktop" }));

    const openSettings = screen.queryByRole("button", { name: "Open System Settings" });
    if (!denied) {
      expect(openSettings).not.toBeInTheDocument();
      return;
    }
    expect(await screen.findByText("OpenBot may not record this screen")).toBeInTheDocument();
    if (!openSettings) throw new Error("The settings action is missing.");
    await fireEvent.click(openSettings);
    await waitFor(() => expect(onOpenScreenRecordingSettings).toHaveBeenCalledOnce());
  });

  // Granting the permission is silent: without this the owner who gave it keeps reading that they
  // did not, because only another member's attempt could answer.
  it("reads the grant again for the host owner who just gave it", async () => {
    const onRecheckScreenRecording = vi.fn(async () => undefined);
    render(() => (
      <ServerSettingsModal
        {...props({
          hostStatus: { ...configuredHost, remoteDesktopScreenRecordingDenied: true },
          onRecheckScreenRecording,
        })}
      />
    ));
    await fireEvent.click(screen.getByRole("tab", { name: "Remote desktop" }));

    await fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    await waitFor(() => expect(onRecheckScreenRecording).toHaveBeenCalledOnce());
  });

  // `mcpServers` gates the tab and the panel together, so the prop is the whole feature gate: a
  // member of a remote server is never handed one and never sees a tab that would answer 403.
  it("shows the MCP tab only when a caller supplies the list", async () => {
    render(() => <ServerSettingsModal {...props()} />);
    expect(screen.queryByRole("tab", { name: "MCP" })).not.toBeInTheDocument();
  });

  // The list is read when the section opens, not when the dialog does, because most visits to this
  // dialog never reach it.
  it("asks for the MCP list when the section is opened", async () => {
    const onMcpSectionShown = vi.fn();
    render(() => (
      <ServerSettingsModal
        {...props({
          mcpServers: [mcpServer],
          onMcpSectionShown,
        })}
      />
    ));
    expect(onMcpSectionShown).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    await waitFor(() => expect(onMcpSectionShown).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Filesystem")).toBeInTheDocument();

    // Leaving and coming back reads the list again; staying in the section does not.
    await fireEvent.click(screen.getByRole("tab", { name: "General" }));
    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    await waitFor(() => expect(onMcpSectionShown).toHaveBeenCalledTimes(2));
  });

  // MCP servers belong to this machine and are started by the agents on it, so they are manageable
  // before the user publishes a Team API host at all - unlike members, invites and the identity.
  it("manages MCP servers on a local server with no host configured", async () => {
    render(() => <ServerSettingsModal {...props({ hostStatus: unconfiguredHost, mcpServers: [] })} />);

    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    expect(await screen.findByRole("button", { name: "Connect a custom MCP" })).toBeEnabled();
  });

  // "No MCP servers yet." says the server holds none. A failed read holds no such statement, and
  // the user needs a way out of it that is not closing the dialog.
  it("explains a failed MCP list read and offers a retry", async () => {
    const onRetryMcpServers = vi.fn();
    render(() => (
      <ServerSettingsModal
        {...props({ mcpServers: [], mcpLoadError: "The host is not reachable.", onRetryMcpServers })}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    expect(await screen.findByText("The host is not reachable.")).toBeInTheDocument();
    expect(screen.queryByText("No MCP servers yet.")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryMcpServers).toHaveBeenCalledTimes(1);
  });

  // The runtime a STDIO server is started with is downloaded in the background, and a server that
  // needs it cannot start before it arrives. Saying so here is the difference between "not yet" and
  // a connection failure the user would otherwise go looking for in their own configuration.
  it("says what the managed runtime under a STDIO server is doing", async () => {
    const [status, setStatus] = createSignal<ProviderRuntimeStatus>({
      phase: "downloading",
      progress: 40,
      message: null,
      version: "1.4.2",
    });
    render(() => <ServerSettingsModal {...props({ mcpServers: [mcpServer] })} mcpToolRuntimeNote={note(status())} />);

    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    expect(
      await screen.findByText(/Downloading the runtime a STDIO server is started with \(40%\)/),
    ).toBeInTheDocument();

    // Ready is the ordinary state and says nothing: a note that never leaves is a note nobody reads.
    setStatus({ phase: "ready", progress: 100, message: null, version: "1.4.2" });
    await waitFor(() => expect(screen.queryByText(/Downloading the runtime/)).not.toBeInTheDocument());
  });

  // The same rule on a row: the answer names the endpoint that row held, so a saved edit - or a slow
  // answer that lands after one - must not read as a working connection for the new one.
  it("drops an MCP row's test result when that server changes", async () => {
    const onTestMcpServer = vi.fn(async () => ({ toolCount: 3, error: null }));
    const [servers, setServers] = createSignal<McpServerConfig[]>([mcpServer]);
    render(() => <ServerSettingsModal {...props({ mcpServers: servers(), onTestMcpServer })} />);

    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    const trigger = await screen.findByRole("button", { name: "Actions for Filesystem" });
    await fireEvent.pointerDown(trigger, { button: 0 });
    await fireEvent.pointerUp(trigger, { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Test connection" }), { button: 0 });
    expect(await screen.findByText("Connected · 3 tools")).toBeInTheDocument();

    // Turning the server off keeps the answer: the switch decides who is given the server, not what
    // the connection is.
    setServers([{ ...mcpServer, enabled: false }]);
    expect(screen.getByText("Connected · 3 tools")).toBeInTheDocument();

    setServers([{ ...mcpServer, command: "/bin/other" }]);
    await waitFor(() => expect(screen.queryByText("Connected · 3 tools")).not.toBeInTheDocument());
    expect(onTestMcpServer).toHaveBeenCalledTimes(1);
  });

  // A test answers for the settings it was given. Left on screen after an edit it would report a
  // working connection for a command nobody tried.
  it("drops the MCP test result when the draft changes", async () => {
    const onTestMcpServer = vi.fn(async () => ({ toolCount: 3, error: null }));
    render(() => <ServerSettingsModal {...props({ mcpServers: [], onTestMcpServer })} />);

    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Connect a custom MCP" }));
    await fireEvent.input(screen.getByPlaceholderText("MCP server name"), { target: { value: "Filesystem" } });
    await fireEvent.input(screen.getByPlaceholderText("openai-dev-mcp"), { target: { value: "/bin/echo" } });
    await fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected · 3 tools")).toBeInTheDocument();

    await fireEvent.input(screen.getByPlaceholderText("openai-dev-mcp"), { target: { value: "/bin/other" } });
    await waitFor(() => expect(screen.queryByText("Connected · 3 tools")).not.toBeInTheDocument());
    expect(screen.getByText("Not tested yet.")).toBeInTheDocument();
    expect(onTestMcpServer).toHaveBeenCalledTimes(1);
  });

  // The gate can close under an open form: a remote host that answers without the capability, or a
  // role that loses it. The dialog keeps the breadcrumb and the save bar, so the panel has to take
  // them back with it.
  it("drops the MCP form's breadcrumb when the panel is no longer shown", async () => {
    const [servers, setServers] = createSignal<McpServerConfig[] | undefined>([]);
    render(() => <ServerSettingsModal {...props({ mcpServers: servers() })} />);

    await fireEvent.click(screen.getByRole("tab", { name: "MCP" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Connect a custom MCP" }));
    expect(await screen.findByText("Connect to a custom MCP")).toBeInTheDocument();

    setServers(undefined);
    await waitFor(() => expect(screen.queryByRole("tab", { name: "MCP" })).not.toBeInTheDocument());

    // The gate opens again on the next read, and the panel it builds starts on the list.
    setServers([]);
    await fireEvent.click(await screen.findByRole("tab", { name: "MCP" }));
    expect(await screen.findByRole("button", { name: "Connect a custom MCP" })).toBeInTheDocument();
    expect(screen.queryByText("Connect to a custom MCP")).not.toBeInTheDocument();
  });

  it("saves the first local identity without publishing it", async () => {
    const onSaveIdentity = vi.fn(async () => undefined);
    const onSetPublished = vi.fn(async () => undefined);
    render(() => <ServerSettingsModal {...props({ onSaveIdentity, onSetPublished })} />);

    const name = screen.getByRole("textbox", { name: "Server name" });
    expect(name).toHaveValue("");
    expect(screen.getByRole("switch", { name: "Publish this server" })).toBeDisabled();

    await fireEvent.input(name, { target: { value: "Draft Team" } });
    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(name).toHaveValue("");
    await fireEvent.input(name, { target: { value: "Studio Team" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaveIdentity).toHaveBeenCalledWith({ serverName: "Studio Team" }));
    expect(onSetPublished).not.toHaveBeenCalled();
  });

  it("clears a rejected server logo error when the draft is reset", async () => {
    render(() => <ServerSettingsModal {...props()} />);

    const name = screen.getByRole("textbox", { name: "Server name" });
    await fireEvent.input(name, { target: { value: "Studio Team" } });
    await fireEvent.change(screen.getByLabelText("Server logo"), {
      target: { files: [new File(["not-an-image"], "logo.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByText("Choose a PNG, JPEG, or WebP image.")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByText("Choose a PNG, JPEG, or WebP image.")).not.toBeInTheDocument();
    expect(screen.getByText("Shown to everyone who connects.")).toBeInTheDocument();
  });

  it("shows a failed identity action and keeps the draft", async () => {
    const onSaveIdentity = vi.fn(async () => {
      throw new Error("The identity could not save.");
    });
    render(() => (
      <>
        <ServerSettingsModal {...props({ onSaveIdentity })} />
        <Toaster />
      </>
    ));

    const name = screen.getByRole("textbox", { name: "Server name" });
    await fireEvent.input(name, { target: { value: "Studio Team" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Server action failed")).toBeInTheDocument();
    expect(screen.getByText("The identity could not save.")).toBeInTheDocument();
    expect(name).toHaveValue("Studio Team");
  });

  it("publishes a configured local server and keeps first setup disabled", async () => {
    const onSetPublished = vi.fn(async () => undefined);
    const { unmount } = render(() => (
      <ServerSettingsModal {...props({ hostStatus: configuredHost, onSetPublished })} />
    ));

    const publishSwitch = screen.getByRole("switch", { name: "Publish this server" });
    expect(publishSwitch).toBeEnabled();
    await fireEvent.click(publishSwitch);
    await waitFor(() => expect(onSetPublished).toHaveBeenCalledWith(false));

    unmount();
    render(() => <ServerSettingsModal {...props({ hostStatus: unconfiguredHost, onSetPublished })} />);
    expect(screen.getByRole("switch", { name: "Publish this server" })).toBeDisabled();
  });

  it("mutes a server and reflects a server that is already muted", async () => {
    const onSetMuted = vi.fn(async () => undefined);
    const { unmount } = render(() => <ServerSettingsModal {...props({ onSetMuted })} />);

    const muteSwitch = screen.getByRole("switch", { name: "Mute notifications" });
    expect(muteSwitch).not.toBeChecked();
    await fireEvent.click(muteSwitch);
    await waitFor(() => expect(onSetMuted).toHaveBeenCalledWith(true));

    unmount();
    render(() => (
      <ServerSettingsModal {...props({ server: { ...localServer, notificationsMuted: true }, onSetMuted })} />
    ));
    expect(screen.getByRole("switch", { name: "Mute notifications" })).toBeChecked();
  });

  it("validates the server name and returns an erased draft to its pristine state", async () => {
    const onSaveIdentity = vi.fn(async () => undefined);
    render(() => <ServerSettingsModal {...props({ onSaveIdentity })} />);

    const name = screen.getByRole("textbox", { name: "Server name" });
    await fireEvent.input(name, { target: { value: "Tiny" } });
    await waitFor(() => expect(name).toHaveValue("Tiny"));
    expect(screen.queryByText("Enter at least 6 characters.")).not.toBeInTheDocument();

    await fireEvent.blur(name);
    const error = screen.getByText("Enter at least 6 characters.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", error.id);
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeInTheDocument();

    await fireEvent.input(name, { target: { value: "" } });
    expect(screen.queryByText("Enter at least 6 characters.")).not.toBeInTheDocument();
    // The bar shrinks back into the bottom edge before it leaves, so this waits for the close.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument());
    expect(name).not.toHaveAttribute("aria-invalid");

    await fireEvent.input(name, { target: { value: "Tiny" } });
    await fireEvent.blur(name);
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await fireEvent.input(name, { target: { value: "Studio Team" } });
    expect(screen.queryByText("Enter at least 6 characters.")).not.toBeInTheDocument();
    expect(name).not.toHaveAttribute("aria-invalid");
    await fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(onSaveIdentity).toHaveBeenCalledWith({ serverName: "Studio Team" }));
  });

  it("keeps remote member settings read-only", async () => {
    render(() => (
      <ServerSettingsModal {...props({ server: { ...remoteServer, role: "member" }, hostStatus: null, members })} />
    ));

    expect(screen.queryByRole("textbox", { name: "Server name" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send invite" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Alice Chen" })).not.toBeInTheDocument();
  });

  it("moves through settings tabs with the keyboard", async () => {
    render(() => <ServerSettingsModal {...props({ server: remoteServer, hostStatus: null, members })} />);

    const generalTab = screen.getByRole("tab", { name: "General" });
    generalTab.focus();
    await fireEvent.keyDown(generalTab, { key: "ArrowDown" });

    const membersTab = screen.getByRole("tab", { name: "Members" });
    await waitFor(() => expect(membersTab).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
  });

  it("confirms member removal and keeps the member after cancellation", async () => {
    const onRemoveMember = vi.fn(async () => undefined);
    render(() => (
      <ServerSettingsModal {...props({ server: remoteServer, hostStatus: null, members, onRemoveMember })} />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    const memberActions = screen.getByRole("button", { name: "Actions for Alice Chen" });

    await fireEvent.pointerDown(memberActions, { button: 0 });
    await fireEvent.pointerUp(memberActions, { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Remove member" }), { button: 0 });
    expect(await screen.findByRole("alertdialog", { name: "Remove Alice Chen?" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRemoveMember).not.toHaveBeenCalled();

    await fireEvent.pointerDown(memberActions, { button: 0 });
    await fireEvent.pointerUp(memberActions, { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Remove member" }), { button: 0 });
    await fireEvent.click(await screen.findByRole("button", { name: "Remove member" }));

    await waitFor(() => expect(onRemoveMember).toHaveBeenCalledWith("alice-1"));
  });

  it("lets a remote administrator invite, search, revoke, and change member roles", async () => {
    const onCreateInvite = vi.fn(async (input: { role: "admin" | "member"; email?: string; permanent?: boolean }) => ({
      id: "invite-new",
      role: input.role,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      inviteUrl: "https://studio.example.com/invite/new",
      email: input.email ?? null,
      permanent: input.permanent ?? false,
      useCount: 0,
    }));
    const onUpdateMember = vi.fn(async () => undefined);
    const onRevokeInvite = vi.fn(async () => undefined);
    render(() => (
      <ServerSettingsModal
        {...props({
          server: remoteServer,
          hostStatus: null,
          members,
          invites: [
            {
              id: "invite-old",
              role: "member",
              expiresAt: "2099-01-01T00:00:00.000Z",
              usedAt: null,
              email: "pending@example.com",
              permanent: false,
              useCount: 0,
            },
          ],
          onCreateInvite,
          onUpdateMember,
          onRevokeInvite,
        })}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    await fireEvent.input(screen.getByRole("textbox", { name: "Email address" }), {
      target: { value: "new@example.com" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ role: "member", email: "new@example.com" }));

    await fireEvent.input(screen.getByRole("searchbox", { name: "Search members" }), {
      target: { value: "alice" },
    });
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText("Server Owner")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(onRevokeInvite).toHaveBeenCalledWith("invite-old"));
    const memberActions = screen.getByRole("button", { name: "Actions for Alice Chen" });
    await fireEvent.pointerDown(memberActions, { button: 0 });
    await fireEvent.pointerUp(memberActions, { button: 0 });
    expect(screen.queryByRole("menuitem", { name: "Pause access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Restore access" })).not.toBeInTheDocument();
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Make admin" }), { button: 0 });
    await waitFor(() => expect(onUpdateMember).toHaveBeenCalledWith({ memberId: "alice-1", role: "admin" }));
  });

  it("hides removed members and excludes them from the member count", async () => {
    render(() => (
      <ServerSettingsModal
        {...props({
          server: { ...remoteServer, apiUrl: "webrtc://remote-1" },
          hostStatus: null,
          members: members.map((member) => ({ ...member, disabled: member.id === "alice-1" })),
        })}
      />
    ));
    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.getByText("Server Owner")).toBeInTheDocument();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
    expect(screen.getByText("1 members")).toBeInTheDocument();
  });

  it("lets the owner remove an inactive legacy member before inviting them again", async () => {
    const [currentMembers, setCurrentMembers] = createSignal(
      members.map((member) => ({ ...member, disabled: member.id === "alice-1" })),
    );
    const onRemoveMember = vi.fn(async (memberId: string) => {
      setCurrentMembers((current) => current.filter((member) => member.id !== memberId));
    });
    render(() => (
      <ServerSettingsModal
        {...props({
          server: { ...remoteServer, role: "owner" },
          hostStatus: null,
          members: currentMembers(),
          onRemoveMember,
        })}
      />
    ));
    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.getByText("1 members")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Actions for Alice Chen" });
    await fireEvent.pointerDown(trigger, { button: 0 });
    await fireEvent.pointerUp(trigger, { button: 0 });
    expect(screen.queryByRole("menuitem", { name: "Restore access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Make admin" })).not.toBeInTheDocument();
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Remove member" }), { button: 0 });
    await fireEvent.click(await screen.findByRole("button", { name: "Remove member" }));
    await waitFor(() => expect(onRemoveMember).toHaveBeenCalledWith("alice-1"));
    await waitFor(() => expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument());
    expect(screen.getByText("Server Owner")).toBeInTheDocument();
  });

  it("shows when the invitation is accepted and stops offering its consumed QR", async () => {
    const invite = {
      id: "live-invite",
      role: "member" as const,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      email: null,
      permanent: false,
      useCount: 0,
      inviteUrl: "https://openbot.run/join?invite=live",
    };
    const [invites, setInvites] = createSignal<TeamInviteSummary[]>([invite]);
    render(() => (
      <ServerSettingsModal
        {...props({ server: remoteServer, hostStatus: null, members, onCreateInvite: async () => invite })}
        invites={invites()}
      />
    ));
    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    await fireEvent.click(screen.getByRole("tab", { name: "Invite link" }));
    await fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Show invitation QR code" }));
    await screen.findByRole("img", { name: "Invitation QR code" });
    setInvites([{ ...invite, usedAt: "2026-09-08T12:00:00.000Z" }]);
    expect(await screen.findByText("Invitation accepted")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Invitation QR code" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new invitation link" })).toBeEnabled();
  });

  it("associates invite validation with the email field and creates invite links", async () => {
    const onCreateInvite = vi.fn(async (input: { role: "admin" | "member"; email?: string; permanent?: boolean }) => ({
      id: "invite-new",
      role: input.role,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      inviteUrl: "https://studio.example.com/invite/new",
      email: input.email ?? null,
      permanent: input.permanent ?? false,
      useCount: 0,
    }));
    render(() => (
      <ServerSettingsModal {...props({ server: remoteServer, hostStatus: null, members, onCreateInvite })} />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    const email = screen.getByRole("textbox", { name: "Email address" });
    await fireEvent.input(email, { target: { value: "invalid" } });
    await fireEvent.blur(email);

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Enter a valid email address.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", error.id);

    await fireEvent.click(screen.getByRole("tab", { name: "Invite link" }));
    expect(screen.queryByText("Enter a valid email address.")).not.toBeInTheDocument();
    const inviteLink = screen.getByRole("textbox", { name: "Invitation link" });
    expect(inviteLink).toHaveValue("");
    await fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ role: "member" }));
    expect(await screen.findByRole("button", { name: "Copy link" })).toBeInTheDocument();
    await waitFor(() => expect(inviteLink).toHaveValue("https://studio.example.com/invite/new"));
    await fireEvent.click(screen.getByRole("button", { name: "Show invitation QR code" }));
    expect(await screen.findByRole("img", { name: "Invitation QR code" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Show invitation QR code" }));
    expect(screen.queryByRole("img", { name: "Invitation QR code" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Create new invitation link" }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledTimes(2));
  });

  it("creates a permanent link that lists as never expiring", async () => {
    const onCreateInvite = vi.fn(async (input: { role: "admin" | "member"; email?: string; permanent?: boolean }) => ({
      id: "invite-perma",
      role: input.role,
      expiresAt: "+275760-09-13T00:00:00.000Z",
      usedAt: null,
      inviteUrl: "https://studio.example.com/invite/perma",
      email: null,
      permanent: true,
      useCount: 0,
    }));
    render(() => (
      <ServerSettingsModal
        {...props({
          // An account-plane host reports no HTTP origin, which is what carries the flag.
          server: { ...remoteServer, apiUrl: null },
          hostStatus: null,
          members,
          invites: [
            {
              id: "invite-perma",
              role: "member",
              expiresAt: "+275760-09-13T00:00:00.000Z",
              usedAt: null,
              email: null,
              permanent: true,
              useCount: 3,
            },
          ],
          onCreateInvite,
        })}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    await fireEvent.click(screen.getByRole("tab", { name: "Perma link" }));
    await fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledWith({ role: "member", permanent: true }));

    expect(await screen.findByText("Permanent invitation link")).toBeInTheDocument();
    expect(screen.getByText(/Never expires · 3 joins/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hides the permanent tab on legacy HTTP hosts whose wire strips the flag", async () => {
    render(() => <ServerSettingsModal {...props({ server: remoteServer, hostStatus: null, members })} />);
    await fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.getByRole("tab", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Invite link" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Perma link" })).not.toBeInTheDocument();
  });
});
