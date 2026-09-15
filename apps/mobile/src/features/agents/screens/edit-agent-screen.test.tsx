import {
  type AgentAnalytics,
  type AgentMemory,
  analyticsRange,
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  type ChannelSummary,
  type ChannelTask,
  type CreateAgentInput,
  emptyAnalyticsTotals,
  parseChannelCommand,
  type Routine,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatTarget } from "@/features/chat/model/chat-target";
import { useHapticsPreference } from "@/features/settings/model/haptics";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { ChannelHistoryRefreshError, MobileChannelStore } from "../../channels/model/channel-store";
import { ChannelActionsScreen } from "../../channels/screens/channel-actions-screen";
import { ChannelFormScreen } from "../../channels/screens/channel-form-screen";
import { ChatHeader } from "../../chat/components/chat-header";
import { saveAgentRecord } from "../../workspace/model/save-agent-record";
import type { MobileAgent, MobileServer } from "../../workspace/model/workspace-types";
import { useAgentContextMenu } from "../components/agent-context-menu";
import { AgentPhoto } from "../components/agent-photo";
import { AddAgentScreen } from "./add-agent-screen";
import { EditAgentScreen } from "./edit-agent-screen";
import { HiddenChatsScreen } from "./hidden-chats-screen";

vi.mock("expo-crypto", () => ({ randomUUID: () => mocks.uuid() }));

vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-image", () => ({
  Image: ({ source }: { source: { uri: string } }) => <img alt="Agent avatar" src={source.uri} />,
}));
vi.mock("react-native-svg", () => ({
  default: ({ children }: PropsWithChildren) => <>{children}</>,
  Defs: () => null,
  Filter: () => null,
  FeColorMatrix: () => null,
  Image: () => null,
}));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: (...args: unknown[]) => mocks.choosePhoto(...args) }));
vi.mock("expo-file-system", () => ({
  File: class {
    name = "photo.png";
    type = "image/png";
    get size() {
      return mocks.fileSize;
    }
    bytes = async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    base64 = async () => "iVBORw0KGgo=";
  },
}));

const mocks = vi.hoisted(() => ({
  choosePhoto: vi.fn(),
  fileSize: 8,
  uuid: vi.fn(() => "new-agent-seed"),
  push: vi.fn(),
  replace: vi.fn(),
  dispatch: vi.fn(),
  alert: vi.fn(),
  back: vi.fn(),
  recordId: "",
  blocked: false,
  leave: () => {},
}));
const original: MobileAgent = {
  id: "agent-one",
  serverId: "host-one",
  name: "Travel",
  description: "Plan trips",
  title: "",
  preview: "",
  updatedLabel: "",
  avatarSeed: "original",
  avatarHue: null,
};
const host: MobileServer = {
  id: "host-one",
  name: "Desktop",
  state: "online",
  kind: "remote",
  initialConnectionPending: false,
  connectionMessage: null,
  address: null,
  accent: "",
  publicKey: "key",
  membershipId: "member",
  role: "member",
};
const channel: ChannelSummary = {
  id: "channel-one",
  name: "Travel channel",
  title: "Trip planning",
  instructions: "Compare routes",
  members: [{ agentId: "agent-one" }],
  leadAgentId: "agent-one",
  revision: 1,
  createdAt: "2026-09-14T00:00:00Z",
  archived: false,
  unreadCount: 0,
  activeTasks: 0,
  lastMessage: null,
};
let channelRows = [channel];
let actionTasks: ChannelTask[] = [];
let failChannelSave = false;
const channelRequests = vi.fn(async (path: string, body?: TeamProtocolV2Json) => {
  if (path === CHANNEL_ROUTES.list) return channelRows;
  if (path === CHANNEL_ROUTES.read)
    return { channel, tasks: actionTasks, messages: [], olderCursor: null, throughSequence: 0 };
  const command = parseChannelCommand(body);
  if (failChannelSave) throw new Error("Could not save this channel.");
  if (command.type === "save") {
    const saved = { ...channel, ...command.draft, id: command.channelId, revision: channel.revision + 1 };
    channelRows = [saved];
    return saved;
  }
  if (command.type === "resume" || command.type === "reassign")
    actionTasks = actionTasks.filter((task) => task.id !== command.taskId);
  return channel;
});
function createChannelStore() {
  const store = new MobileChannelStore(async (_method, path, decode, body) =>
    decode(await channelRequests(path, body)),
  );
  store.configure("host-one", [CHANNEL_CHATS_CAPABILITY, CHANNEL_DELETE_CAPABILITY]);
  return store;
}
const hiddenChannelIds: string[] = [];
const hiddenAgents: MobileAgent[] = [];
const workspace = {
  channelStore: createChannelStore(),
  agents: [original],
  servers: [host],
  activeServer: host,
  activityByServer: {},
  pinnedAgentIds: [],
  pinnedChannelIds: [],
  hiddenAgents,
  hiddenChannelIds,
  unhideChannel: vi.fn((_id: string, _serverId: string) => true),
  unreadAgentIds: [],
  createAgent: vi.fn(async (_input: CreateAgentInput) => {}),
  updateAgent: vi.fn(async (input: UpdateAgentInput, _serverId?: string) => {
    workspace.agents = [{ ...workspace.agents[0], ...input }];
  }),
  loadAgentAvatar: vi.fn(async (_id: string, _url: string, _serverId: string) => "data:image/png;base64,iVBORw0KGgo="),
  setAgentAvatar: vi.fn(
    async (
      _id: string,
      image: import("@openbot/team-client/remote-peer").RemoteFileUpload | null,
      _serverId: string,
    ) => {
      workspace.agents = workspace.agents.map((agent) => ({
        ...agent,
        avatarUrl: image ? "openbot-avatar://agent-one?v=new" : null,
      }));
    },
  ),
  saveAgentMemory: vi.fn(async () => {}),
  deleteAgentMemory: vi.fn(async () => {}),
  createAgentRoutine: vi.fn(async () => {}),
  updateAgentRoutine: vi.fn(async () => {}),
  deleteAgentRoutine: vi.fn(async () => {}),
  loadAgentModels: vi.fn(async () => [
    {
      provider: "codex",
      id: "model-one",
      name: "Model One",
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["medium", "high"],
    },
  ]),
  loadAgentMemories: vi.fn<() => Promise<AgentMemory[]>>(async () => []),
  loadAgentRoutines: vi.fn<() => Promise<Routine[]>>(async () => []),
  loadAgentAnalytics: vi.fn<() => Promise<AgentAnalytics | null>>(async () => null),
};
vi.mock("@/features/workspace/context/mobile-workspace-context", () => ({ useMobileWorkspace: () => workspace }));
vi.mock("@/features/auth/context/mobile-session-context", () => ({
  useMobileSession: () => ({ session: { apiUrl: "test", user: { id: "user" } }, sessionScope: 1 }),
}));
vi.mock("expo-router", () => ({
  Stack: {
    Toolbar: Object.assign(({ children }: PropsWithChildren) => <div>{children}</div>, {
      Button: ({
        children,
        accessibilityLabel,
        disabled,
        hidden,
        onPress,
      }: PropsWithChildren<{ accessibilityLabel: string; disabled: boolean; hidden: boolean; onPress: () => void }>) =>
        hidden ? null : (
          <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
            {children}
          </button>
        ),
    }),
  },
  router: { push: mocks.push, back: mocks.back, replace: mocks.replace },
  useLocalSearchParams: () => ({
    agentId: "agent-one",
    channelId: "channel-one",
    serverId: "host-one",
    recordId: mocks.recordId,
  }),
  useNavigation: () => ({ dispatch: mocks.dispatch }),
  Link: Object.assign(({ children }: PropsWithChildren) => <>{children}</>, {
    Trigger: ({ children }: PropsWithChildren) => children,
    AppleZoomTarget: ({ children }: PropsWithChildren) => children,
    Menu: ({ children }: PropsWithChildren) => <div>{children}</div>,
    MenuAction: ({ children, onPress }: PropsWithChildren<{ onPress: () => void }>) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
  }),
}));
vi.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (blocked: boolean, callback: (value: { data: { action: { type: string } } }) => void) => {
    mocks.blocked = blocked;
    mocks.leave = () => {
      if (blocked) callback({ data: { action: { type: "GO_BACK" } } });
      else mocks.dispatch({ type: "GO_BACK" });
    };
  },
}));
// Native controls keep their accessible actions and values in this DOM harness.
vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
  Platform: { OS: "ios" },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    disabled,
  }: PropsWithChildren<{
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityRole?: "button" | "checkbox";
    accessibilityState?: { checked?: boolean };
    disabled?: boolean;
  }>) =>
    accessibilityRole === "checkbox" ? (
      <input
        type="checkbox"
        checked={accessibilityState?.checked ?? false}
        disabled={disabled}
        aria-label={accessibilityLabel}
        onChange={onPress}
      />
    ) : (
      <button type="button" disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => "gray" }));
