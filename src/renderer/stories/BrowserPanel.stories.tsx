import type { BrowserControlSession, BrowserTab } from "@openbot/contracts/ipc";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import BrowserPanel from "../src/features/conversation/BrowserPanel";

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
    tabs: [tab],
    activeTab: tab,
    activeControl: undefined,
    address: tab.url,
    defaultWidth: () => 520,
    maxWidth: () => 720,
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
    onWidthChange: fn(),
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
