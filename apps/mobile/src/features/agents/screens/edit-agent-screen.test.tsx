import {
  type AgentAnalytics,
  type AgentMemory,
  analyticsRange,
  emptyAnalyticsTotals,
  type Routine,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { ChatHeader } from "../../chat/components/chat-header";
import type { MobileAgent, MobileServer } from "../../workspace/model/workspace-types";
import { useAgentContextMenu } from "../components/agent-context-menu";
import { EditAgentScreen } from "./edit-agent-screen";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
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
const workspace = {
  agents: [original],
  servers: [host],
  activeServer: host,
  activityByServer: {},
  pinnedAgentIds: [],
  unreadAgentIds: [],
  updateAgent: vi.fn(async (input: UpdateAgentInput, _serverId?: string) => {
    workspace.agents = [{ ...workspace.agents[0], ...input }];
  }),
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
  router: { push: mocks.push, back: mocks.back },
  useLocalSearchParams: () => ({ agentId: "agent-one", serverId: "host-one", recordId: mocks.recordId }),
  useNavigation: () => ({ dispatch: mocks.dispatch }),
  Link: {
    AppleZoomTarget: ({ children }: PropsWithChildren) => children,
    Menu: ({ children }: PropsWithChildren) => <div>{children}</div>,
    MenuAction: ({ children, onPress }: PropsWithChildren<{ onPress: () => void }>) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
  },
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
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: PropsWithChildren<{ onPress: () => void; accessibilityLabel: string }>) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
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
vi.mock("@/features/chat/components/chat-glass-icon-button", () => ({ ChatGlassIconButton: () => null }));
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
vi.mock("expo-haptics", () => ({}));
vi.mock("lucide-react-native", () => ({ ArrowLeft: () => null }));

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
  workspace.agents = [{ ...original }];
  workspace.servers = [{ ...host }];
  workspace.activeServer = host;
  workspace.updateAgent.mockClear();
  workspace.saveAgentMemory.mockClear();
  workspace.deleteAgentMemory.mockClear();
  workspace.createAgentRoutine.mockClear();
  workspace.updateAgentRoutine.mockClear();
  workspace.deleteAgentRoutine.mockClear();
  workspace.loadAgentMemories.mockReset().mockResolvedValue([]);
  workspace.loadAgentRoutines.mockReset().mockResolvedValue([]);
  workspace.loadAgentAnalytics.mockReset().mockResolvedValue(null);
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

it("opens the same host-bound sheet from the chat avatar and the row Info action", async () => {
  function Menu() {
    return useAgentContextMenu(original);
  }
  await act(() =>
    root.render(
      <>
        <ChatHeader
          agent={original}
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

it("saves name and instructions on the original host and shows them after reopening", async () => {
  await renderSheet();
  await edit("Name", "  Explorer  ");
  await edit("Instructions", "  Plan journeys  ");
  workspace.activeServer = { ...host, id: "host-two" };
  await renderSheet();
  await click("Save changes");
  await renderSheet();
  expect(workspace.updateAgent).toHaveBeenCalledWith(
    {
      agentId: original.id,
      name: "Explorer",
      description: "Plan journeys",
    },
    "host-one",
  );
  expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
  await act(() => root.unmount());
  root = createRoot(container);
  await renderSheet();
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Explorer");
  expect(screen.getByRole("textbox", { name: "Instructions" })).toHaveProperty("value", "Plan journeys");
  expect(mocks.blocked).toBe(false);
});

it("validates input, retains failed edits, and confirms cancellation", async () => {
  await renderSheet();
  await edit("Name", " ");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  await edit("Name", "New name");
  workspace.updateAgent.mockRejectedValueOnce(new Error("Save failed"));
  await click("Save changes");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "New name");
  expect(mocks.blocked).toBe(true);
  await click("Cancel");
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
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
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
  expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
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

it("shows saved feedback in the header after saving", async () => {
  await renderSheet("appearance");
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  await click("Agent face 2", "radio");
  await click("Save changes");
  expect(screen.getByRole("button", { name: "Saved" })).toHaveProperty("disabled", true);
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
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(mocks.blocked).toBe(true);
  workspace.servers = [{ ...host }];
  workspace.loadAgentMemories.mockRejectedValueOnce(new Error("Refresh failed"));
  await renderSheet("memory");
  await waitFor(() => expect(screen.getByText("Could not refresh memory.")).toBeTruthy());
  expect(screen.getByRole("textbox", { name: "Memory" })).toHaveProperty("value", "Changed note");
  await click("Retry memory");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy());
  await click("Save changes");
  expect(workspace.saveAgentMemory).toHaveBeenCalledWith(original.id, "Changed note", host.id, memory.id);
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
  await click("Save changes");
  expect(workspace.updateAgentRoutine).toHaveBeenCalledWith(
    {
      agentId: original.id,
      routineId: routine.id,
      name: "Renamed",
    },
    host.id,
  );
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

it("hides the saved header action after feedback and exposes the next save", async () => {
  vi.useFakeTimers();
  const save = vi.fn();
  const hidden = vi.fn();
  try {
    await act(() =>
      root.render(<SheetSaveAction canSave={false} pending={false} saved onSave={save} onSavedHidden={hidden} />),
    );
    expect(screen.getByRole("button", { name: "Saved" })).toHaveProperty("disabled", true);
    await act(() => vi.runOnlyPendingTimers());
    expect(screen.queryByRole("button", { name: "Saved" })).toBeNull();
    expect(hidden).toHaveBeenCalledTimes(1);
    await act(() => root.render(<SheetSaveAction canSave pending={false} saved={false} onSave={save} />));
    await click("Save changes");
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
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
