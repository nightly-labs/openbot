import type {
  BrowserControlSession,
  BrowserDockIsland,
  BrowserLiveViewEvent,
  BrowserTab,
} from "@openbot/contracts/ipc";
import { BrowserDock } from "@openbot/ui/features/browser/BrowserDock";
import BrowserFullView from "@openbot/ui/features/browser/BrowserFullView";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "./fixtures";

const chief = requireFixture(STORY_AGENTS[0], "Story agent 0");

const tab: BrowserTab = {
  id: "tab-docs",
  title: "OpenBot documentation",
  url: "https://openbot.run/docs",
  loading: false,
  ownerThreadId: "thread-chief",
  ownerAgentId: chief.id,
  canGoBack: true,
  canGoForward: false,
};

const tabs: BrowserTab[] = [
  tab,
  { ...tab, id: "tab-changelog", title: "Changelog", url: "https://openbot.run/changelog" },
  { ...tab, id: "tab-pricing", title: "Pricing", url: "https://openbot.run/pricing", loading: true },
  {
    ...tab,
    id: "tab-search",
    title: "browser automation - Google Search",
    url: "https://www.google.com/search?q=browser+automation",
    ownerThreadId: null,
    ownerAgentId: null,
  },
];

const control: BrowserControlSession = {
  id: "browser-session-1",
  threadId: "thread-chief",
  turnId: "turn-1",
  callId: "call-1",
  tabId: tab.id,
  action: "click",
  phase: "acting",
  startedAt: new Date("2026-10-17T09:00:00.000Z").toISOString(),
};

