import type { BrowserControlSession, BrowserLiveViewEvent, BrowserTab } from "@openbot/contracts/ipc";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import BrowserPanel from "@openbot/ui/features/browser/BrowserPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const tab: BrowserTab = {
  id: "tab-docs",
  title: "OpenBot documentation",
  url: "https://openbot.run/docs",
  loading: false,
  ownerThreadId: "thread-chief",
  ownerAgentId: "chief",
};

const control: BrowserControlSession = {
  id: "browser-session-1",
  threadId: "thread-chief",
  turnId: "turn-1",
  callId: "call-1",
  tabId: "tab-docs",
  action: "snapshot",
  phase: "acting",
  startedAt: new Date("2026-09-01T12:00:00.000Z").toISOString(),
};

const meta = {
  title: "Conversation/BrowserPanel",
  component: BrowserPanel,
  args: {
    open: true,
    liveViewTabId: null,
    liveViewRuntime: {
      startLiveView: fn(async () => undefined),
      stopLiveView: fn(async () => undefined),
      sendLiveViewInput: fn(async () => undefined),
      onLiveViewEvent: fn(() => () => undefined),
    },
    tabs: [tab],
    activeTab: tab,
    activeControl: undefined,
    address: tab.url,
    controlForTab: () => undefined,
    controllerForTab: () => undefined,
    onAddressChange: fn(),
    onAddressEditingChange: fn(),
    onOpenAddress: fn(),
    onNavigate: fn(),
    onReload: fn(),
    onActivateTab: fn(),
    onCloseTab: fn(),
    onSurface: fn(),
    onBack: fn(),
    onEnterPip: fn(),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An idle tab with no recording or diagnostic indicators. */
export const Idle: Story = {
  args: {
    activeTab: {
      ...tab,
      environment: {
        viewport: { mode: "fill", width: 1200, height: 800, deviceScaleFactor: 1, preset: null },
        colorScheme: "system",
        reducedMotion: false,
      },
    },
  },
};

/**
 * On macOS the traffic lights are drawn over the top of this full-bleed panel, so the tab strip
 * starts clear of them. Compare with `Idle`, which starts at the window edge.
 */
export const MacWindowControls: Story = {
  args: {
    macWindowControls: true,
    tabs: [tab, { ...tab, id: "tab-changelog", title: "Changelog", url: "https://openbot.run/changelog" }],
  },
};

/** A tab with the mobile viewport preset. */
export const MobileViewport: Story = {
  args: {
    activeTab: {
      ...tab,
      environment: {
        viewport: { mode: "custom", width: 390, height: 844, deviceScaleFactor: 3, preset: "mobile" },
        colorScheme: "dark",
        reducedMotion: true,
      },
    },
  },
};

/** Recording and diagnostic indicators appear together beside the address bar. */
export const RecordingWithDiagnosticErrors: Story = {
  args: {
    activeTab: {
      ...tab,
      environment: {
        viewport: { mode: "custom", width: 390, height: 844, deviceScaleFactor: 3, preset: "mobile" },
        colorScheme: "dark",
        reducedMotion: false,
      },
      recording: true,
      diagnosticErrorCount: 12,
    },
    activeControl: { ...control, detailAction: "select-option" },
    controlForTab: () => ({ ...control, detailAction: "select-option" }),
    controllerForTab: () => undefined,
  },
};

/**
 * Exactly one diagnostic error. The count reaches the chip's label as well as its text, and this is
 * the case that read "1 browser diagnostic errors" until the label learned to count.
 */
export const SingleDiagnosticError: Story = {
  args: {
    activeTab: {
      ...tab,
      environment: {
        viewport: { mode: "fill", width: 1200, height: 800, deviceScaleFactor: 1, preset: null },
        colorScheme: "system",
        reducedMotion: false,
      },
      diagnosticErrorCount: 1,
    },
  },
};

/** Recording and diagnostic indicators in a narrow panel. */
export const NarrowPanel: Story = {
  args: {
    ...RecordingWithDiagnosticErrors.args,
    defaultWidth: () => 320,
    maxWidth: () => 320,
  },
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

/** A host that sends one 4:3 frame, drawn in the theme's colors. */
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

/**
 * A remote host's tab, as the web app and a desktop connected to a host show it. The panel is a card
 * of the frame's shape over the app, not a full-bleed window, and has no Picture in Picture.
 */
export const RemoteLiveView: Story = {
  args: {
    liveViewTabId: tab.id,
    liveViewRuntime: remoteLiveViewRuntime(),
    canEnterPip: false,
  },
};