vi.mock("heroui-native", () => {
  const Text = ({ children }: PropsWithChildren) => <span>{children}</span>;
  const Button = ({
    children,
    onPress,
    isDisabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  }: PropsWithChildren<{
    onPress: () => void;
    isDisabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: "radio";
    accessibilityState?: { checked?: boolean };
  }>) =>
    accessibilityRole === "radio" ? (
      <input
        type="radio"
        aria-label={accessibilityLabel}
        checked={accessibilityState?.checked ?? false}
        disabled={isDisabled}
        onChange={onPress}
      />
    ) : (
      <button type="button" aria-label={accessibilityLabel} disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    );
  return {
    Typography: Object.assign(Text, { Paragraph: Text, Heading: Text }),
    Button: Object.assign(Button, { Label: Text }),
  };
});
vi.mock("@/shared/components/sheet-form-field", () => ({
  SheetFormField: ({
    label,
    value,
    onChangeText,
    editable,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={editable === false}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
vi.mock("@/shared/components/sheet-scroll-view", () => ({
  SheetScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/features/settings/components/settings-content", () => ({
  SettingsSection: ({ title, children }: PropsWithChildren<{ title: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  SettingsRow: ({
    children,
    onPress,
    trailing,
  }: PropsWithChildren<{ onPress?: () => void; trailing?: import("react").ReactNode }>) =>
    onPress ? (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ) : (
      <div>
        {children}
        {trailing}
      </div>
    ),
}));
vi.mock("@/features/agents/components/bloub-avatar", () => ({
  BloubAvatar: () => null,
  BloubAvatarPreview: () => null,
  BloubAvatarThumbnail: () => null,
}));
vi.mock("@/features/agents/components/agent-pin-avatar", () => ({
  AgentPinAvatar: ({ children }: PropsWithChildren) => children,
}));
vi.mock("@/features/agents/components/agent-pin-transition", () => ({
  useAgentPinTransition: () => ({ toggleAgentPinAnimated: vi.fn() }),
}));
vi.mock("expo-glass-effect", () => ({ GlassView: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock("@/features/chat/components/chat-glass-icon-button", () => ({
  ChatGlassIconButton: ({
    children,
    accessibilityLabel,
    onPress,
  }: PropsWithChildren<{ accessibilityLabel: string; onPress: () => void }>) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/shared/components/sheet-scroll-edge-effect", () => ({ SheetScrollEdgeEffect: () => null }));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  DateTimePicker: ({
    value,
    disabled,
    onChange,
  }: {
    value: Date;
    disabled: boolean;
    onChange: (event: { type: string }, value: Date) => void;
  }) => (
    <input
      aria-label="Time"
      type="time"
      disabled={disabled}
      value={`${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`}
      onChange={(event) => {
        const [hours, minutes] = event.target.value.split(":").map(Number);
        onChange({ type: "set" }, new Date(2000, 0, 1, hours, minutes));
      }}
    />
  ),
}));
vi.mock("uniwind", () => ({ useUniwind: () => ({ theme: "light" }) }));
vi.mock("@expo/ui", () => {
  const Picker = ({
    label,
    children,
    selectedValue,
    enabled,
    onValueChange,
  }: PropsWithChildren<{
    label: string;
    selectedValue: string | number;
    enabled: boolean;
    onValueChange: (value: string | number) => void;
  }>) => (
    <select
      aria-label={label}
      value={selectedValue}
      disabled={!enabled}
      onChange={(event) =>
        onValueChange(typeof selectedValue === "number" ? Number(event.target.value) : event.target.value)
      }
    >
      {children}
    </select>
  );
  return {
    Switch: ({
      label,
      value,
      disabled,
      onValueChange,
    }: {
      label: string;
      value: boolean;
      disabled: boolean;
      onValueChange: (value: boolean) => void;
    }) => (
      <input
        type="checkbox"
        role="switch"
        aria-checked={value}
        aria-label={label}
        checked={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    ),
    Host: ({ children }: PropsWithChildren) => children,
    Picker: Object.assign(Picker, {
      Item: ({ label, value }: { label: string; value: string }) => <option value={value}>{label}</option>,
    }),
  };
});
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@/shared/lib/haptics", () => ({ haptics: { impact: async () => {}, notification: async () => {} } }));
vi.mock("lucide-react-native", () => ({ ArrowLeft: () => null, Eye: () => null, TriangleAlert: () => null }));

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
let client = new QueryClient();
async function renderSheet(
  page: "info" | "appearance" | "usage" | "memories" | "routines" | "runtime" | "memory" | "routine" = "info",
) {
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <EditAgentScreen page={page} />
      </QueryClientProvider>,
    ),
  );
}
async function click(name: string, role = "button") {
  await act(() => fireEvent.click(screen.getByRole(role, { name })));
}
async function edit(name: string, value: string) {
  await act(() => fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } }));
}
beforeEach(() => {
  mocks.choosePhoto
    .mockReset()
    .mockResolvedValue({ canceled: false, assets: [{ uri: "file:///photo.png", mimeType: "image/png" }] });
  mocks.fileSize = 8;
  workspace.setAgentAvatar.mockClear();
  workspace.loadAgentAvatar.mockClear();
  mocks.uuid.mockReset().mockReturnValue("new-agent-seed");
  useHapticsPreference.setState({ enabled: true, ready: true });
  workspace.agents = [{ ...original }];
  workspace.servers = [{ ...host }];
  workspace.activeServer = host;
  hiddenChannelIds.length = 0;
  workspace.unhideChannel.mockReset().mockReturnValue(true);
  workspace.createAgent.mockReset().mockResolvedValue();
  workspace.updateAgent.mockClear();
  workspace.saveAgentMemory.mockClear();
  workspace.deleteAgentMemory.mockClear();
  workspace.createAgentRoutine.mockClear();
  workspace.updateAgentRoutine.mockClear();
  workspace.deleteAgentRoutine.mockClear();
  workspace.loadAgentMemories.mockReset().mockResolvedValue([]);
  workspace.loadAgentRoutines.mockReset().mockResolvedValue([]);
  workspace.loadAgentAnalytics.mockReset().mockResolvedValue(null);
  channelRows = [channel];
  actionTasks = [];
  failChannelSave = false;
  workspace.channelStore = createChannelStore();
  channelRequests.mockClear();
  mocks.replace.mockClear();
  mocks.recordId = "";
  mocks.blocked = false;
  mocks.leave = () => {};
  mocks.push.mockClear();
  mocks.dispatch.mockClear();
  mocks.alert.mockClear();
  mocks.back.mockImplementation(() => mocks.leave());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(() => root.unmount());
  client.clear();
  root = createRoot(container);
});

it.each([true, false])("keeps the native Info action available with haptics enabled=%s", async (enabled) => {
  useHapticsPreference.setState({ enabled });
  function Menu() {
    return useAgentContextMenu(original);
  }
  await act(() =>
    root.render(
      <>
        <ChatHeader
          target={{ ...original, kind: "agent" }}
          fallbackBackground="white"
          foreground="black"
          liquidGlassAvailable={false}
          topInset={0}
          onBack={() => {}}
        />
        <Menu />
      </>,
    ),
  );
  await act(() => fireEvent.click(screen.getByText("Travel")));
  expect(screen.queryByText("Usage")).toBeNull();
  await click("Info");
  expect(mocks.push.mock.calls).toEqual([
    [{ pathname: "/agent-info/[agentId]", params: { agentId: original.id, serverId: original.serverId } }],
    [{ pathname: "/agent-info/[agentId]", params: { agentId: original.id, serverId: original.serverId } }],
  ]);
});

it("opens channel settings from the shared chat header", async () => {
  await act(() =>
    root.render(
      <ChatHeader
        target={{ kind: "channel", id: channel.id, serverId: host.id, name: channel.name, members: [original] }}
        fallbackBackground="white"
        foreground="black"
        liquidGlassAvailable={false}
        topInset={0}
        onBack={() => {}}
      />,
    ),
  );
  await act(() => fireEvent.click(screen.getByRole("button", { name: `Info for ${channel.name}` })));
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/channel-info/[channelId]",
    params: { channelId: channel.id, serverId: host.id },
  });
});

it("saves name, title, and instructions on the original host and shows them after reopening", async () => {
  await renderSheet();
  await edit("Name", "  Explorer  ");
  await edit("Title", "  Travel planner  ");
  await edit("Instructions", "  Plan journeys  ");
  workspace.activeServer = { ...host, id: "host-two" };
  await renderSheet();
  await click("Save changes");
  await renderSheet();
  expect(workspace.updateAgent).toHaveBeenCalledWith(
    {
      agentId: original.id,
      name: "Explorer",
      title: "Travel planner",
      description: "Plan journeys",
    },
    "host-one",
  );
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  await act(() => root.unmount());
  root = createRoot(container);
  await renderSheet();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Explorer");
  expect(screen.getByRole("textbox", { name: "Instructions" })).toHaveProperty("value", "Plan journeys");
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Travel planner");
  expect(mocks.blocked).toBe(false);
});

it("validates input, retains failed edits, and confirms cancellation", async () => {
  await renderSheet();
  await edit("Name", " ");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  await edit("Name", "New name");
  workspace.updateAgent.mockRejectedValueOnce(new Error("Save failed"));
  await click("Save changes");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "New name");
  expect(mocks.blocked).toBe(true);
  await act(() => mocks.leave());
  const choices = mocks.alert.mock.calls[0]?.[2];
  expect(choices).toEqual([
    { text: "Keep editing", style: "cancel" },
    { text: "Discard", style: "destructive", onPress: expect.any(Function) },
  ]);
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await act(() => choices[1].onPress());
  expect(mocks.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
});

it("keeps edits through host loss and accepts desktop changes in untouched fields", async () => {
  await renderSheet();
  await edit("Name", "My draft");
  workspace.agents = [{ ...original, description: "Desktop update" }];
  workspace.servers = [{ ...host, state: "offline" }];
  await renderSheet();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "My draft");
  expect(screen.getByRole("textbox", { name: "Instructions" })).toHaveProperty("value", "Desktop update");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  workspace.servers = [host];
  await renderSheet();
  await click("Save changes");
  expect(workspace.updateAgent).toHaveBeenCalledWith({ agentId: original.id, name: "My draft" }, host.id);
});

it("initializes late agent data and handles information loading, empty data, and retry", async () => {
  workspace.agents = [];
  workspace.servers = [{ ...host, initialConnectionPending: true }];
  await renderSheet();
  expect(screen.getByText("Loading agent…")).toBeTruthy();
  let resolveMemories: (value: AgentMemory[]) => void = () => {};
  workspace.loadAgentMemories.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveMemories = resolve;
      }),
  );
  workspace.agents = [original];
  workspace.servers = [host];
  await renderSheet();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Travel");
  await renderSheet("memories");
  expect(screen.getByText("Loading memories…")).toBeTruthy();
  await act(async () => resolveMemories([]));
  await waitFor(() => expect(screen.getByText("No memories yet.")).toBeTruthy());

  workspace.loadAgentMemories.mockRejectedValueOnce(new Error("Disconnected"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["agent-info"] });
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry memories" })).toBeTruthy());
  await click("Retry memories");
  await waitFor(() => expect(screen.getByText("No memories yet.")).toBeTruthy());
});

