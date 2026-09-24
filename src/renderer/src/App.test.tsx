import type {
  AgentStatus,
  AgentSummary,
  ConversationPage,
  ConversationSnapshot,
  Routine,
} from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { desktopAnalytics } from "./analytics";
import { AppProviders } from "./app-providers";
import {
  AGENTS,
  confirmOnboardingModel,
  emitAgentEvent,
  emitDynamicIslandAction,
  emitPresence,
  installOpenbotStub,
  presenceMember,
  testConversationPage,
  testServer,
} from "./app-test-harness";
import { AGENT_SELECTION_STORAGE_KEY } from "./features/agents/agent-selection";
import { useAgents } from "./features/agents/agents-context";
import { useConversation } from "./features/conversation/conversation-context";
import { useServers } from "./features/servers/servers-context";
import { SIDEBAR_PINS_STORAGE_KEY } from "./features/sidebar/sidebar-pins-storage";
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from "./features/sidebar/sidebar-sections-storage";
import { useLayout } from "./layout";
import { useNavigation } from "./navigation";
import { useProviders } from "./providers";

const morningBrief: Routine = {
  id: "routine-1",
  agentId: "chief",
  name: "Morning brief",
  instruction: "Summarize the overnight changes.",
  active: true,
  timezone: "UTC",
  trigger: {
    id: "trigger-1",
    routineId: "routine-1",
    schedule: { kind: "weekdays", time: "07:00" },
    nextRunAt: "2026-08-26T07:00:00.000Z",
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:05:00.000Z",
  },
  createdAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:05:00.000Z",
};

/** A routine record in the chat. Only a record from an agent turn has a `turnId`. */
const routineEvent = (id: string, action: "created" | "updated", createdAt: string, turnId?: string) => ({
  id,
  ...(turnId ? { turnId } : {}),
  author: "system" as const,
  source: "system" as const,
  text: morningBrief.name,
  createdAt,
  status: "completed" as const,
  itemType: `routine-event:${action}:${morningBrief.id}`,
});