const meta = {
  title: "Conversation/BrowserFullView",
  component: BrowserFullView,
  args: {
    open: true,
    tabs,
    activeTab: tab,
    history: [
      { url: "https://openbot.run/docs", title: "OpenBot documentation", visits: 3 },
      { url: "https://openbot.run/docs/browser", title: "Browser · OpenBot documentation", visits: 1 },
    ],
    canReopen: true,
    controlForTab: () => undefined,
    controllerForTab: () => undefined,
    ownerForTab: (entry) => (entry.ownerAgentId === chief.id ? chief : undefined),
    onActivateTab: fn(),
    onCloseTabs: fn(),
    onNewTab: fn(() => Promise.resolve()),
    onDuplicateTab: fn(),
    onMoveTab: fn(),
    onReopenTab: fn(),
    onReload: fn(),
    onStop: fn(),
    onNavigate: fn(),
    onOpenAddress: fn(),
    onSurface: fn(),
    liveViewTabId: null,
    liveViewRuntime: {
      startLiveView: fn(async () => undefined),
      stopLiveView: fn(async () => undefined),
      sendLiveViewInput: fn(async () => undefined),
      onLiveViewEvent: fn(() => () => undefined),
    },
    liveViewClipboard: false,
    shortcuts: "mac",
    onBack: fn(),
    onEnterPip: fn(),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserFullView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tabs: Story = {};

export const SignInOnThisComputer: Story = {
  args: {
    activeTab: { ...tab, title: "Log in to X / X", url: "https://x.com/i/flow/login" },
    tabs: [{ ...tab, title: "Log in to X / X", url: "https://x.com/i/flow/login" }, ...tabs.slice(1)],
    onSignInLocally: fn(),
  },
};

export const MacWindowControls: Story = { args: { macWindowControls: true } };

export const Loading: Story = { args: { activeTab: tabs[2] } };

function StoryDock(props: { island: BrowserDockIsland; working: boolean }) {
  const [answered, setAnswered] = createSignal(false);
  const answer = async () => {
    setAnswered(true);
    return true;
  };
  return (
    <BrowserDock
      agent={chief}
      agents={STORY_AGENTS}
      value=""
      working={props.working || answered()}
      deliveries={[]}
      canSteer={props.working || answered()}
      island={answered() ? null : props.island}
      onHandoff={fn()}
      onValueChange={fn()}
      onSend={fn()}
      onStop={fn()}
      onSteer={fn()}
      onCancel={fn()}
      onEdit={fn()}
      onCancelEdit={fn()}
      onReorder={fn()}
      onRespondSecret={fn(async () => undefined)}
      onAnswerPrompt={fn(answer)}
      onRespondApproval={fn(answer)}
      onDismissReply={fn()}
      onSelectAgent={fn()}
      onOpenLink={fn()}
    />
  );
}

export const AgentActing: Story = {
  args: {
    controlForTab: (entry: BrowserTab) => (entry.id === tab.id ? control : undefined),
    controllerForTab: (entry: BrowserTab) => (entry.id === tab.id ? chief : undefined),
    dock: <StoryDock island={{ kind: "activity", control: "agent", label: "Clicking “Sign in”" }} working />,
  },
};

export const AgentAsks: Story = {
  args: {
    dock: (
      <StoryDock
        island={{
          kind: "prompt",
          requestId: "prompt-1",
          attempt: 0,
          questions: [
            {
              id: "slot",
              header: "Time",
              question: "Friday at 19:30 is full. Which time should I book?",
              isSecret: false,
              options: [
                { label: "18:00", description: "Window table for 4." },
                { label: "21:15", description: "Inside, near the bar." },
                { label: "Saturday 19:30", description: "Same table, one day later." },
              ],
            },
          ],
        }}
        working={false}
      />
    ),
  },
};

export const AgentNeedsApproval: Story = {
  args: {
    dock: (
      <StoryDock
        island={{
          kind: "approval",
          attempt: 0,
          approval: {
            requestId: "approval-1",
            agentId: chief.id,
            threadId: "thread-chief",
            turnId: "turn-1",
            kind: "command",
            command: "curl -s https://trattoria-roma.example/api/slots > slots.json",
            cwd: "~/OpenBot/Agents/chief",
            reason: "Save the free tables to a file in the workspace.",
            grantRoot: null,
            permissions: null,
          },
        }}
        working={false}
      />
    ),
  },
};

export const NamedProfile: Story = {
  args: {
    profileForTab: (entry: BrowserTab) =>
      entry.ownerAgentId === chief.id ? { tabId: entry.id, name: "Client A", hue: 215 } : undefined,
  },
};

export const RecordingWithDiagnosticErrors: Story = {
  args: { activeTab: { ...tab, recording: true, diagnosticErrorCount: 12 } },
};

export const PopupBlocked: Story = {
  args: {
    activeTab: {
      ...tab,
      popupFailure: {
        id: "blocked-popup",
        message: "The browser tab limit was reached. Close a tab, then retry from the page.",
      },
    },
  },
};

const teach = { agentName: chief.name, pending: false, onStart: fn(), onSave: fn(), onClose: fn() };

export const TeachTask: Story = { args: { teach: { ...teach, startedAt: null } } };

export const TeachTaskRecording: Story = { args: { teach: { ...teach, startedAt: Date.now() - 6000 } } };

export const Empty: Story = { args: { tabs: [], activeTab: undefined, canReopen: false } };

function remoteLiveViewRuntime(): BrowserViewRuntime {
  const listeners = new Set<(event: BrowserLiveViewEvent) => void>();
  return {
    async startLiveView(tabId) {
      const width = 1024;
      const height = 768;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      const theme = getComputedStyle(document.documentElement);
      if (context) {
        context.fillStyle = theme.getPropertyValue("--openbot-bg-surface");
        context.fillRect(0, 0, width, height);
        context.fillStyle = theme.getPropertyValue("--openbot-text-primary");
        context.font = "48px sans-serif";
        context.fillText("Page on the host", 64, 128);
      }
      const image = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
      for (const listener of listeners) listener({ type: "frame", tabId, sequence: 1, width, height, image });
    },
    stopLiveView: async () => undefined,
    sendLiveViewInput: async () => undefined,
    onLiveViewEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const RemoteLiveView: Story = {
  args: {
    liveViewTabId: tab.id,
    liveViewRuntime: remoteLiveViewRuntime(),
    canEnterPip: false,
    shortcuts: undefined,
  },
};