it("prevents duplicate saves and dismissal while a save is pending", async () => {
  let finish: () => void = () => {};
  workspace.updateAgent.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await renderSheet();
  await edit("Name", "Pending name");
  await click("Save changes");
  expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
  await act(() => mocks.leave());
  expect(mocks.alert).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(workspace.updateAgent).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("shows host memories, routine status, and usage on separate pages", async () => {
  workspace.agents = [{ ...original, provider: "codex", model: "gpt-5.4" }];
  workspace.loadAgentMemories.mockResolvedValue([
    {
      id: "memory",
      agentId: original.id,
      text: "Prefers trains",
      origin: "manual",
      sourceTurnId: null,
      createdAt: "2026-09-09",
      updatedAt: "2026-09-09",
    },
  ]);
  workspace.loadAgentRoutines.mockResolvedValue([
    {
      id: "routine",
      agentId: original.id,
      name: "Travel check",
      instruction: "Check departures",
      active: false,
      timezone: "Europe/Warsaw",
      trigger: {
        id: "trigger",
        routineId: "routine",
        schedule: { kind: "daily", time: "09:00" },
        nextRunAt: "2026-09-10",
        createdAt: "2026-09-09",
        updatedAt: "2026-09-09",
      },
      createdAt: "2026-09-09",
      updatedAt: "2026-09-09",
    },
  ]);
  workspace.loadAgentAnalytics.mockResolvedValue({
    agentId: original.id,
    startDate: "2026-08-10",
    endDate: "2026-09-09",
    timeZone: "UTC",
    collectionStartedAt: "2026-08-01",
    updatedAt: null,
    totals: { ...emptyAnalyticsTotals(), turns: 2, sessions: 1, processedTokens: 42, estimatedCostUsd: 0.02 },
    daily: [
      { ...emptyAnalyticsTotals(), date: "2026-09-09", processedTokens: 42, sessions: 1, estimatedCostUsd: 0.02 },
    ],
    models: [{ ...emptyAnalyticsTotals(), provider: "codex", model: "Test model", processedTokens: 42, share: 1 }],
  });
  await renderSheet("memories");
  await waitFor(() => expect(screen.getByText("Prefers trains")).toBeTruthy());
  await renderSheet("routines");
  await waitFor(() => expect(screen.getByText("Travel check")).toBeTruthy());
  await renderSheet("usage");
  await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
  expect(screen.getByText("$0.0200")).toBeTruthy();
  expect(screen.getByText("Test model")).toBeTruthy();
  await click("2026-09-09: 42 tokens");
  expect(screen.getByText(/42 tokens · \$0.0200 · 1 sessions/)).toBeTruthy();
  await click("7 days");
  await waitFor(() =>
    expect(workspace.loadAgentAnalytics).toHaveBeenLastCalledWith(
      expect.objectContaining(analyticsRange(original.id, 7)),
      original.serverId,
    ),
  );
  await click("1 year");
  await waitFor(() =>
    expect(workspace.loadAgentAnalytics).toHaveBeenLastCalledWith(analyticsRange(original.id, 365), original.serverId),
  );
  await click("Custom range");
  await edit("Start date", "2024-01-01");
  await edit("End date", "2024-01-31");
  await click("Apply range");
  await waitFor(() =>
    expect(workspace.loadAgentAnalytics).toHaveBeenLastCalledWith(
      { ...analyticsRange(original.id), startDate: "2024-01-01", endDate: "2024-01-31" },
      original.serverId,
    ),
  );
  const requests = workspace.loadAgentAnalytics.mock.calls.length;
  await edit("End date", "2023-12-31");
  await click("Apply range");
  expect(screen.getByText(/Enter valid dates in YYYY-MM-DD/)).toBeTruthy();
  expect(workspace.loadAgentAnalytics).toHaveBeenCalledTimes(requests);
  await edit("End date", "2025-12-31");
  await click("Apply range");
  expect(workspace.loadAgentAnalytics).toHaveBeenCalledTimes(requests);
});

it("edits appearance separately from the main form", async () => {
  await renderSheet("appearance");
  await click("Agent face 2", "radio");
  await click("Automatic", "radio");
  // Select a real palette option through its accessible radio role.
  const color = screen
    .getAllByRole("radio")
    .find(
      (element) =>
        !element.getAttribute("aria-label")?.startsWith("Agent face") &&
        element.getAttribute("aria-label") !== "Automatic",
    );
  if (!color) throw new Error("Color control missing");
  await act(() => fireEvent.click(color));

  await click("Save changes");
  expect(workspace.updateAgent).toHaveBeenCalledWith(
    {
      agentId: original.id,
      avatarSeed: expect.not.stringMatching(/^original$/),
      avatarHue: expect.any(Number),
    },
    host.id,
  );
});
it("opens each detail page on the same host without sending or losing main form edits", async () => {
  await renderSheet();
  await edit("Name", "Draft name");
  for (const label of ["Edit appearance", "Usage", "Memories", "Routines", "Runtime"]) await click(label);
  expect(mocks.push.mock.calls.map((call) => call[0])).toEqual(
    ["appearance", "usage", "memories", "routines", "runtime"].map((page) => ({
      pathname: `/agent-info/[agentId]/${page}`,
      params: { agentId: original.id, serverId: host.id },
    })),
  );
  await renderSheet();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Draft name");
  expect(workspace.updateAgent).not.toHaveBeenCalled();
  expect(workspace.loadAgentMemories).not.toHaveBeenCalled();
});

it("saves a supported model and reasoning level on the original host", async () => {
  workspace.agents = [{ ...original, provider: "codex", model: "old-model", reasoningEffort: "low" }];
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByDisplayValue("old-model")).toHaveProperty("disabled", false));
  await act(() => fireEvent.change(screen.getByDisplayValue("old-model"), { target: { value: "model-one" } }));
  await act(() => fireEvent.change(screen.getByDisplayValue("Medium"), { target: { value: "high" } }));
  await click("Save changes");
  expect(workspace.updateAgent).toHaveBeenCalledWith(
    { agentId: original.id, model: "model-one", reasoningEffort: "high" },
    host.id,
  );
});

