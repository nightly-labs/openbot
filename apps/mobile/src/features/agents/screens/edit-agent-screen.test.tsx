import {
  type AgentAdminSettings,
  type AgentAnalytics,
  type AgentMemory,
  analyticsRange,
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  type ChannelSummary,
  type ChannelTask,
  type CreateAgentInput,
  emptyAnalyticsTotals,
  type InstalledSkill,
  parseChannelCommand,
  type Routine,
  type SetEnabledSkillInput,
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  SKILL_CREATION_REQUEST,
  type StorageUsage,
  type UninstallSkillInput,
  type UpdateAgentAdminSettingsInput,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, isValidElement, type PropsWithChildren, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import type { ChatTarget } from "@/features/chat/model/chat-target";
import { takeComposerFocus, takeComposerRequest, useComposerRequest } from "@/features/chat/model/composer-requests";
import { useHapticsPreference } from "@/features/settings/model/haptics";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { ChannelHistoryRefreshError, MobileChannelStore } from "../../channels/model/channel-store";
import { ChannelActionsScreen } from "../../channels/screens/channel-actions-screen";
import { ChannelFormScreen } from "../../channels/screens/channel-form-screen";
import { ChatHeader } from "../../chat/components/chat-header";
import { LiveWorkspaceStore } from "../../workspace/model/live-workspace-store";
import { saveAgentRecord } from "../../workspace/model/save-agent-record";
import { mobileSidebarItems } from "../../workspace/model/sidebar-layout";
import type { MobileAgent, MobileServer } from "../../workspace/model/workspace-types";
import { useAgentContextMenu } from "../components/agent-context-menu";
import { AgentPhoto } from "../components/agent-photo";
import { SidebarSectionHeader } from "../components/sidebar-section-header";
import { useChatSectionMenu } from "../components/use-chat-section-menu";
import { AddAgentScreen } from "./add-agent-screen";
import { EditAgentScreen } from "./edit-agent-screen";
import { HiddenChatsScreen } from "./hidden-chats-screen";

vi.mock("expo-crypto", () => ({ randomUUID: () => mocks.uuid() }));

vi.mock("expo-secure-store", () => ({}));
// The agent chat preview draws math with the KaTeX fonts; the test does not load fonts.
vi.mock("expo-font", () => ({ useFonts: () => [true, null] }));
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
vi.mock("expo-image-manipulator", () => {
  const image = { width: 1200, height: 800, saveAsync: async () => ({ uri: "file:///avatar.jpg" }) };
  const context = { crop: () => context, resize: () => context, renderAsync: async () => image };
  return { ImageManipulator: { manipulate: () => context }, SaveFormat: { JPEG: "jpeg" } };
});
vi.mock("@/shared/lib/avatar-crop-request", () => ({
  requestAvatarCrop: async () => ({ originX: 200, originY: 0, width: 800, height: 800 }),
}));
vi.mock("expo-file-system", () => ({
  File: class {
    name = "avatar.jpg";
    get size() {
      return mocks.fileSize;
    }
    bytes = async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    base64 = async () => "iVBORw0KGgo=";
  },
}));

const { sheetRoutes } = vi.hoisted(() => ({
  sheetRoutes: (...routes: { name: string; params?: object }[]) => [
    { name: "connected" },
    ...routes,
    { name: "agent-info/[agentId]" },
  ],
}));
const mocks = vi.hoisted(() => ({
  choosePhoto: vi.fn(),
  fileSize: 8,
  uuid: vi.fn(() => "new-agent-seed"),
  push: vi.fn(),
  replace: vi.fn(),
  dismissTo: vi.fn(),
  dispatch: vi.fn(),
  sheetStack: {
    routes: sheetRoutes(),
    getState() {
      return { index: this.routes.length - 1, routes: this.routes };
    },
    goBack: vi.fn(),
    dispatch: vi.fn(),
  },
  alert: vi.fn(),
  shareFile: vi.fn(),
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
  logoKey: null,
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
const sidebarByServer: Record<string, { layout: SidebarLayoutSnapshot | null; error: string | null }> = {};
const workspace = {
  sidebarByServer,
  mutateSidebarLayout: vi.fn(async (_serverId: string, _action: SidebarLayoutAction) => {}),
  channelStore: createChannelStore(),
  agents: [original],
  servers: [host],
  activeServer: host,
  liveState: new LiveWorkspaceStore(),
  pinnedAgentIds: [],
  pinnedChannelIds: [],
  hiddenAgents,
  hiddenChannelIds,
  unhideChannel: vi.fn((_id: string, _serverId: string) => true),
  createAgent: vi.fn(async (_input: CreateAgentInput) => {}),
  updateAgent: vi.fn(async (input: UpdateAgentInput, _serverId?: string) => {
    const [agent] = workspace.agents;
    assert(agent);
    workspace.agents = [{ ...agent, ...input }];
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
  testAgentRoutine: vi.fn(async () => {}),
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
  // A host without `host-analytics` answers null, and the agent page reads the agent report.
  loadHostAnalytics: vi.fn(async () => null),
  loadAgentSkills: vi.fn<(agentId: string, serverId: string, manage?: boolean) => Promise<InstalledSkill[] | null>>(
    async () => [],
  ),
  canManageAgentSkills: vi.fn((_serverId: string) => false),
  setAgentSkillEnabled: vi.fn<(input: SetEnabledSkillInput, serverId: string) => Promise<InstalledSkill>>(),
  uninstallAgentSkill: vi.fn<(input: UninstallSkillInput, serverId: string) => Promise<void>>(),
  loadAgentStorage: vi.fn<(agentId: string, serverId: string, force?: boolean) => Promise<StorageUsage | null>>(
    async () => null,
  ),
  deleteStoredFile: vi.fn(async () => {}),
  loadAgentAdminSettings: vi.fn<(agentId: string, serverId: string) => Promise<AgentAdminSettings | null>>(
    async () => null,
  ),
  updateAgentAdminSettings: vi.fn<
    (input: UpdateAgentAdminSettingsInput, serverId: string) => Promise<AgentAdminSettings>
  >(async () => {
    throw new Error("unexpected");
  }),
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
  router: { push: mocks.push, back: mocks.back, replace: mocks.replace, dismissTo: mocks.dismissTo },
  useLocalSearchParams: () => ({
    agentId: "agent-one",
    channelId: "channel-one",
    serverId: "host-one",
    recordId: mocks.recordId,
  }),
  useNavigation: () => ({ dispatch: mocks.dispatch, getParent: () => mocks.sheetStack }),
  Link: Object.assign(({ children }: PropsWithChildren) => <>{children}</>, {
    Trigger: ({ children }: PropsWithChildren) => children,
    AppleZoomTarget: ({ children }: PropsWithChildren) => children,
    Menu: ({ children, title }: PropsWithChildren<{ title?: string }>) => {
      const [open, setOpen] = useState(!title);
      return (
        <div>
          {title ? (
            <button type="button" onClick={() => setOpen(!open)}>
              {title}
            </button>
          ) : null}
          {open ? children : null}
        </div>
      );
    },
    MenuAction: ({ children, onPress, disabled }: PropsWithChildren<{ onPress: () => void; disabled?: boolean }>) => (
      <button type="button" disabled={disabled} onClick={onPress}>
        {children}
      </button>
    ),
  }),
}));
vi.mock("expo-router/react-navigation", () => ({
  StackActions: { replace: (name: string, params: object) => ({ type: "REPLACE", payload: { name, params } }) },
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
    accessibilityState?: { checked?: boolean; expanded?: boolean };
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
      <button
        type="button"
        disabled={disabled}
        aria-label={accessibilityLabel}
        aria-expanded={accessibilityState?.expanded}
        onClick={onPress}
      >
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
    accessibilityState?: { checked?: boolean; expanded?: boolean };
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
  SettingsNote: ({ children }: PropsWithChildren) => <p>{children}</p>,
  SettingsSection: ({ title, children }: PropsWithChildren<{ title: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  SettingsRow: ({
    children,
    onPress,
    trailing,
    disabled,
    accessibilityLabel,
  }: PropsWithChildren<{
    onPress?: () => void;
    trailing?: import("react").ReactNode;
    disabled?: boolean;
    accessibilityLabel?: string;
  }>) =>
    onPress ? (
      <div>
        <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
          {children}
        </button>
        {trailing}
      </div>
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
  AvatarThumbnail: () => null,
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
// The SVG chart and its gestures run on the device. This harness selects a day by its date.
vi.mock("@/features/agents/components/usage-chart", () => ({
  useUsageSeriesColor: () => () => "accent",
  UsageChart: ({ dates, onSelect }: { dates: string[]; onSelect: (index: number) => void }) => (
    <div>
      {dates.map((date, index) => (
        <button key={date} type="button" aria-label={date} onClick={() => onSelect(index)} />
      ))}
    </div>
  ),
}));
vi.mock("@/features/agents/components/usage-segments", () => ({
  UsageSegments: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  DateTimePicker: ({
    value,
    mode,
    disabled,
    onChange,
  }: {
    value: Date;
    mode: "date" | "time";
    disabled: boolean;
    onChange: (event: { type: string }, value: Date) => void;
  }) =>
    mode === "date" ? (
      <input
        aria-label="Date"
        type="date"
        value={`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`}
        onChange={(event) => {
          const [year = 1970, month = 1, day = 1] = event.target.value.split("-").map(Number);
          onChange({ type: "set" }, new Date(year, month - 1, day, 12));
        }}
      />
    ) : (
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
vi.mock("@/shared/lib/haptics", () => ({
  haptics: { impact: async () => {}, notification: async () => {}, selection: async () => {} },
}));
vi.mock("lucide-react-native", () => ({
  ChevronRight: () => null,
  Ellipsis: () => null,
  ArrowLeft: () => null,
  Eye: () => null,
  TriangleAlert: () => null,
  Trash2: () => null,
  Shuffle: () => null,
  ImagePlus: () => null,
  Pencil: () => null,
}));
vi.mock("@/features/chat/components/attachment-preview", () => ({
  AttachmentThumbnail: () => null,
  useAttachmentFile: () => ({ uri: null, busy: false, share: mocks.shareFile }),
}));

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
let client = new QueryClient();
async function renderSheet(
  page:
    | "info"
    | "appearance"
    | "usage"
    | "memories"
    | "skills"
    | "files"
    | "routines"
    | "runtime"
    | "memory"
    | "routine" = "info",
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
  delete sidebarByServer[host.id];
  workspace.mutateSidebarLayout.mockReset().mockResolvedValue();
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
  workspace.loadAgentSkills.mockReset().mockResolvedValue([]);
  workspace.canManageAgentSkills.mockReset().mockReturnValue(false);
  workspace.setAgentSkillEnabled.mockReset();
  workspace.uninstallAgentSkill.mockReset();
  workspace.loadAgentStorage.mockReset().mockResolvedValue(null);
  workspace.deleteStoredFile.mockReset().mockResolvedValue();
  workspace.loadAgentAdminSettings.mockReset().mockResolvedValue(null);
  workspace.updateAgentAdminSettings.mockReset();
  mocks.shareFile.mockClear();
  channelRows = [channel];
  actionTasks = [];
  failChannelSave = false;
  workspace.channelStore = createChannelStore();
  channelRequests.mockClear();
  mocks.replace.mockClear();
  mocks.dismissTo.mockClear();
  mocks.sheetStack.routes = sheetRoutes();
  mocks.sheetStack.goBack.mockClear();
  mocks.sheetStack.dispatch.mockClear();
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

it("saves an agent without instructions, as the host and desktop allow", async () => {
  workspace.agents = [{ ...original, description: "" }];
  await renderSheet();
  await edit("Title", "Planner");
  await click("Save changes");
  expect(workspace.updateAgent).toHaveBeenCalledWith({ agentId: original.id, title: "Planner" }, original.serverId);
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

it("lists the host skills read-only and hides built-in skills", async () => {
  const skill = { installedVersion: 1, availableVersion: 1, state: "installed" as const };
  workspace.loadAgentSkills.mockResolvedValue([
    { ...skill, skillId: "writer", slug: "writer", name: "Writer", description: "Drafts posts" },
    { ...skill, skillId: "managed", slug: "managed", name: "Built in", origin: "managed" },
    { ...skill, skillId: "notes", slug: "notes", name: "Notes", enabled: false },
  ]);
  await renderSheet("skills");
  await screen.findByText("Writer");
  expect(workspace.loadAgentSkills).toHaveBeenCalledWith(original.id, original.serverId, false);
  expect(screen.getByText("Drafts posts")).toBeTruthy();
  expect(screen.getByText("Notes")).toBeTruthy();
  expect(screen.queryByText("Built in")).toBeNull();
  // A member cannot change skills.
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.queryByRole("button", { name: "Uninstall Writer" })).toBeNull();
  expect(screen.getByText("Skills for this agent are managed on the host.")).toBeTruthy();

  await act(() => root.unmount());
  root = createRoot(container);
  client.clear();
  workspace.loadAgentSkills.mockResolvedValue(null);
  await renderSheet("skills");
  await screen.findByText("This host does not support skills. Update OpenBot on the host.");
});

it("lets an admin turn a skill off and on, and puts the old state back when the host refuses", async () => {
  const writer: InstalledSkill = {
    skillId: "writer",
    slug: "writer",
    name: "Writer",
    installedVersion: 1,
    availableVersion: 1,
    state: "installed",
    enabled: true,
  };
  const folder: InstalledSkill = { ...writer, skillId: "folder", slug: "folder", name: "Folder", origin: "workspace" };
  workspace.servers = [{ ...host, role: "admin" }];
  workspace.canManageAgentSkills.mockReturnValue(true);
  workspace.loadAgentSkills.mockResolvedValue([writer, folder]);
  let answer: (skill: InstalledSkill) => void = () => {};
  workspace.setAgentSkillEnabled.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await renderSheet("skills");
  const toggle = await screen.findByRole("switch", { name: "Writer" });
  expect(workspace.loadAgentSkills).toHaveBeenCalledWith(original.id, original.serverId, true);
  // A skill in a folder that OpenBot does not manage stays read-only.
  expect(screen.queryByRole("switch", { name: "Folder" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Uninstall Folder" })).toBeNull();

  await act(() => fireEvent.click(toggle));
  expect(workspace.setAgentSkillEnabled).toHaveBeenCalledWith(
    { agentId: original.id, skillId: "writer", enabled: false },
    original.serverId,
  );
  // The switch moves before the host answers, and waits for the answer.
  await waitFor(() => expect(screen.getByRole("switch", { name: "Writer" })).toHaveProperty("checked", false));
  expect(screen.getByRole("switch", { name: "Writer" })).toHaveProperty("disabled", true);
  await act(async () => answer({ ...writer, enabled: false }));
  await waitFor(() => expect(screen.getByRole("switch", { name: "Writer" })).toHaveProperty("disabled", false));
  expect(screen.getByRole("switch", { name: "Writer" })).toHaveProperty("checked", false);

  workspace.setAgentSkillEnabled.mockRejectedValue(new Error("Sign in to the marketplace on the host."));
  await act(() => fireEvent.click(screen.getByRole("switch", { name: "Writer" })));
  await screen.findByText("Sign in to the marketplace on the host.");
  expect(screen.getByRole("switch", { name: "Writer" })).toHaveProperty("checked", false);
});

it("lets an admin start a new skill in the agent chat, as on desktop", async () => {
  await renderSheet("skills");
  expect(screen.queryByRole("button", { name: "Create skill" })).toBeNull();

  await act(() => root.unmount());
  root = createRoot(container);
  client.clear();
  workspace.servers = [{ ...host, role: "admin" }];
  workspace.canManageAgentSkills.mockReturnValue(true);
  await renderSheet("skills");
  await click("Create skill");
  expect(useComposerRequest.getState().request).toEqual({
    serverId: original.serverId,
    agentId: original.id,
    text: SKILL_CREATION_REQUEST,
  });
  // Opened from the agent list: the agent chat takes the place of the sheet.
  expect(mocks.sheetStack.dispatch).toHaveBeenCalledWith({
    type: "REPLACE",
    payload: { name: "chat/[agentId]", params: { agentId: original.id } },
  });
  expect(mocks.sheetStack.goBack).not.toHaveBeenCalled();
  expect(takeComposerRequest("other-host", original.id)).toBeNull();
  expect(takeComposerRequest(original.serverId, original.id)).toBe(SKILL_CREATION_REQUEST);
  expect(useComposerRequest.getState().request).toBeNull();

  // Opened from the agent chat: the sheet closes and that chat, not a new one, gets the request.
  mocks.sheetStack.routes = sheetRoutes({ name: "chat/[agentId]", params: { agentId: original.id } });
  mocks.sheetStack.dispatch.mockClear();
  await click("Create skill");
  expect(mocks.sheetStack.goBack).toHaveBeenCalledOnce();
  expect(mocks.sheetStack.dispatch).not.toHaveBeenCalled();
  // The keyboard is asked for only when the sheet is gone; during the dismissal iOS would drop it.
  expect(useComposerRequest.getState().focus).toBeNull();
  await act(() => root.unmount());
  root = createRoot(container);
  expect(takeComposerFocus("other-host", original.id)).toBe(false);
  expect(takeComposerFocus(original.serverId, original.id)).toBe(true);
  expect(useComposerRequest.getState().focus).toBeNull();
});

it("uninstalls a skill after confirmation and keeps it when the host refuses", async () => {
  const skill = { installedVersion: 1, availableVersion: 1, enabled: true };
  workspace.servers = [{ ...host, role: "owner" }];
  workspace.canManageAgentSkills.mockReturnValue(true);
  workspace.loadAgentSkills.mockResolvedValue([
    { ...skill, skillId: "writer", slug: "writer", name: "Writer", state: "installed" },
    { ...skill, skillId: "notes", slug: "notes", name: "Notes", state: "modified" },
  ]);
  await renderSheet("skills");
  await screen.findByRole("button", { name: "Uninstall Writer" });
  await click("Uninstall Writer");
  expect(mocks.alert).toHaveBeenLastCalledWith(
    "Uninstall Writer?",
    "OpenBot will remove this skill from the agent. Chat history stays.",
    expect.any(Array),
  );
  expect(workspace.uninstallAgentSkill).not.toHaveBeenCalled();

  workspace.uninstallAgentSkill.mockRejectedValueOnce(new Error("The host is busy."));
  await act(async () => mocks.alert.mock.calls.at(-1)?.[2][1].onPress());
  await screen.findByText("The host is busy.");
  expect(screen.getByRole("switch", { name: "Writer" })).toBeTruthy();

  workspace.uninstallAgentSkill.mockResolvedValue();
  await click("Uninstall Writer");
  await act(async () => mocks.alert.mock.calls.at(-1)?.[2][1].onPress());
  await waitFor(() => expect(screen.queryByRole("switch", { name: "Writer" })).toBeNull());
  expect(workspace.uninstallAgentSkill).toHaveBeenLastCalledWith(
    { agentId: original.id, skillId: "writer" },
    original.serverId,
  );
  expect(screen.queryByText("The host is busy.")).toBeNull();

  // A skill with local changes says that its files go, and the host is told to delete them.
  await click("Uninstall Notes");
  expect(mocks.alert.mock.calls.at(-1)?.[1]).toBe(
    "This skill has local changes in the agent workspace. Uninstall deletes those files. Chat history stays.",
  );
  await act(async () => mocks.alert.mock.calls.at(-1)?.[2][1].onPress());
  await waitFor(() => expect(screen.queryByRole("switch", { name: "Notes" })).toBeNull());
  expect(workspace.uninstallAgentSkill).toHaveBeenLastCalledWith(
    { agentId: original.id, skillId: "notes", removeModified: true },
    original.serverId,
  );

  // Offline, the list and its controls wait for a new connection.
  await act(() => root.unmount());
  root = createRoot(container);
  client.clear();
  workspace.servers = [{ ...host, role: "owner", state: "offline" }];
  workspace.canManageAgentSkills.mockReturnValue(false);
  await renderSheet("skills");
  expect(screen.getByText("Reconnect to load skills.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Uninstall Notes" })).toBeNull();
});

it("shows the agent files and lets an admin delete one, then measures again", async () => {
  const usage: StorageUsage = {
    scope: "agent",
    agentId: original.id,
    conversationId: null,
    scannedAt: "2026-09-14T00:00:00Z",
    freeBytes: null,
    breakdown: [{ category: "attachments", bytes: 12, removable: false }],
    agents: [],
    conversations: [],
    files: [
      {
        id: "file-one",
        name: "plan.pdf",
        size: 12,
        kind: "file",
        mimeType: "application/pdf",
        previewKind: "pdf",
        previewUrl: null,
        source: "attachment",
        agentId: original.id,
        conversation: null,
        messageId: "message-one",
        createdAt: "2026-09-14T00:00:00Z",
        status: "available",
        deletable: true,
      },
    ],
    truncated: false,
  };
  workspace.loadAgentStorage.mockResolvedValue(usage);
  await renderSheet("files");
  await screen.findByText("plan.pdf");
  expect(workspace.loadAgentStorage).toHaveBeenLastCalledWith(original.id, original.serverId, false);
  // A member reads the files but cannot delete them.
  expect(screen.queryByRole("button", { name: "Delete plan.pdf" })).toBeNull();
  await click("plan.pdf");
  expect(mocks.shareFile).toHaveBeenCalledOnce();

  await act(() => root.unmount());
  root = createRoot(container);
  client.clear();
  workspace.servers = [{ ...host, role: "admin" }];
  await renderSheet("files");
  await screen.findByRole("button", { name: "Delete plan.pdf" });
  await click("Delete plan.pdf");
  workspace.loadAgentStorage.mockResolvedValue({ ...usage, files: [] });
  await act(async () => mocks.alert.mock.calls.at(-1)?.[2][1].onPress());
  await waitFor(() => expect(workspace.deleteStoredFile).toHaveBeenCalledWith("file-one", original.serverId));
  await waitFor(() =>
    expect(workspace.loadAgentStorage).toHaveBeenLastCalledWith(original.id, original.serverId, true),
  );
  await waitFor(() => expect(screen.queryByText("plan.pdf")).toBeNull());
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
  await click("2026-09-09");
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
  // A picked date moves the other one when the range would be longer than 367 days or inverted.
  const pickDate = async (index: number, value: string) => {
    const picker = screen.getAllByLabelText("Date")[index];
    if (!picker) throw new Error(`No date picker at ${index}.`);
    await act(() => fireEvent.change(picker, { target: { value } }));
  };
  const customRange = (startDate: string, endDate: string) =>
    expect(workspace.loadAgentAnalytics).toHaveBeenLastCalledWith(
      { ...analyticsRange(original.id), startDate, endDate },
      original.serverId,
    );
  await click("Custom");
  await pickDate(0, "2024-01-01");
  await waitFor(() => customRange("2024-01-01", "2025-01-01"));
  await pickDate(1, "2024-01-31");
  await waitFor(() => customRange("2024-01-01", "2024-01-31"));
  await pickDate(1, "2023-12-01");
  await waitFor(() => customRange("2023-12-01", "2023-12-01"));
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
  workspace.loadAgentModels.mockResolvedValueOnce([
    {
      provider: "codex",
      id: "model-one",
      name: "A model with a name longer than the row",
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["medium", "high"],
    },
  ]);
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByDisplayValue("old-model")).toHaveProperty("disabled", false));
  expect(screen.getByRole("option", { name: "A model with a name longer t…" })).toBeTruthy();
  await act(() => fireEvent.change(screen.getByDisplayValue("old-model"), { target: { value: "model-one" } }));
  await act(() => fireEvent.change(screen.getByDisplayValue("Medium"), { target: { value: "high" } }));
  await click("Save changes");
  expect(workspace.updateAgent).toHaveBeenCalledWith(
    { agentId: original.id, model: "model-one", reasoningEffort: "high" },
    host.id,
  );
});

it.each([
  ["a member", "member", { access: "workspace", autoApprove: false, autoApproveLocked: false }],
  ["a host without agent-admin-v1", "admin", null],
] as const)("hides access controls for %s", async (_case, role, settings) => {
  workspace.servers = [{ ...host, role }];
  workspace.loadAgentAdminSettings.mockResolvedValue(settings);
  workspace.loadAgentModels.mockClear();
  await renderSheet("runtime");
  await waitFor(() => expect(workspace.loadAgentModels).toHaveBeenCalled());
  if (role === "member") expect(workspace.loadAgentAdminSettings).not.toHaveBeenCalled();
  else await waitFor(() => expect(workspace.loadAgentAdminSettings).toHaveBeenCalledWith(original.id, host.id));
  await act(async () => {});
  expect(screen.queryByRole("switch", { name: "Auto approve" })).toBeNull();
  expect(screen.queryByDisplayValue("Workspace only")).toBeNull();
});

it("saves access and auto-approve on the host for an admin", async () => {
  workspace.servers = [{ ...host, role: "admin" }];
  let saved: AgentAdminSettings = { access: "workspace", autoApprove: false, autoApproveLocked: false };
  workspace.loadAgentAdminSettings.mockImplementation(async () => saved);
  workspace.updateAgentAdminSettings.mockImplementation(async ({ agentId: _agentId, ...input }) => {
    saved = { ...saved, ...input };
    return saved;
  });
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByRole("switch", { name: "Auto approve" })).toHaveProperty("disabled", false));
  await click("Auto approve", "switch");
  await waitFor(() => expect(screen.getByRole("switch", { name: "Auto approve" })).toHaveProperty("checked", true));
  expect(workspace.updateAgentAdminSettings).toHaveBeenLastCalledWith(
    { agentId: original.id, autoApprove: true },
    host.id,
  );

  await act(() => fireEvent.change(screen.getByDisplayValue("Workspace only"), { target: { value: "full" } }));
  expect(mocks.alert.mock.calls.at(-1)?.[0]).toBe("Give this agent full access?");
  await act(async () => mocks.alert.mock.calls.at(-1)?.[2][1].onPress());
  await waitFor(() => expect(screen.getByDisplayValue("Full access")).toBeTruthy());
  expect(workspace.updateAgentAdminSettings).toHaveBeenLastCalledWith(
    { agentId: original.id, access: "full" },
    host.id,
  );

  // A new sheet reads the host again and shows the saved values.
  await act(() => root.unmount());
  root = createRoot(container);
  client.clear();
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByDisplayValue("Full access")).toBeTruthy());
  expect(screen.getByRole("switch", { name: "Auto approve" })).toHaveProperty("checked", true);
});

it("keeps the host value and shows the reason when an access update fails", async () => {
  workspace.servers = [{ ...host, role: "owner" }];
  workspace.loadAgentAdminSettings.mockResolvedValue({ access: "full", autoApprove: true, autoApproveLocked: false });
  workspace.updateAgentAdminSettings.mockRejectedValue(new Error("Host refused the change."));
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByDisplayValue("Full access")).toHaveProperty("disabled", false));
  await act(() => fireEvent.change(screen.getByDisplayValue("Full access"), { target: { value: "workspace" } }));
  expect(await screen.findByText("Host refused the change.")).toBeTruthy();
  expect(screen.getByDisplayValue("Full access")).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Auto approve" })).toHaveProperty("checked", true);
});

it("shows auto-approve as read-only when Turbo mode is on", async () => {
  workspace.servers = [{ ...host, role: "admin" }];
  workspace.loadAgentAdminSettings.mockResolvedValue({
    access: "workspace",
    autoApprove: false,
    autoApproveLocked: true,
  });
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByRole("switch", { name: "Auto approve" })).toHaveProperty("checked", true));
  expect(screen.getByRole("switch", { name: "Auto approve" })).toHaveProperty("disabled", true);
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
    {
      provider: "opencode",
      id: "opencode-model",
      name: "OpenCode Model",
      description: "",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["medium"],
    },
  ]);
  await renderSheet("runtime");
  await waitFor(() => expect(screen.getByDisplayValue("ChatGPT")).toHaveProperty("disabled", false));
  expect(screen.getByRole("option", { name: "OpenCode" })).toBeTruthy();
  await act(() => fireEvent.change(screen.getByDisplayValue("ChatGPT"), { target: { value: "claude" } }));
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
  await act(() => fireEvent.change(screen.getByDisplayValue("Daily"), { target: { value: "monthly" } }));
  await act(() => fireEvent.change(screen.getByLabelText("Time"), { target: { value: "17:45" } }));
  // A new monthly run starts on today's date, as on desktop.
  await act(() =>
    fireEvent.change(screen.getByDisplayValue(String(new Date().getDate())), { target: { value: "22" } }),
  );
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
    children,
  }: {
    children?: React.ReactNode;
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
          {isValidElement<{ accessibilityLabel?: string }>(children)
            ? (children.props.accessibilityLabel ?? "Reassign")
            : "Reassign"}
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
  const [firstRetry, secondRetry] = retries;
  assert(firstRetry);
  assert(secondRetry);
  expect(secondRetry[1]).toEqual(firstRetry[1]);
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
  default: { View: ({ children }: PropsWithChildren) => <div>{children}</div> },
  cubicBezier: () => "ease-out",
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
    expect.objectContaining({ mimeType: "image/jpeg", base64: "iVBORw0KGgo=" }),
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
  expect(screen.getByText("OpenBot could not make this photo small enough. Choose a simpler photo.")).toBeTruthy();
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

function installSections() {
  const layout: SidebarLayoutSnapshot = {
    revision: 1,
    sections: [{ id: "work", name: "Work" }],
    order: ["people", "work", "unassigned"],
    agentAssignments: { [original.id]: "work" },
    agentOrder: [original.id],
  };
  sidebarByServer[host.id] = { layout, error: null };
  return layout;
}

it("collapses and expands from the section name while options keep the section visible", async () => {
  const layout = installSections();
  function Section() {
    const [collapsed, setCollapsed] = useState(false);
    const items = mobileSidebarItems(layout, [original], [], new Set(collapsed ? ["work"] : []));
    return (
      <>
        <SidebarSectionHeader
          id="work"
          name="Work"
          empty={false}
          visibleSectionIds={["work", "unassigned"]}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
        {items.some((item) => item.kind === "agent") ? <button type="button">Open agent</button> : null}
      </>
    );
  }
  await act(() => root.render(<Section />));
  await click("Work section options");
  expect(screen.getByRole("button", { name: "Collapse Work" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "Open agent" })).toBeTruthy();
  expect(workspace.mutateSidebarLayout).not.toHaveBeenCalled();
  await click("Collapse Work");
  expect(screen.queryByRole("button", { name: "Open agent" })).toBeNull();
  expect(screen.getByRole("button", { name: "Expand Work" }).getAttribute("aria-expanded")).toBe("false");
  await click("Expand Work");
  expect(screen.getByRole("button", { name: "Open agent" })).toBeTruthy();
});

it("moves a chat from the native submenu without opening a sheet", async () => {
  installSections();
  function Menu() {
    return useChatSectionMenu(host.id, original.id).menu;
  }
  await act(() => root.render(<Menu />));
  expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
  await click("Move to section");
  expect(screen.getByRole("button", { name: "Work" }).hasAttribute("disabled")).toBe(true);
  await click("Agents");
  expect(workspace.mutateSidebarLayout).toHaveBeenLastCalledWith(host.id, {
    type: "assign",
    agentId: original.id,
    sectionId: null,
  });
  expect(mocks.push).not.toHaveBeenCalled();
});

it("keeps a failed submenu move available for retry", async () => {
  installSections();
  workspace.mutateSidebarLayout.mockRejectedValueOnce(new Error("Move failed"));
  function Menu() {
    return useChatSectionMenu(host.id, original.id).menu;
  }
  await act(() => root.render(<Menu />));
  await click("Move to section");
  await click("Agents");
  expect(mocks.alert).toHaveBeenCalledWith("Could not move chat", "Move failed");
  await click("Agents");
  expect(workspace.mutateSidebarLayout).toHaveBeenCalledTimes(2);
});