describe("OpenBot connected desktop shell", () => {
  beforeEach(() => {
    installOpenbotStub();
  });

  // The toast store is module-global, so a notification outlives the render that raised it.
  afterEach(() => {
    toast.dismiss();
  });

  it("keeps the agent's routine card live after a change the person made in the app", async () => {
    vi.mocked(window.openbot.agent.listRoutines).mockResolvedValue([morningBrief]);
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(
      testConversationPage("chief", [
        routineEvent("routine-created", "created", "2026-08-25T12:00:00.000Z", "turn-1"),
        routineEvent("routine-updated", "updated", "2026-08-25T12:05:00.000Z"),
      ]),
    );
    render(() => <App />);

    const card = await screen.findByRole("article", { name: "Morning brief" });
    expect(card).toHaveTextContent("Created routine");
    expect(within(card).getByRole("button", { name: "Days: Weekdays" })).toBeEnabled();
    expect(screen.getAllByRole("article", { name: "Morning brief" })).toHaveLength(1);
    expect(screen.getByText("Updated routine")).toBeInTheDocument();
  });

  it("moves focus to the latest card of a routine from Show latest", async () => {
    vi.mocked(window.openbot.agent.listRoutines).mockResolvedValue([morningBrief]);
    vi.mocked(window.openbot.agent.readConversationPage).mockResolvedValue(
      testConversationPage("chief", [
        routineEvent("routine-created", "created", "2026-08-25T12:00:00.000Z", "turn-1"),
        routineEvent("routine-updated", "updated", "2026-08-25T12:05:00.000Z", "turn-2"),
      ]),
    );
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Show latest" }));
    const latest = screen.getAllByRole("article", { name: "Morning brief" }).at(-1);
    expect(latest).toHaveTextContent("Updated routine");
    await waitFor(() =>
      expect(within(latest ?? document.body).getByRole("button", { name: "Open routine Morning brief" })).toHaveFocus(),
    );
  });

  it("restores the selected agent after the app remounts", async () => {
    const view = render(() => <App />);
    await fireEvent.click(await screen.findByRole("button", { name: /Sales Outbound, Outbound specialist/ }));
    await screen.findByRole("heading", { name: "Sales Outbound" });
    view.unmount();

    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Sales Outbound" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Sales Outbound, Outbound specialist/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("replaces a deleted saved selection with the first available agent", async () => {
    window.localStorage.setItem(AGENT_SELECTION_STORAGE_KEY, JSON.stringify({ local: "deleted-agent" }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    expect(JSON.parse(window.localStorage.getItem(AGENT_SELECTION_STORAGE_KEY) ?? "{}")).toEqual({ local: "chief" });
  });

  it("clears only this server's saved selection when its agent list is empty", async () => {
    window.localStorage.setItem(AGENT_SELECTION_STORAGE_KEY, JSON.stringify({ local: "chief", team: "other" }));
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValue([]);
    render(() => <App />);
    await screen.findByRole("button", { name: "Create your first agent" });
    expect(JSON.parse(window.localStorage.getItem(AGENT_SELECTION_STORAGE_KEY) ?? "{}")).toEqual({ team: "other" });
  });

  it("keeps a saved selection after a failed agent load and restores it on retry", async () => {
    window.localStorage.setItem(AGENT_SELECTION_STORAGE_KEY, JSON.stringify({ local: "sales-outbound" }));
    vi.mocked(window.openbot.agent.listAgents).mockRejectedValueOnce(new Error("Offline"));
    function LoadStatus() {
      const { agentStatus } = useAgents();
      return <output aria-label="Agent load status">{agentStatus().message}</output>;
    }
    const view = render(() => (
      <AppProviders>
        <LoadStatus />
      </AppProviders>
    ));
    await waitFor(() => expect(screen.getByLabelText("Agent load status")).toHaveTextContent("Offline"));
    view.unmount();
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Sales Outbound" })).toBeVisible();
  });

  it("keeps an explicit agent selection made while the initial list is loading", async () => {
    window.localStorage.setItem(AGENT_SELECTION_STORAGE_KEY, JSON.stringify({ local: "sales-outbound" }));
    let resolveAgents: ((agents: AgentSummary[]) => void) | undefined;
    vi.mocked(window.openbot.agent.listAgents).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAgents = resolve;
      }),
    );
    function SelectWhileLoading() {
      const { selectAgent } = useNavigation();
      const { activeAgent } = useAgents();
      return (
        <>
          <button type="button" onClick={() => selectAgent("chief")}>
            Open Chief
          </button>
          <output aria-label="Selected agent">{activeAgent()?.name}</output>
        </>
      );
    }
    const view = render(() => (
      <AppProviders>
        <SelectWhileLoading />
      </AppProviders>
    ));
    await waitFor(() => expect(window.openbot.agent.listAgents).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole("button", { name: "Open Chief" }));
    resolveAgents?.(AGENTS);
    await waitFor(() => expect(screen.getByLabelText("Selected agent")).toHaveTextContent("Chief"));
    view.unmount();
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Chief" })).toBeVisible();
  });

  it("returns from full-page Usage with the conversation draft and settings intact", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const composer = await screen.findByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Keep this conversation draft";
    await fireEvent.input(composer);
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    const settings = await screen.findByRole("complementary", { name: "Agent settings" });
    const name = within(settings).getByRole("textbox", { name: "Agent name" });
    await fireEvent.input(name, { target: { value: "Draft agent name" } });
    const usageTrigger = within(settings).getByRole("button", { name: "Usage" });
    await fireEvent.click(usageTrigger);
    const usage = await screen.findByRole("region", { name: "Agent usage" });
    expect(screen.queryByRole("main", { name: "Conversation" })).not.toBeInTheDocument();
    expect(within(usage).getByRole("heading", { name: "Usage Local" })).toBeInTheDocument();
    await fireEvent.click(within(usage).getByRole("button", { name: "Back" }));
    expect(screen.getByRole("main", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("Draft agent name");
    expect(screen.getByRole("textbox", { name: "Message Chief" })).toHaveTextContent("Keep this conversation draft");
    await waitFor(() => expect(usageTrigger).toHaveFocus());
    const server = screen.getByRole("button", { name: "Local server" });
    await fireEvent.keyDown(server, { key: "F10", shiftKey: true });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Usage" }), { button: 0 });
    await screen.findByRole("region", { name: "Agent usage" });
    expect(screen.getByRole("button", { name: /^Usage agents/ })).toHaveTextContent("All agents");
    await fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(server).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Message Chief" })).toHaveTextContent("Keep this conversation draft");
  });

  it("keeps shell state and subscriptions when a view boundary remounts", async () => {
    function ShellProbe() {
      const conversation = useConversation();
      const agents = useAgents();
      const layout = useLayout();
      const servers = useServers();
      return (
        <output aria-label="shell controller state">
          {servers.activeServer()?.id}|{agents.activeAgent()?.id}|{conversation.activeMessages().length}|
          {layout.leftPanelWidth()}
        </output>
      );
    }

    // The provider subtree sits *above* a remountable view, exactly as `App`
    // mounts it, so state and subscriptions belong to the providers and the
    // view is free to come and go.
    function Harness() {
      return (
        <AppProviders>
          <HarnessBody />
        </AppProviders>
      );
    }

    function HarnessBody() {
      const layout = useLayout();
      const navigation = useNavigation();
      const [viewVisible, setViewVisible] = createSignal(true);
      return (
        <>
          <button type="button" onClick={() => setViewVisible((current) => !current)}>
            Toggle shell view
          </button>
          <button
            type="button"
            onClick={() => {
              layout.setLeftPanelWidth(360);
              navigation.selectAgent("sales-outbound");
            }}
          >
            Set shell state
          </button>
          <Show when={viewVisible()}>
            <ShellProbe />
          </Show>
        </>
      );
    }

    render(() => <Harness />);
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "shell controller state" })).toHaveTextContent("local|chief|0|280"),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Set shell state" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "shell controller state" })).toHaveTextContent(
        "local|sales-outbound|0|360",
      ),
    );

    const agentSubscriptionCount = vi.mocked(window.openbot.agent.onEvent).mock.calls.length;
    const authSubscriptionCount = vi.mocked(window.openbot.auth.onEvent).mock.calls.length;
    const presenceSubscriptionCount = vi.mocked(window.openbot.servers.onPresence).mock.calls.length;

    await fireEvent.click(screen.getByRole("button", { name: "Toggle shell view" }));
    expect(screen.queryByRole("status", { name: "shell controller state" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Toggle shell view" }));

    expect(screen.getByRole("status", { name: "shell controller state" })).toHaveTextContent(
      "local|sales-outbound|0|360",
    );
    expect(window.openbot.agent.onEvent).toHaveBeenCalledTimes(agentSubscriptionCount);
    expect(window.openbot.auth.onEvent).toHaveBeenCalledTimes(authSubscriptionCount);
    expect(window.openbot.servers.onPresence).toHaveBeenCalledTimes(presenceSubscriptionCount);
  });

  it("shows the interactive account dock in the landing preview and omits browser and remote control", async () => {
    const configure = vi.spyOn(desktopAnalytics, "configure");
    vi.mocked(window.openbot.auth.getState).mockResolvedValueOnce({
      status: "signed_in",
      user: {
        id: "user-1",
        email: "norbertbodziony@gmail.com",
        name: "Norbert",
        avatarUrl: null,
      },
    });
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([
      {
        ...testServer("remote-1", true),
        remoteDesktopAvailable: true,
        role: "owner",
        compatibility: {
          localAppVersion: "1.0.0",
          hostAppVersion: "1.0.0",
          localProtocol: { minimum: 1, maximum: 3 },
          hostProtocol: { minimum: 1, maximum: 3 },
          negotiatedProtocol: 3,
          capabilities: ["model-scoped-usage"],
        },
      },
    ]);

    render(() => <App landingPreview />);
    await screen.findByRole("heading", { name: "Chief" });

    const usageButton = await screen.findByRole("button", { name: "Usage, ChatGPT 59% left" });
    await fireEvent.click(usageButton);
    expect(screen.getByRole("dialog", { name: "Usage" })).toBeInTheDocument();

    const accountButton = screen.getByRole("button", { name: "Open account actions" });
    await fireEvent.click(accountButton);
    const accountDialog = screen.getByRole("dialog", { name: "Account actions" });
    expect(accountDialog).toBeInTheDocument();
    expect(screen.getByText("Norbert")).toBeInTheDocument();
    expect(screen.getByText("norbertbodziony@gmail.com")).toBeInTheDocument();
    expect(within(accountDialog).queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    await fireEvent.click(within(accountDialog).getByRole("button", { name: "Providers & permissions" }));
    const permissionsDialog = await screen.findByRole("dialog", { name: "Providers & permissions" });
    expect(within(permissionsDialog).queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    await fireEvent.click(within(permissionsDialog).getByRole("button", { name: "Cancel" }));
    expect(window.openbot.auth.logout).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open computer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remote control/iu })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Add remote server" }));
    expect(screen.queryByRole("dialog", { name: "Join a server" })).not.toBeInTheDocument();
    expect(window.openbot.browser.listTabs).not.toHaveBeenCalled();
    expect(window.openbot.browser.getControlState).not.toHaveBeenCalled();
    expect(window.openbot.browser.setVisible).not.toHaveBeenCalled();
    expect(window.openbot.remoteDesktop.list).not.toHaveBeenCalled();
    expect(window.openbot.remoteDesktop.onEvent).not.toHaveBeenCalled();
    expect(configure).not.toHaveBeenCalled();
    configure.mockRestore();
  });

  it("renders message links and opens them in the external browser", async () => {
    vi.mocked(window.openbot.agent.readConversation).mockResolvedValueOnce({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "linked-message",
          author: "assistant",
          text: "Read [Meta](https://about.fb.com/news/) or https://example.com/report.",
          createdAt: "2026-08-12T09:00:00.000Z",
          status: "completed",
        },
      ],
    });
    render(() => <App />);
    const metaLink = await screen.findByRole("link", { name: "Meta" });
    expect(metaLink).toHaveAttribute("href", "https://about.fb.com/news/");
    expect(screen.getByRole("link", { name: "https://example.com/report" })).toHaveAttribute(
      "href",
      "https://example.com/report",
    );
    expect(screen.queryByText("https://about.fb.com/news/")).not.toBeInTheDocument();

    await fireEvent.click(metaLink);
    expect(window.openbot.openUrl).toHaveBeenCalledWith("https://about.fb.com/news/");
    expect(window.openbot.browser.open).not.toHaveBeenCalled();
  });

  it("refreshes stored history when Codex becomes ready after the window opens", async () => {
    vi.mocked(window.openbot.agent.getStatus).mockResolvedValue({
      phase: "starting",
      cliVersion: "0.144.1",
      auth: { kind: "unknown" },
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: "Starting local Codex…",
      fullAccess: true,
    });
    vi.mocked(window.openbot.agent.readConversation)
      .mockResolvedValueOnce({
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 0,
        messages: [],
      })
      .mockResolvedValueOnce({
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "restored-answer",
            author: "assistant",
            text: "Restored after Codex became ready",
            createdAt: "2026-08-12T10:00:00.000Z",
            status: "completed",
          },
        ],
      });

    render(() => <App />);
    // The first read must land before the ready status, or the refresh it triggers has nothing
    // stored to replace.
    await waitFor(() => expect(window.openbot.agent.readConversation).toHaveBeenCalledTimes(1));
    emitAgentEvent?.({
      type: "status",
      status: {
        phase: "ready",
        cliVersion: "0.144.1",
        auth: { kind: "chatgpt", email: "norbert@example.com" },
        capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
        message: null,
        fullAccess: true,
      },
    });

    expect(await screen.findByText("Restored after Codex became ready")).toBeInTheDocument();
    expect(window.openbot.agent.readConversation).toHaveBeenCalledTimes(2);
  });

  it("restores and persists pinned chats for the active server", async () => {
    window.localStorage.setItem(SIDEBAR_PINS_STORAGE_KEY, JSON.stringify({ local: [{ kind: "agent", id: "chief" }] }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    const pinnedChief = screen.getByRole("button", { name: "Chief, pinned agent" });
    expect(screen.getByRole("region", { name: "Pinned chats" })).toBeInTheDocument();
    await fireEvent.contextMenu(pinnedChief, { clientX: 120, clientY: 90 });
    await fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Unpin" }), { button: 0 });

    await waitFor(() => expect(screen.queryByRole("region", { name: "Pinned chats" })).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_PINS_STORAGE_KEY) ?? "{}")).toEqual({});
    expect(screen.getByRole("button", { name: /Chief, Chief of staff/ })).toBeInTheDocument();
  });

  it("loads shared sidebar sections and connects section actions to the desktop API", async () => {
    const sectionId = "11111111-1111-4111-8111-111111111111";
    const layout = {
      revision: 3,
      sections: [{ id: sectionId, name: "Core team" }],
      order: ["people", sectionId, "unassigned"],
      agentAssignments: { chief: sectionId },
      agentOrder: ["chief", "sales-outbound"],
    };
    vi.mocked(window.openbot.agent.getSidebarLayout).mockResolvedValueOnce(layout);
    vi.mocked(window.openbot.agent.mutateSidebarLayout).mockResolvedValueOnce({ ...layout, revision: 4 });

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    const sectionToggle = await screen.findByRole("button", { name: "Core team" });
    const section = sectionToggle.closest<HTMLElement>("[data-section-id]");
    if (!section) throw new Error("Shared sidebar section is missing.");
    expect(within(section).getByRole("button", { name: /Chief, Chief of staff/ })).toBeInTheDocument();

    await fireEvent.click(sectionToggle);
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) ?? "{}")).toEqual({
      local: [sectionId],
    });

    await fireEvent.contextMenu(screen.getByLabelText("Sidebar free area"));
    const sidebarMenu = await screen.findByRole("menu", { name: "Sidebar actions" });
    await fireEvent.pointerUp(within(sidebarMenu).getByRole("menuitem", { name: "New section" }), { button: 0 });
    const sectionName = await screen.findByRole("textbox", { name: "New section name" });
    await fireEvent.input(sectionName, { target: { value: "Product" } });
    await fireEvent.keyDown(sectionName, { key: "Enter" });

    await waitFor(() =>
      expect(window.openbot.agent.mutateSidebarLayout).toHaveBeenCalledWith({ type: "create", name: "Product" }),
    );
  });

  it("restores empty sections and their collapsed state without agents after remount", async () => {
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValue([]);
    vi.mocked(window.openbot.agent.getSidebarLayout).mockResolvedValue({
      revision: 1,
      sections: [{ id: "11111111-1111-4111-8111-111111111111", name: "Product" }],
      order: ["people", "unassigned", "11111111-1111-4111-8111-111111111111"],
      agentAssignments: {},
      agentOrder: [],
    });
    const view = render(() => <App />);
    await fireEvent.click(await screen.findByRole("button", { name: "Product" }));
    expect(screen.getByRole("button", { name: "Product" })).toHaveAttribute("aria-expanded", "false");
    view.unmount();

    render(() => <App />);
    const toggle = await screen.findByRole("button", { name: "Product" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Create your first agent" })).toBeInTheDocument();
  });

  it.each(["", "   "])("creates an additional agent with a blank purpose (%j)", async (purpose) => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or channel" }), { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New agent" }), { button: 0 });
    await screen.findByRole("heading", { name: "Create a new agent" });

    const name = screen.getByRole("textbox", { name: "Name" });
    const create = screen.getByRole("button", { name: "Create agent" });
    await fireEvent.input(name, { target: { value: "   " } });
    expect(create).toBeDisabled();
    await fireEvent.input(name, { target: { value: "  Helper  " } });
    await fireEvent.input(screen.getByRole("textbox", { name: "What should this agent help with?" }), {
      target: { value: purpose },
    });
    expect(create).toBeEnabled();
    await fireEvent.click(create);

    await waitFor(() =>
      expect(window.openbot.agent.createAgent).toHaveBeenCalledWith({
        name: "Helper",
        description: "General-purpose assistant",
        initialMessage: "Greet me briefly.",
        avatarSeed: expect.any(String),
        avatarHue: null,
        provider: "codex",
        model: "gpt-5.6-luna",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Helper" })).toBeInTheDocument();
  });

  it("creates an agent from a suggestion with one complete backend input", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or channel" }), { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New agent" }), { button: 0 });
    expect(await screen.findByRole("heading", { name: "Create a new agent" })).toBeInTheDocument();
    expect(window.openbot.agent.createAgent).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: /^Trip Planner\./ }));

    const name = screen.getByRole("textbox", { name: "Name" });
    const purpose = screen.getByRole("textbox", { name: "What should this agent help with?" });
    expect(name).toHaveValue("Trip Planner");
    expect(purpose).toHaveValue(
      "Compare travel options and turn my rough ideas into practical, day-by-day itineraries.",
    );
    await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(window.openbot.agent.createAgent).toHaveBeenCalledOnce());
    const draft = {
      name: "Trip Planner",
      purpose: "Compare travel options and turn my rough ideas into practical, day-by-day itineraries.",
    };
    expect(window.openbot.agent.createAgent).toHaveBeenCalledWith({
      name: draft.name,
      description: draft.purpose,
      avatarSeed: expect.any(String),
      avatarHue: 215,
      provider: "codex",
      model: "gpt-5.6-luna",
      initialMessage:
        "Your ongoing role is: Compare travel options and turn my rough ideas into practical, day-by-day itineraries.",
    });
    expect(window.openbot.agent.sendMessage).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Trip Planner" })).toBeInTheDocument();
  });

  it("seeds the creation form from the saved setup choice and submits the pair", async () => {
    vi.mocked(window.openbot.getSetupState).mockResolvedValue({
      completed: true,
      preferredProvider: "opencode",
      preferredModel: null,
    });
    vi.mocked(window.openbot.agent.listModels).mockResolvedValue([
      {
        provider: "opencode",
        id: "opencode/example-free",
        name: "Example Free",
        description: "Free OpenCode model.",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["medium"],
      },
    ]);
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or channel" }), { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New agent" }), { button: 0 });
    expect(await screen.findByRole("heading", { name: "Create a new agent" })).toBeInTheDocument();
    // The hard-coded codex default would fail against this catalog; the saved choice stands instead.
    expect(await screen.findByRole("button", { name: "Agent model: Example Free" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() =>
      expect(window.openbot.agent.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "opencode", model: "opencode/example-free" }),
      ),
    );
  });

  it("opens and cancels agent creation from a private conversation", async () => {
    render(() => <App peopleEnabled />);
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });
    await fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    expect(await screen.findByRole("main", { name: "Direct conversation with Alice" })).toBeInTheDocument();

    await fireEvent.pointerDown(screen.getByRole("button", { name: "New agent or channel" }), { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "New agent" }), { button: 0 });

    expect(await screen.findByRole("heading", { name: "Create a new agent" })).toBeInTheDocument();
    expect(window.openbot.agent.createAgent).not.toHaveBeenCalled();
    expect(window.openbot.servers.setDirectTyping).toHaveBeenCalledWith({
      memberId: "member-alice",
      typing: false,
    });
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("main", { name: "Direct conversation with Alice" })).toBeInTheDocument();
  });

  it("hides People navigation and direct conversations by default", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitPresence?.({
      serverId: "server-1",
      updatedAt: "2026-08-19T10:00:00.000Z",
      members: [
        presenceMember("member-self", "person@example.com", "Person"),
        presenceMember("member-alice", "alice@example.com", "Alice"),
      ],
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "People" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Alice/ })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("main", { name: /Direct conversation/ })).not.toBeInTheDocument();
    expect(window.openbot.servers.listDirectThreads).not.toHaveBeenCalled();
  });

  it("opens global search with Command K and navigates to agent and message results", async () => {
    vi.mocked(window.openbot.agent.searchConversationMessages).mockResolvedValue({
      results: [
        {
          agentId: "sales-outbound",
          message: {
            id: "sales-search-result",
            author: "assistant",
            source: "assistant",
            text: "Ask @[Research](agent:research-hidden-id) to use @[Sources](skill:sources-hidden-id).",
            createdAt: "2026-08-20T09:30:00.000Z",
            status: "completed",
          },
        },
      ],
      total: 1,
      nextCursor: null,
    });
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) => ({
      agentId,
      threadId: null,
      activeTurnId: null,
      revision: 1,
      messages:
        agentId === "sales-outbound"
          ? [
              {
                id: "sales-search-result",
                author: "assistant",
                source: "assistant",
                text: "Ask @[Research](agent:research-hidden-id) to use @[Sources](skill:sources-hidden-id).",
                createdAt: "2026-08-20T09:30:00.000Z",
                status: "completed",
              },
            ]
          : [],
      readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
    }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.keyDown(window, { key: "k", metaKey: true });

    const dialog = await screen.findByRole("dialog", { name: "Search OpenBot" });
    const input = screen.getByRole("combobox", { name: "Search OpenBot" });
    expect(dialog).toBeVisible();

    await fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
    await fireEvent.input(input, { target: { value: "sources-hidden-id" } });
    await screen.findByText("No matching messages or agents");
    await fireEvent.input(input, { target: { value: "research" } });
    const messageResult = await screen.findByRole("option", { name: /Ask @Research to use Sources \(skill\)\./ });
    expect(messageResult).not.toHaveTextContent("research-hidden-id");
    await fireEvent.click(messageResult);
    await screen.findByRole("heading", { name: "Sales Outbound" });
    expect(window.openbot.agent.searchConversationMessages).toHaveBeenCalledWith({
      query: "research",
      limit: 100,
    });
    expect(window.openbot.agent.readConversationPage).toHaveBeenCalledWith({
      agentId: "sales-outbound",
      anchor: { type: "around", messageId: "sales-search-result" },
      limit: 50,
    });

    await fireEvent.keyDown(window, { key: "k", metaKey: true });
    await fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    const agentSearch = screen.getByRole("combobox", { name: "Search OpenBot" });
    await fireEvent.input(agentSearch, { target: { value: "chief" } });
    await fireEvent.click(await screen.findByRole("option", { name: /Chief/ }));
    await screen.findByRole("heading", { name: "Chief" });
  });

  it("removes a completed Dynamic Island answer without sending it twice", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    await waitFor(() => expect(emitDynamicIslandAction).toBeDefined());
    emitAgentEvent?.({
      type: "prompt",
      requestId: "prompt-island",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      questions: [
        {
          id: "source",
          header: "Choose a source",
          question: "Which source should I use?",
          isSecret: false,
          options: [
            { label: "Official data", description: "Use the public dataset" },
            { label: "Industry report", description: "Use the detailed report" },
          ],
        },
      ],
    });
    await screen.findByText("Which source should I use?");

    emitDynamicIslandAction?.({
      type: "answer-prompt",
      serverId: "local",
      agentId: "chief",
      requestId: "prompt-island",
      answers: { source: ["Official data"] },
    });

    await Promise.resolve();

    expect(window.openbot.agent.respondToPrompt).not.toHaveBeenCalled();
    expect(screen.queryByText("Which source should I use?")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chief" })).toBeVisible();
  });

  it("discards a chat-open reload that resolves during a server switch", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolveOldPage: ((page: ConversationPage) => void) | undefined;
    let resolveRemoteAgents: ((agents: AgentSummary[]) => void) | undefined;
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.openbot.servers.select).mockResolvedValueOnce([
      { ...local, active: false },
      { ...remote, active: true },
    ]);
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    vi.mocked(window.openbot.agent.readConversationPage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldPage = resolve;
          }),
      )
      .mockResolvedValueOnce(
        testConversationPage(
          "chief",
          [
            {
              id: "reply-new-server",
              author: "assistant",
              text: "Unread reply from the new server",
              createdAt: "2026-08-30T02:05:00.000Z",
              status: "completed",
            },
          ],
          {
            readState: { unreadCount: 1, firstUnreadMessageId: "reply-new-server", throughMessageId: null },
          },
        ),
      );
    vi.mocked(window.openbot.agent.listAgents).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRemoteAgents = resolve;
        }),
    );

    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    await waitFor(() => expect(resolveOldPage).toBeDefined());
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() => expect(resolveRemoteAgents).toBeDefined());
    resolveOldPage?.(
      testConversationPage(
        "chief",
        [
          {
            id: "reply-old-server",
            author: "assistant",
            text: "Reply from the old server",
            createdAt: "2026-08-30T02:04:00.000Z",
            status: "completed",
          },
        ],
        {
          revision: 2,
          readState: { unreadCount: 1, firstUnreadMessageId: "reply-old-server", throughMessageId: null },
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("Reply from the old server")).not.toBeInTheDocument();
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
    resolveRemoteAgents?.(AGENTS);
    await screen.findByRole("heading", { name: "Chief" });
    await screen.findByText("Unread reply from the new server");
    expect(window.openbot.agent.markConversationRead).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "1 new message" })).toBeInTheDocument();
  });

  it("rejects a permission approval and keeps the error visible", async () => {
    vi.mocked(window.openbot.agent.respondToApproval).mockRejectedValueOnce(
      new Error("This approval is no longer active."),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    emitAgentEvent?.({
      type: "approval",
      approval: {
        requestId: 14,
        agentId: "chief",
        threadId: "thread-chief",
        turnId: "turn-1",
        kind: "permissions",
        command: null,
        cwd: null,
        reason: "The agent needs access to the project files.",
        grantRoot: null,
        permissions: {
          fileSystem: { read: ["/tmp/project"], write: ["/tmp/project/out"] },
          network: true,
        },
      },
    });

    expect(await screen.findByText("Grant permissions")).toBeInTheDocument();
    expect(screen.getByText("Network access")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(window.openbot.agent.respondToApproval).toHaveBeenCalledWith({
        requestId: 14,
        decision: "decline",
      }),
    );
    expect(await screen.findByText("This approval is no longer active.")).toBeInTheDocument();
  });

  it("opens the recipient chat from a persistent agent exchange", async () => {
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) => ({
      agentId,
      threadId: "thread-1",
      activeTurnId: null,
      revision: 1,
      messages:
        agentId === "chief"
          ? [
              {
                id: "outbox-message-1",
                author: "system",
                source: "system",
                text: "Prepare report",
                createdAt: new Date().toISOString(),
                status: "completed",
                exchange: {
                  direction: "outgoing",
                  messageId: "message-1",
                  senderAgentId: "chief",
                  recipientAgentIds: ["sales-outbound"],
                  replyToMessageId: null,
                  deliveries: [
                    {
                      id: "delivery-1",
                      recipientAgentId: "sales-outbound",
                      status: "queued",
                      position: 1,
                      error: null,
                    },
                  ],
                },
              },
            ]
          : [],
    }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    expect(await screen.findByText("Messaged")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Open chat with Sales Outbound" }));
    expect(await screen.findByRole("heading", { name: "Sales Outbound" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Messages with Sales Outbound" })).not.toBeInTheDocument();
  });

  it("shows an incoming agent marker without duplicating raw collaborator input", async () => {
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(async (agentId) => ({
      agentId,
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages:
        agentId === "chief"
          ? [
              {
                id: "delivery-reply-1",
                author: "agent",
                source: "agent",
                senderAgentId: "sales-outbound",
                text: "RAW_COLLABORATOR_RESULT",
                createdAt: "2026-08-12T10:00:00.000Z",
                status: "completed",
                exchange: {
                  direction: "incoming",
                  messageId: "reply-1",
                  senderAgentId: "sales-outbound",
                  recipientAgentIds: ["chief"],
                  replyToMessageId: "request-1",
                  deliveries: [
                    {
                      id: "delivery-reply-1",
                      recipientAgentId: "chief",
                      status: "completed",
                      position: null,
                      error: null,
                    },
                  ],
                },
              },
              {
                id: "assistant-summary-1",
                author: "assistant",
                text: "Sales Outbound reports that the pipeline is ready.",
                createdAt: "2026-08-12T10:00:01.000Z",
                status: "completed",
              },
            ]
          : [],
    }));

    render(() => <App />);
    expect(await screen.findByRole("button", { name: "Open chat with Sales Outbound" })).toBeInTheDocument();
    expect(screen.queryByText("RAW_COLLABORATOR_RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("Sales Outbound reports that the pipeline is ready.")).toBeInTheDocument();
  });

  it("does not let a late history refresh overwrite a newer streamed snapshot", async () => {
    let resolveHistory: ((snapshot: ConversationSnapshot) => void) | undefined;
    vi.mocked(window.openbot.agent.readConversation).mockImplementation(
      (agentId) =>
        new Promise<ConversationSnapshot>((resolve) => {
          resolveHistory = resolve;
          expect(agentId).toBe("chief");
        }),
    );

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: "turn-live",
        revision: 2,
        messages: [
          {
            id: "live-message",
            author: "assistant",
            text: "Newest streamed answer",
            createdAt: "2026-08-12T10:00:01.000Z",
            status: "streaming",
          },
        ],
      },
    });
    expect(await screen.findByText("Newest streamed answer")).toBeInTheDocument();

    resolveHistory?.({
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "old-message",
          author: "assistant",
          text: "Stale history answer",
          createdAt: "2026-08-12T09:59:59.000Z",
          status: "completed",
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Newest streamed answer")).toBeInTheDocument();
      expect(screen.queryByText("Stale history answer")).not.toBeInTheDocument();
    });
  });

  it("states an agent's error once above the composer, not in the transcript", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    emitAgentEvent?.({
      type: "error",
      agentId: "chief",
      code: "agent_error",
      message: "The model endpoint refused the request.",
    });

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("The model endpoint refused the request.");
    // The banner is the whole report: no transcript bubble and no toast beside it.
    expect(screen.getAllByText("The model endpoint refused the request.")).toHaveLength(1);
    expect(screen.queryByText("Chief could not continue")).not.toBeInTheDocument();
  });

  function signedOutCodexStatus(): AgentStatus {
    return {
      phase: "ready" as const,
      cliVersion: "0.144.1",
      auth: { kind: "signed-out" as const },
      providers: [{ id: "codex" as const, state: "sign-in-required" as const, version: "0.144.1", message: null }],
      capabilities: { chat: "ready" as const, browser: "ready" as const, computerUse: "ready" as const },
      message: null,
      fullAccess: true,
    };
  }

  /**
   * An agent on `provider`, with that provider reporting a signed-out CLI. Every composer sign-in
   * case starts here and differs only in what it expects the notice to offer.
   */
  async function renderSignedOutProvider(provider: "codex" | "claude" | "opencode", model: string): Promise<void> {
    if (provider !== "codex") {
      vi.mocked(window.openbot.agent.listAgents).mockResolvedValueOnce([{ ...AGENTS[0], provider, model }]);
    }
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "status",
      status: {
        ...signedOutCodexStatus(),
        providers: [{ id: provider, state: "sign-in-required" as const, version: "1.0.0", message: null }],
      },
    });
  }

  it("offers a provider sign-in above the composer before the user sends", async () => {
    await renderSignedOutProvider("codex", "gpt-5");

    const signIn = await screen.findByRole("button", { name: "Sign in to ChatGPT" });
    expect(screen.getByText("Sign in to ChatGPT to send messages.")).toBeVisible();
    // The draft survives the sign-in, so the notice never costs the user their message.
    expect(screen.getByRole("textbox", { name: "Message Chief" })).toBeInTheDocument();

    await fireEvent.click(signIn);
    await waitFor(() => expect(window.openbot.connectProvider).toHaveBeenCalledWith("codex"));
  });

  it("starts the Claude login from the composer notice rather than opening a page", async () => {
    await renderSignedOutProvider("claude", "claude-sonnet-5");

    await fireEvent.click(await screen.findByRole("button", { name: "Sign in to Claude" }));

    // Claude signs in through its own CLI login, so the button connects the provider. It used to
    // open the authentication docs, which left the user to finish the sign-in themselves.
    await waitFor(() => expect(window.openbot.connectProvider).toHaveBeenCalledWith("claude"));
    expect(window.openbot.openExternal).not.toHaveBeenCalled();
  });

  it("offers no composer sign-in for OpenCode, whose key is pasted in settings", async () => {
    await renderSignedOutProvider("opencode", "opencode/big-pickle");

    // The notice would carry a button that starts nothing: OpenCode has no login to open, only a
    // key to paste in settings. The composer still takes the draft.
    expect(await screen.findByRole("textbox", { name: "Message Chief" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in to OpenCode" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required")).not.toBeInTheDocument();
  });

  it("states a spent plan window above the composer, and drops it when the window ends", async () => {
    const resetsAt = Math.floor(Date.now() / 1_000) + 3_600;
    vi.mocked(window.openbot.agent.getUsage).mockResolvedValue({
      limits: [{ id: "codex", primary: { usedPercent: 100, windowDurationMins: 300, resetsAt }, secondary: null }],
    });

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    expect(await screen.findByText("Usage limit reached")).toBeVisible();
    // The composer still takes a draft, so the user can write while they wait for the reset.
    expect(screen.getByRole("textbox", { name: "Message Chief" })).toBeInTheDocument();

    // The window ends with nobody sending, so the reading the provider gave is spent and stale.
    vi.mocked(window.openbot.agent.getUsage).mockResolvedValue({
      limits: [
        {
          id: "codex",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1_000) - 60 },
          secondary: null,
        },
      ],
    });
    emitAgentEvent?.({ type: "usage-changed", usage: { limits: [] } });

    await waitFor(() => expect(screen.queryByText("Usage limit reached")).not.toBeInTheDocument());
  });
  /**
   * A ChatGPT row signed in to one account, and the code sign-in that reaches another one.
   *
   * The provider is `available` before the login starts, so nothing about the account alone says
   * this login is over. What says it is the row reporting it is no longer connecting. The end of it
   * is a notification rather than a last screen, so the dialog is gone by the time it arrives.
   */
  function CodeLoginProbe() {
    const { codeLogin } = useProviders();
    const { agentStatus } = useAgents();
    const phase = () => {
      if (codeLogin.provider() === null) return "closed";
      const state = codeLogin.state();
      return state.phase === "waiting" ? `waiting ${state.userCode}` : state.phase;
    };
    const row = () => agentStatus().providers?.find((provider) => provider.id === "codex");
    return (
      <>
        <button type="button" onClick={() => codeLogin.start("codex")}>
          Log in with code
        </button>
        <button type="button" onClick={() => codeLogin.cancel()}>
          Cancel code login
        </button>
        <output aria-label="Code sign-in">{phase()}</output>
        <output aria-label="ChatGPT row">{`${row()?.state} ${row()?.connectionState ?? "idle"} ${row()?.email}`}</output>
        <Toaster />
      </>
    );
  }
  function codexStatus(codex: Partial<NonNullable<AgentStatus["providers"]>[number]>): AgentStatus {
    return {
      phase: "ready",
      cliVersion: "0.155.0",
      auth: { kind: "chatgpt", email: "first@example.com" },
      providers: [{ id: "codex", state: "available", version: "0.155.0", message: null, ...codex }],
      capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
      message: null,
      fullAccess: true,
    };
  }

  it.each([false, true])("keeps account-switch results correct when failure is %s", async (failed) => {
    render(() => (
      <AppProviders>
        <CodeLoginProbe />
      </AppProviders>
    ));
    emitAgentEvent?.({ type: "status", status: codexStatus({ email: "first@example.com" }) });
    await waitFor(() =>
      expect(screen.getByLabelText("ChatGPT row")).toHaveTextContent("available idle first@example.com"),
    );

    await fireEvent.click(screen.getByRole("button", { name: "Log in with code" }));
    await waitFor(() => expect(screen.getByLabelText("Code sign-in")).toHaveTextContent("waiting KTQ4-B62MX"));

    // The provider is working on the login, and the account the user already has is still on the
    // row. Reading that account as the answer would end the dialog before anyone typed the code.
    emitAgentEvent?.({
      type: "status",
      status: codexStatus({ connectionState: "connecting", email: "first@example.com" }),
    });
    await waitFor(() =>
      expect(screen.getByLabelText("ChatGPT row")).toHaveTextContent("available connecting first@example.com"),
    );
    expect(screen.getByLabelText("Code sign-in")).toHaveTextContent("waiting KTQ4-B62MX");

    // The second account arrives, and only now is the sign-in over: the dialog closes, and what
    // says which account was signed in to is a notification.
    emitAgentEvent?.({
      type: "status",
      status: codexStatus(
        failed
          ? { email: "first@example.com", message: "OpenBot could not connect ChatGPT. Try again." }
          : { email: "second@example.com" },
      ),
    });
    await waitFor(() => expect(screen.getByLabelText("Code sign-in")).toHaveTextContent("closed"));
    if (failed) {
      expect(await screen.findByText("Could not connect ChatGPT")).toBeVisible();
      expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
      expect(screen.queryByText("ChatGPT connected")).not.toBeInTheDocument();
    } else {
      expect(await screen.findByText("ChatGPT connected")).toBeVisible();
      expect(screen.getByText("Signed in as second@example.com.")).toBeVisible();
    }
  });
  it.each([false, true])("ignores a cancelled attempt when its reply fails: %s", async (failed) => {
    const oldReply = Promise.withResolvers<Awaited<ReturnType<typeof window.openbot.startProviderCodeLogin>>>();
    const cancellation = Promise.withResolvers<AgentStatus>();
    vi.mocked(window.openbot.startProviderCodeLogin).mockImplementationOnce(() => oldReply.promise);
    vi.mocked(window.openbot.cancelProviderCodeLogin).mockImplementationOnce(() => cancellation.promise);
    render(() => (
      <AppProviders>
        <CodeLoginProbe />
      </AppProviders>
    ));
    await fireEvent.click(screen.getByRole("button", { name: "Log in with code" }));
    await waitFor(() => expect(window.openbot.startProviderCodeLogin).toHaveBeenCalledTimes(1));
    await fireEvent.click(screen.getByRole("button", { name: "Cancel code login" }));
    await fireEvent.click(screen.getByRole("button", { name: "Log in with code" }));
    if (failed) oldReply.reject(new Error("Old login failed"));
    else
      oldReply.resolve({
        kind: "code",
        userCode: "OLD-CODE",
        verificationUrl: "https://auth.openai.com/codex/device",
        expiresAt: Date.now() + 600_000,
      });
    await oldReply.promise.catch(() => undefined);
    expect(screen.getByLabelText("Code sign-in")).toHaveTextContent("starting");
    expect(window.openbot.startProviderCodeLogin).toHaveBeenCalledTimes(1);
    emitAgentEvent?.({ type: "status", status: codexStatus({ email: "first@example.com" }) });
    cancellation.resolve(codexStatus({ email: "first@example.com" }));
    await waitFor(() => expect(window.openbot.startProviderCodeLogin).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Code sign-in")).toHaveTextContent("waiting KTQ4-B62MX"));
    expect(screen.queryByText("Could not connect ChatGPT")).not.toBeInTheDocument();
    emitAgentEvent?.({
      type: "status",
      status: codexStatus({ connectionState: "connecting", email: "first@example.com" }),
    });
    await waitFor(() => expect(screen.getByLabelText("ChatGPT row")).toHaveTextContent("connecting"));
    emitAgentEvent?.({ type: "status", status: codexStatus({ email: "second@example.com" }) });
    expect(await screen.findByText("Signed in as second@example.com.")).toBeVisible();
  });
});