it("hides the header action after saving", async () => {
  await renderSheet("appearance");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  await click("Agent face 2", "radio");
  await click("Save changes");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("changes provider together with a compatible model and reasoning", async () => {
  workspace.agents = [{ ...original, provider: "codex", model: "model-one", reasoningEffort: "high" }];
  workspace.loadAgentModels.mockResolvedValueOnce([
    {
      provider: "codex",
      id: "model-one",
      name: "Model One",
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["medium", "high"],
    },
    {
      provider: "claude",
      id: "claude-model",
      name: "Claude Model",
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["medium"],
    },
  ]);
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByDisplayValue("Codex")).toHaveProperty("disabled", false));
  await act(() => fireEvent.change(screen.getByDisplayValue("Codex"), { target: { value: "claude" } }));
  await click("Save changes");
  expect(workspace.updateAgent).toHaveBeenCalledWith(
    { agentId: original.id, provider: "claude", model: "claude-model", reasoningEffort: "medium" },
    host.id,
  );
});

it("creates, edits, and deletes a memory on its host", async () => {
  let memory: AgentMemory = {
    id: "memory",
    agentId: original.id,
    text: "Old note",
    origin: "manual",
    sourceTurnId: null,
    createdAt: "",
    updatedAt: "",
  };
  workspace.loadAgentMemories.mockImplementation(async () => [memory]);
  await renderSheet("memories");
  await waitFor(() => expect(screen.getByRole("button", { name: "Add memory" })).toBeTruthy());
  await click("Add memory");
  await renderSheet("memory");
  await edit("Memory", "New note");
  await click("Save changes");
  expect(workspace.saveAgentMemory).toHaveBeenCalledWith(original.id, "New note", host.id, undefined);
  await renderSheet("memories");
  expect(screen.queryByRole("textbox", { name: "Memory" })).toBeNull();
  await click("Old note");
  expect(mocks.push).toHaveBeenLastCalledWith({
    pathname: "/agent-info/[agentId]/memory",
    params: { agentId: original.id, serverId: host.id, recordId: memory.id },
  });
  mocks.recordId = memory.id;
  await renderSheet("memory");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Old note"));
  memory = { ...memory, text: "Desktop note" };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["agent-info"] });
  });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Desktop note"));
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(mocks.blocked).toBe(false);
  await edit("Memory", "Changed note");
  memory = { ...memory, text: "New desktop note" };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["agent-info"] });
  });
  expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Changed note");
  workspace.servers = [{ ...host, state: "offline" }];
  await renderSheet("memory");
  expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Changed note");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  expect(mocks.blocked).toBe(true);
  workspace.servers = [{ ...host }];
  workspace.loadAgentMemories.mockRejectedValueOnce(new Error("Refresh failed"));
  await renderSheet("memory");
  await waitFor(() => expect(screen.getByText("Could not refresh memory.")).toBeTruthy());
  expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Changed note");
  await click("Retry memory");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", false));
  workspace.saveAgentMemory.mockImplementationOnce(() =>
    saveAgentRecord(client, ["agent-info", "test", "user", 1, host.id, original.id, "memories"], async () => ({
      ...memory,
      text: "Changed note",
    })),
  );
  workspace.loadAgentMemories.mockRejectedValueOnce(new Error("Refresh failed after save"));
  await click("Save changes");
  expect(workspace.saveAgentMemory).toHaveBeenCalledWith(original.id, "Changed note", host.id, memory.id);
  await waitFor(() => expect(screen.getByText("Could not refresh memory.")).toBeTruthy());
  expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Changed note");
  expect(mocks.blocked).toBe(false);
  memory = { ...memory, text: "Changed note" };
  await click("Retry memory");
  await waitFor(() => expect(screen.queryByText("Could not refresh memory.")).toBeNull());
  await click("Delete memory");
  await act(async () => mocks.alert.mock.calls.at(-1)?.[2][1].onPress());
  expect(workspace.deleteAgentMemory).toHaveBeenCalledWith(original.id, memory.id, host.id);
});

it("creates, edits, pauses, resumes, and deletes a routine without changing its schedule on toggle", async () => {
  let routine: Routine = {
    id: "routine",
    agentId: original.id,
    name: "Daily check",
    instruction: "Check trains",
    active: true,
    timezone: "UTC",
    createdAt: "",
    updatedAt: "",
    trigger: {
      id: "trigger",
      routineId: "routine",
      schedule: { kind: "weekly", weekday: 1, time: "09:00" },
      nextRunAt: "",
      createdAt: "",
      updatedAt: "",
    },
  };
  workspace.loadAgentRoutines.mockImplementation(async () => [routine]);
  await renderSheet("routines");
  await waitFor(() => expect(screen.getByRole("button", { name: "Add routine" })).toBeTruthy());
  await click("Add routine");
  await renderSheet("routine");
  await edit("Routine name", "New routine");
  await edit("Routine instructions", "Check updates");
  await edit("Time zone", "UTC");
  await click("Save changes");
  expect(workspace.createAgentRoutine).toHaveBeenCalledWith(
    {
      agentId: original.id,
      name: "New routine",
      instruction: "Check updates",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "09:00" },
    },
    host.id,
  );
  await renderSheet("routines");
  expect(screen.queryByRole("textbox", { name: "Routine name" })).toBeNull();
  await click("Daily check");
  expect(mocks.push).toHaveBeenLastCalledWith({
    pathname: "/agent-info/[agentId]/routine",
    params: { agentId: original.id, serverId: host.id, recordId: routine.id },
  });
  mocks.recordId = routine.id;
  await renderSheet("routine");
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Routine name" })).toHaveProperty("value", "Daily check"),
  );
  await edit("Routine name", "Renamed");
  routine = {
    ...routine,
    instruction: "Updated on desktop",
    trigger: { ...routine.trigger, schedule: { kind: "weekly", weekday: 5, time: "16:00" } },
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["agent-info"] });
  });
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Routine instructions" })).toHaveProperty("value", "Updated on desktop"),
  );
  expect(screen.getByLabelText("Time")).toHaveProperty("value", "16:00");
  workspace.updateAgentRoutine.mockImplementationOnce(() =>
    saveAgentRecord(client, ["agent-info", "test", "user", 1, host.id, original.id, "routines"], async () => ({
      ...routine,
      name: "Renamed",
    })),
  );
  workspace.loadAgentRoutines.mockRejectedValueOnce(new Error("Refresh failed after save"));
  await click("Save changes");
  expect(workspace.updateAgentRoutine).toHaveBeenCalledWith(
    {
      agentId: original.id,
      routineId: routine.id,
      name: "Renamed",
    },
    host.id,
  );
  await waitFor(() => expect(screen.getByText("Could not refresh routine.")).toBeTruthy());
  expect(screen.getByRole("textbox", { name: "Routine name" })).toHaveProperty("value", "Renamed");
  expect(mocks.blocked).toBe(false);
  routine = { ...routine, name: "Renamed" };
  await click("Retry routine");
  await waitFor(() => expect(screen.queryByText("Could not refresh routine.")).toBeNull());
  let finishToggle: () => void = () => {};
  workspace.updateAgentRoutine.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishToggle = resolve;
      }),
  );
  routine = { ...routine, active: false };
  await click("Enabled", "switch");
  expect(workspace.updateAgentRoutine).toHaveBeenLastCalledWith(
    { agentId: original.id, routineId: routine.id, active: false },
    host.id,
  );
  expect(screen.getByRole("textbox", { name: "Routine name" })).toHaveProperty("disabled", false);
  expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
  expect(screen.getByRole("switch", { name: "Enabled" })).toHaveProperty("checked", false);
  await act(async () => finishToggle());
  await click("Enabled", "switch");
  expect(workspace.updateAgentRoutine).toHaveBeenLastCalledWith(
    { agentId: original.id, routineId: routine.id, active: true },
    host.id,
  );
  await click("Delete routine");
  await act(async () => mocks.alert.mock.calls.at(-1)?.[2][1].onPress());
  expect(workspace.deleteAgentRoutine).toHaveBeenCalledWith(original.id, routine.id, host.id);
});

it("keeps a failed memory draft available for retry", async () => {
  workspace.saveAgentMemory.mockRejectedValueOnce(new Error("Disconnected"));
  await renderSheet("memories");
  await waitFor(() => expect(screen.getByRole("button", { name: "Add memory" })).toBeTruthy());
  await click("Add memory");
  await renderSheet("memory");
  await edit("Memory", "Keep this draft");
  await click("Save changes");
  expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Keep this draft");
  await click("Save changes");
  expect(workspace.saveAgentMemory).toHaveBeenCalledTimes(2);
});

it("shows the save action only for changed input and blocks invalid or pending saves", async () => {
  const save = vi.fn();
  await act(() => root.render(<SheetSaveAction dirty={false} canSave pending={false} onSave={save} />));
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  await act(() => root.render(<SheetSaveAction dirty canSave={false} pending={false} onSave={save} />));
  await click("Save changes");
  expect(save).not.toHaveBeenCalled();
  await act(() => root.render(<SheetSaveAction dirty canSave pending onSave={save} />));
  expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
  await act(() => root.render(<SheetSaveAction dirty canSave pending={false} onSave={save} />));
  await click("Save changes");
  expect(save).toHaveBeenCalledTimes(1);
});

it("creates an agent from changed valid input and blocks duplicate submission and closing while pending", async () => {
  const response = Promise.withResolvers<void>();
  workspace.createAgent.mockReturnValueOnce(response.promise);
  await act(() => root.render(<AddAgentScreen />));
  expect(screen.queryByRole("button", { name: "Create agent" })).toBeNull();
  await edit("Name", "Explorer");
  expect(screen.getByRole("button", { name: "Create agent" })).toHaveProperty("disabled", false);
  await edit("Name", "");
  expect(screen.queryByRole("button", { name: "Create agent" })).toBeNull();
  await edit("Name", " Explorer ");
  await edit("What should this agent help with?", " Plan trips ");
  await click("Create agent");
  await click("Creating…");
  await click("Close");
  await act(() => mocks.leave());
  expect(workspace.createAgent).toHaveBeenCalledExactlyOnceWith({
    name: "Explorer",
    description: "Plan trips",
    initialMessage: "Your ongoing role is: Plan trips",
    avatarSeed: "mobile:newagentseed",
    avatarHue: null,
  });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await act(() => response.resolve());
  expect(mocks.blocked).toBe(false);
  expect(mocks.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
});

it.each(["", "   "])("creates an agent with a greeting when instructions are %j", async (instructions) => {
  await act(() => root.render(<AddAgentScreen />));
  await edit("What should this agent help with?", instructions);
  await edit("Name", " Explorer ");
  await click("Create agent");
  expect(workspace.createAgent).toHaveBeenCalledExactlyOnceWith({
    name: "Explorer",
    description: "",
    initialMessage: "Greet me briefly.",
    avatarSeed: "mobile:newagentseed",
    avatarHue: null,
  });
});

it("keeps a failed create draft for retry and confirms close", async () => {
  workspace.createAgent.mockRejectedValueOnce(new Error("Create failed"));
  await act(() => root.render(<AddAgentScreen />));
  await edit("Name", "Explorer");
  await edit("What should this agent help with?", "Plan trips");
  await click("Create agent");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Explorer");
  expect(screen.getByRole("button", { name: "Create agent" })).toHaveProperty("disabled", false);
  await click("Close");
  expect(mocks.alert).toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await click("Create agent");
  expect(workspace.createAgent).toHaveBeenCalledTimes(2);
});

it("saves the selected monthly day and wall-clock time", async () => {
  await renderSheet("routine");
  await edit("Routine name", "Monthly check");
  await edit("Routine instructions", "Check updates");
  await edit("Time zone", "Europe/Warsaw");
  await act(() => fireEvent.change(screen.getByDisplayValue("Every day"), { target: { value: "monthly" } }));
  await act(() => fireEvent.change(screen.getByLabelText("Time"), { target: { value: "17:45" } }));
  await act(() => fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "22" } }));
  await click("Save changes");
  expect(workspace.createAgentRoutine).toHaveBeenCalledWith(
    expect.objectContaining({ timezone: "Europe/Warsaw", schedule: { kind: "monthly", day: 22, time: "17:45" } }),
    host.id,
  );
});

it("keeps an acknowledged memory save when an older read completes on the same host", async () => {
  const memory: AgentMemory = {
    id: "memory",
    agentId: original.id,
    text: "Old",
    origin: "manual",
    sourceTurnId: null,
    createdAt: "",
    updatedAt: "",
  };
  const key = ["agent-info", "test", "user", 1, host.id, original.id, "memories"];
  const otherHostKey = ["agent-info", "test", "user", 1, "other-host", original.id, "memories"];
  client.setQueryData(key, [memory]);
  client.setQueryData(otherHostKey, [memory]);
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<AgentMemory[]>();
  const read = client
    .fetchQuery({
      queryKey: key,
      queryFn: () => {
        started.resolve();
        return response.promise;
      },
    })
    .catch(() => undefined);
  await started.promise;
  const saved = { ...memory, text: "Saved by host", updatedAt: "2026-09-10" };
  await saveAgentRecord(client, key, async () => saved);
  response.resolve([memory]);
  await read;
  expect(client.getQueryData(key)).toEqual([saved]);
  expect(client.getQueryData(otherHostKey)).toEqual([memory]);
});

it("shows an incomplete routine change and hides it when the time zone is restored", async () => {
  const initialTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await renderSheet("routine");
  await edit("Time zone", initialTimezone === "UTC" ? "Europe/Warsaw" : "UTC");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  await edit("Time zone", initialTimezone);
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

async function renderChannel(create = false) {
  await act(async () => {
    await workspace.channelStore.refresh("host-one");
    root.render(<ChannelFormScreen create={create} />);
  });
}
it("creates a mobile channel with selected agents and opens its conversation", async () => {
  await renderChannel(true);
  expect(screen.queryByRole("button", { name: "Create channel" })).toBeNull();
  await act(() => fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Planning" } }));
  await click("Travel", "checkbox");
  expect(screen.queryByText("Automatic")).toBeNull();
  await click("Create channel");
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: "/channel/[channelId]",
      params: { channelId: "channel-new-agent-seed", serverId: "host-one" },
    }),
  );
  expect(channelRequests).toHaveBeenCalledWith(
    CHANNEL_ROUTES.command,
    expect.objectContaining({
      type: "save",
      draft: expect.objectContaining({
        name: "Planning",
        members: [{ agentId: "agent-one" }],
        leadAgentId: "agent-one",
      }),
    }),
  );
});
it("keeps a failed channel draft and retries the same operation", async () => {
  await renderChannel();
  await act(() => fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Renamed" } }));
  await click("Travel", "checkbox");
  failChannelSave = true;
  await click("Save channel");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Renamed");
  expect(mocks.blocked).toBe(true);
  failChannelSave = false;
  await click("Save channel");
  const saves = channelRequests.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command);
  expect(saves).toHaveLength(2);
  expect(saves[1]?.[1]).toEqual(saves[0]?.[1]);
  expect(saves[1]?.[1]).toMatchObject({ update: true, draft: { name: "Renamed", members: [], leadAgentId: null } });
});
it("uses a new save operation after a successful save and a desktop edit", async () => {
  await renderChannel();
  mocks.uuid.mockReturnValueOnce("save-one").mockReturnValueOnce("save-two");
  await edit("Name", "Planning");
  await click("Save channel");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save channel" })).toBeNull());
  channelRows = [{ ...channel, name: "Travel", revision: 3 }];
  await act(async () => workspace.channelStore.refresh("host-one"));
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Travel");
  await edit("Name", "Planning");
  await click("Save channel");
  const saves = channelRequests.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command);
  expect(saves.map(([, body]) => parseChannelCommand(body))).toMatchObject([
    { operationId: "save-one", draft: { name: "Planning" } },
    { operationId: "save-two", draft: { name: "Planning" } },
  ]);
  expect(workspace.channelStore.get("host-one").channels[0]?.name).toBe("Planning");
});

it("opens channel memories and routines from the channel settings sheet", async () => {
  await renderChannel();
  await click("Memories");
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/channel-info/[channelId]/memories",
    params: { channelId: "channel-one", serverId: "host-one" },
  });
  await click("Routines");
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/channel-info/[channelId]/routines",
    params: { channelId: "channel-one", serverId: "host-one" },
  });
  expect(screen.queryByRole("button", { name: "Delete channel" })).toBeNull();
});

it("restores a channel from Hidden chats and keeps the sheet open if saving fails", async () => {
  await workspace.channelStore.refresh(host.id);
  hiddenChannelIds.push(channel.id);
  mocks.back.mockClear();
  await act(() => root.render(<HiddenChatsScreen />));
  expect(screen.getByRole("button", { name: `Open chat with ${channel.name}` })).toBeTruthy();
  workspace.unhideChannel.mockReturnValueOnce(false);
  await click(`Show ${channel.name}`);
  expect(mocks.back).not.toHaveBeenCalled();
  await click(`Show ${channel.name}`);
  expect(workspace.unhideChannel).toHaveBeenLastCalledWith(channel.id, host.id);
  expect(mocks.back).toHaveBeenCalledTimes(1);
});

vi.mock("@expo/ui/community/menu", () => ({
  MenuView: ({
    actions,
    onPressAction,
    shouldOpenOnLongPress,
  }: {
    actions: { id: string; title: string; attributes?: { disabled?: boolean } }[];
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
    shouldOpenOnLongPress?: boolean;
  }) => {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button
          type="button"
          disabled={actions.every((action) => action.attributes?.disabled)}
          onClick={() => {
            if (!shouldOpenOnLongPress) setOpen(true);
          }}
        >
          Reassign
        </button>
        {open
          ? actions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={action.attributes?.disabled}
                onClick={() => onPressAction({ nativeEvent: { event: action.id } })}
              >
                {action.title}
              </button>
            ))
          : null}
      </div>
    );
  },
}));

it("opens the action sheet from the warning button only when action is needed", async () => {
  const renderHeader = (needsAction: boolean) =>
    act(() =>
      root.render(
        <ChatHeader
          target={{ kind: "channel", id: channel.id, serverId: host.id, name: channel.name, members: [original] }}
          fallbackBackground="white"
          foreground="black"
          liquidGlassAvailable={false}
          topInset={0}
          onBack={() => {}}
          needsAction={needsAction}
        />,
      ),
    );
  await renderHeader(false);
  expect(screen.queryByRole("button", { name: "Actions needed" })).toBeNull();
  await renderHeader(true);
  await click("Actions needed");
  expect(mocks.push).toHaveBeenCalledWith({
    pathname: "/channel-actions/[channelId]",
    params: { channelId: channel.id, serverId: host.id },
  });
  await renderHeader(false);
  expect(screen.queryByRole("button", { name: "Actions needed" })).toBeNull();
});

const failedAction: ChannelTask = {
  id: "task-one",
  channelId: channel.id,
  parentTaskId: null,
  rootTaskId: "task-one",
  ownerAgentId: original.id,
  requestMessageId: "message-one",
  instruction: "Ask @[Travel](agent:agent-one) to compare routes.",
  attachmentDraftIds: [],
  expectedResult: "A route",
  sourceMessageIds: [],
  dependencies: [],
  resources: [],
  state: "failed",
  revision: 1,
  assignmentCount: 1,
  error: "Could not complete the task.",
};
it("shows recovery actions in the sheet and removes resolved tasks", async () => {
  actionTasks = [failedAction, { ...failedAction, id: "task-running", state: "running" }];
  await act(() => root.render(<ChannelActionsScreen />));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Resume" })).toHaveLength(1));
  expect(screen.queryByText("@Travel")).toBeNull();
  expect(screen.getAllByText("Travel").length).toBeGreaterThan(1);
  await click("Resume");
  await waitFor(() => expect(screen.getByText("No actions needed.")).toBeTruthy());
  expect(channelRequests).toHaveBeenCalledWith(
    CHANNEL_ROUTES.command,
    expect.objectContaining({ type: "resume", taskId: failedAction.id, channelId: channel.id }),
  );
});
it("keeps a failed action in the sheet for retry and supports reassign", async () => {
  actionTasks = [failedAction];
  await act(() => root.render(<ChannelActionsScreen />));
  await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy());
  mocks.uuid.mockReturnValueOnce("task-one").mockReturnValueOnce("task-two");
  failChannelSave = true;
  await click("Resume");
  await waitFor(() => expect(screen.getByText("Could not save this channel.")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Resume" })).toHaveProperty("disabled", false);
  await click("Resume");
  const retries = channelRequests.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command);
  expect(retries).toHaveLength(2);
  expect(retries[1][1]).toEqual(retries[0][1]);
  failChannelSave = false;
  await click("Reassign");
  await click("Travel");
  await waitFor(() => expect(screen.getByText("No actions needed.")).toBeTruthy());
  expect(channelRequests).toHaveBeenCalledWith(
    CHANNEL_ROUTES.command,
    expect.objectContaining({ type: "reassign", taskId: failedAction.id, recipientAgentId: original.id }),
  );
});

it("retries only history after a task action was accepted", async () => {
  actionTasks = [failedAction];
  await act(() => root.render(<ChannelActionsScreen />));
  await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy());
  const refresh = vi
    .spyOn(workspace.channelStore, "refreshHistory")
    .mockRejectedValueOnce(new ChannelHistoryRefreshError("History unavailable"))
    .mockRejectedValueOnce(new ChannelHistoryRefreshError("History still unavailable"));
  await click("Resume");
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh history" })).toBeTruthy());
  expect(screen.getByRole("button", { name: "Resume" })).toHaveProperty("disabled", true);
  await click("Refresh history");
  expect(screen.getByRole("button", { name: "Resume" })).toHaveProperty("disabled", true);
  await click("Refresh history");
  await waitFor(() => expect(screen.getByText("No actions needed.")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Refresh history" })).toBeNull();
  expect(channelRequests.mock.calls.filter(([path]) => path === CHANNEL_ROUTES.command)).toHaveLength(1);
  refresh.mockRestore();
});

vi.mock("expo-linking", () => ({ openURL: vi.fn() }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("react-native-reanimated", () => ({
  useReducedMotion: () => true,
  Easing: { bezier: () => (value: number) => value },
  ReduceMotion: { System: "system" },
}));
// This DOM harness checks actions; native blur transitions run on the device.
vi.mock("@/shared/components/blur-reveal", () => ({
  BlurReveal: ({ value, children }: { value: ChatTarget | null; children: (value: ChatTarget) => React.ReactNode }) =>
    value ? children(value) : null,
}));
// Render static text while leaving the real markdown and mention renderer in use.
vi.mock("@/features/chat/components/streaming-tail-text", () => ({
  StreamRevealProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  StreamingBlock: ({ children }: PropsWithChildren) => <>{children}</>,
  StreamingTailText: ({ body }: { body: string }) => <span>{body}</span>,
}));

it("keeps a selected avatar draft after a failed upload and retries on its original host", async () => {
  await renderSheet("appearance");
  await click("Add photo");
  expect(mocks.blocked).toBe(true);
  expect(workspace.setAgentAvatar).not.toHaveBeenCalled();
  workspace.activeServer = { ...host, id: "host-two" };
  workspace.setAgentAvatar.mockRejectedValueOnce(new Error("Upload failed"));
  await click("Save changes");
  expect(screen.getByText("Upload failed")).toBeTruthy();
  await click("Save changes");
  expect(workspace.setAgentAvatar).toHaveBeenLastCalledWith(
    original.id,
    expect.objectContaining({ mimeType: "image/png", base64: "iVBORw0KGgo=" }),
    host.id,
  );
  expect(workspace.updateAgent).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

it("removes the desktop photo only after Save", async () => {
  workspace.agents = [{ ...original, avatarUrl: "openbot-avatar://agent-one?v=desktop" }];
  await renderSheet("appearance");
  await click("Remove photo");
  expect(workspace.setAgentAvatar).not.toHaveBeenCalled();
  await click("Save changes");
  expect(workspace.setAgentAvatar).toHaveBeenCalledWith(original.id, null, host.id);
  await renderSheet("appearance");
  expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();
});

it("keeps the form unchanged when photo selection is canceled or the file is too large", async () => {
  await renderSheet("appearance");
  mocks.choosePhoto.mockResolvedValueOnce({ canceled: true });
  await click("Add photo");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  mocks.fileSize = 600_000;
  await click("Add photo");
  expect(screen.getByText("Choose a photo smaller than 512 KB.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(workspace.setAgentAvatar).not.toHaveBeenCalled();
});

it("loads desktop avatar revisions from the correct host and returns to the generated face after removal", async () => {
  workspace.agents = [{ ...original, avatarUrl: "openbot-avatar://agent-one?v=desktop" }];
  const renderPhoto = (disconnected = false) =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentPhoto agentId={original.id} serverId={host.id} size={48} disconnected={disconnected}>
            <span>Generated face</span>
          </AgentPhoto>
        </QueryClientProvider>,
      ),
    );
  await renderPhoto();
  await waitFor(() => expect(screen.getByRole("img", { name: "Agent avatar" })).toBeTruthy());
  expect(workspace.loadAgentAvatar).toHaveBeenLastCalledWith(
    original.id,
    "openbot-avatar://agent-one?v=desktop",
    host.id,
  );
  workspace.servers = [{ ...host, state: "offline" }];
  await renderPhoto(true);
  expect(screen.getByRole("img", { name: "Agent avatar" }).getAttribute("src")).toBe(
    "data:image/png;base64,iVBORw0KGgo=",
  );
  expect(workspace.loadAgentAvatar).toHaveBeenCalledTimes(1);
  workspace.servers = [{ ...host }];
  await renderPhoto();
  expect(screen.getByRole("img", { name: "Agent avatar" }).getAttribute("src")).toBe(
    "data:image/png;base64,iVBORw0KGgo=",
  );
  expect(workspace.loadAgentAvatar).toHaveBeenCalledTimes(1);
  workspace.agents = [{ ...original, avatarUrl: "openbot-avatar://agent-one?v=replaced" }];
  await renderPhoto();
  await waitFor(() =>
    expect(workspace.loadAgentAvatar).toHaveBeenLastCalledWith(
      original.id,
      "openbot-avatar://agent-one?v=replaced",
      host.id,
    ),
  );
  workspace.agents = [{ ...original, avatarUrl: null }];
  await renderPhoto();
  expect(screen.queryByRole("img", { name: "Agent avatar" })).toBeNull();
  expect(screen.getByText("Generated face")).toBeTruthy();
});

it("keeps a title after a failed save and permits clearing it", async () => {
  workspace.agents = [{ ...original, title: "Travel planner" }];
  await renderSheet();
  await edit("Title", "Route planner");
  workspace.updateAgent.mockRejectedValueOnce(new Error("Title save failed"));
  await click("Save changes");
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Route planner");
  expect(mocks.blocked).toBe(true);
  await click("Save changes");
  await renderSheet();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  await edit("Title", "");
  await click("Save changes");
  expect(workspace.updateAgent).toHaveBeenLastCalledWith({ agentId: original.id, title: "" }, host.id);
});
