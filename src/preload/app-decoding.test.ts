import type {
  AccountSession,
  AppAppearancePreference,
  AppInfo,
  ApprovalAutomationPreference,
  AppSetupState,
  AppThemePalette,
  CentralAuthState,
  MobileConnectedDevice,
  NotificationOpenedEvent,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeAccountSessions,
  decodeAnalyticsPreference,
  decodeAppAppearancePreference,
  decodeAppBehaviorPreference,
  decodeAppInfo,
  decodeAppLanguagePreference,
  decodeApprovalAutomationPreference,
  decodeAppSetupState,
  decodeCentralAuthState,
  decodeChatWindowTargets,
  decodeCustomAgentResult,
  decodeCustomAgents,
  decodeCustomAgentUsage,
  decodeDetectedModelServers,
  decodeDiscoverModelsResult,
  decodeMobileConnectedDevices,
  decodeMobileConnectTicket,
  decodeNotificationOpenedEvent,
  decodeNotificationPreference,
  decodePendingMarketplaceListing,
  decodeProviderDetectionSettings,
  decodeSentMessageStats,
  decodeUpdatePreference,
  decodeUpdateStatus,
  decodeVoiceServerProbe,
  decodeVoiceServerSettings,
} from "./app-decoding";

const omarchyPalette = {
  id: "omarchy",
  name: "Omarchy",
  scheme: "dark",
  colors: {
    canvas: "#1a1b26",
    frame: "#13141c",
    sidebar: "#13141c",
    surface: "#24283b",
    text: "#a9b1d6",
    textMuted: "#565f89",
    border: "#414868",
    accent: "#7aa2f7",
    accentForeground: "#1a1b26",
    success: "#9ece6a",
    warning: "#e0af68",
    danger: "#f7768e",
  },
} satisfies AppThemePalette;

const updateStatus = {
  phase: "downloading",
  currentVersion: "1.0.0",
  availableVersion: "1.1.0",
  progress: 40,
  checkedAt: "2026-09-23T10:00:00.000Z",
  message: null,
  errorCode: null,
} satisfies UpdateStatus;

const detectedServer = {
  id: "ollama",
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  models: [{ id: "qwen3" }],
};

const customAgent = {
  id: "goose",
  name: "Goose",
  command: "goose",
  args: ["acp"],
  envNames: ["OPENAI_API_KEY"],
  usagePrompt: null,
  resolvedCommand: "/opt/homebrew/bin/goose",
};

const codeSent = {
  status: "code_sent",
  challengeId: "challenge-1",
  email: "user@example.com",
  expiresAt: 2,
  resendAvailableAt: 1,
} satisfies CentralAuthState;

// Each value is what main sends, typed as its contract, so it must come back unchanged.
const voiceServer = {
  address: "http://studio.local:8000/v1",
  hasApiKey: true,
  routes: {
    dictation: true,
    speech: false,
    transcriptionModel: "Systran/faster-whisper-large-v3",
    speechModel: null,
    voice: null,
  },
};

const valid: [string, (value: unknown) => unknown, unknown][] = [
  [
    "app behavior with a quit guard",
    decodeAppBehaviorPreference,
    {
      launchAtLogin: true,
      keepRunningInBackground: false,
      keepAwake: null,
      keepAwakeOnBattery: null,
      quitGuard: "always",
    },
  ],
  [
    "app behavior with no quit guard",
    decodeAppBehaviorPreference,
    { launchAtLogin: true, keepRunningInBackground: false, keepAwake: null, keepAwakeOnBattery: null, quitGuard: null },
  ],
  ["a voice server", decodeVoiceServerSettings, voiceServer],
  ["no voice server", decodeVoiceServerSettings, null],
  [
    "a voice server test that found models",
    decodeVoiceServerProbe,
    { ok: true, models: { transcription: ["whisper-1"], speech: ["kokoro"], voices: ["af_heart"] } },
  ],
  [
    "a voice server test that failed",
    decodeVoiceServerProbe,
    { ok: false, field: "apiKey", message: "studio.local:8000 refused the API key." },
  ],
  [
    "app info",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "darwin", variant: "dev" } satisfies AppInfo,
  ],
  [
    "app info with an install ID",
    decodeAppInfo,
    {
      name: "OpenBot",
      version: "1.0.0",
      platform: "darwin",
      variant: "production",
      analyticsInstallId: "install-0b5c7c9e-8d55-4a3f-9d0e-2f7c1a6b4e21",
    } satisfies AppInfo,
  ],
  [
    "app info drawn on the CPU",
    decodeAppInfo,
    {
      name: "OpenBot",
      version: "1.0.0",
      platform: "linux",
      variant: "production",
      softwareRendering: true,
    } satisfies AppInfo,
  ],
  ["sent message stats", decodeSentMessageStats, { firstSentAt: "2026-11-01T09:30:00.000Z", sentCount: 12 }],
  ["sent message stats before the first message", decodeSentMessageStats, { firstSentAt: null, sentCount: 0 }],
  [
    "setup state",
    decodeAppSetupState,
    { completed: true, preferredProvider: "codex", preferredModel: null } satisfies AppSetupState,
  ],
  ["analytics preference", decodeAnalyticsPreference, { enabled: false }],
  [
    "approval automation",
    decodeApprovalAutomationPreference,
    {
      defaultAutoApprove: true,
      autoApproveOverrides: { "agent-1": false },
    } satisfies ApprovalAutomationPreference,
  ],
  ["language preference", decodeAppLanguagePreference, { language: "fr" }],
  [
    "appearance preference",
    decodeAppAppearancePreference,
    {
      appearance: "light",
      transparentWindow: true,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
    } satisfies AppAppearancePreference,
  ],
  [
    "appearance preference with a theme palette",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: "omarchy",
      palettes: [omarchyPalette],
      chatBackgroundLight: null,
      chatBackgroundDark: null,
    },
  ],
  [
    "appearance preference with a chat background for each scheme",
    decodeAppAppearancePreference,
    {
      appearance: "system",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: "#f1f2ff",
      chatBackgroundDark: "#162232",
    } satisfies AppAppearancePreference,
  ],
  ["signed out", decodeCentralAuthState, { status: "signed_out" } satisfies CentralAuthState],
  [
    "signed out after a keyring change",
    decodeCentralAuthState,
    { status: "signed_out", reason: "keyring_changed" } satisfies CentralAuthState,
  ],
  ["code sent", decodeCentralAuthState, codeSent],
  [
    "code sent with every option",
    decodeCentralAuthState,
    {
      ...codeSent,
      developmentCode: "123456",
      issue: { code: "rate_limited", message: "Wait.", retryAfterSeconds: 30 },
    } satisfies CentralAuthState,
  ],
  [
    "signed in",
    decodeCentralAuthState,
    {
      status: "signed_in",
      user: { id: "user-1", email: "user@example.com", name: null, avatarUrl: null },
    } satisfies CentralAuthState,
  ],
  [
    "signed in with an analytics answer",
    decodeCentralAuthState,
    {
      status: "signed_in",
      user: { id: "user-1", email: "user@example.com", name: null, avatarUrl: null, analyticsEnabled: true },
    } satisfies CentralAuthState,
  ],
  [
    "signed in with a chat color",
    decodeCentralAuthState,
    {
      status: "signed_in",
      user: { id: "user-1", email: "user@example.com", name: null, avatarUrl: null, chatColor: "#3b82f6" },
    } satisfies CentralAuthState,
  ],
  [
    "signed in with no chat color",
    decodeCentralAuthState,
    {
      status: "signed_in",
      user: { id: "user-1", email: "user@example.com", name: null, avatarUrl: null, chatColor: null },
    } satisfies CentralAuthState,
  ],
  [
    "account error",
    decodeCentralAuthState,
    { status: "error", issue: { code: "offline", message: "No network." } } satisfies CentralAuthState,
  ],
  ["Mobile Connect ticket", decodeMobileConnectTicket, { qrData: "openbot://mobile-connect", expiresAt: 1 }],
  [
    "connected devices",
    decodeMobileConnectedDevices,
    [
      { sessionId: "session-1", name: "Phone", platform: "ios", connectedAt: 1, lastActiveAt: 2, via: "link" },
    ] satisfies MobileConnectedDevice[],
  ],
  [
    "account sessions",
    decodeAccountSessions,
    [
      { sessionId: "session-1", name: "Mac", kind: "desktop", current: true, connectedAt: 1, lastActiveAt: 2 },
    ] satisfies AccountSession[],
  ],
  ["update status", decodeUpdateStatus, updateStatus],
  ["host-managed update status", decodeUpdateStatus, { ...updateStatus, managedByHost: true } satisfies UpdateStatus],
  ["update preference", decodeUpdatePreference, { autoDownload: true, allowRemoteUpdates: true, autoInstall: false }],
  ["notification preference", decodeNotificationPreference, { desktopNotifications: true, messagePreview: false }],
  [
    "opened notification",
    decodeNotificationOpenedEvent,
    { serverId: "local", agentId: "agent-1", threadId: null } satisfies NotificationOpenedEvent,
  ],
  [
    "opened channel notification",
    decodeNotificationOpenedEvent,
    { serverId: "local", agentId: "agent-1", threadId: null, channelId: "channel-1" } satisfies NotificationOpenedEvent,
  ],
  ["chat windows", decodeChatWindowTargets, [{ serverId: "local", agentId: "agent-1" }]],
  ["detected model servers", decodeDetectedModelServers, [detectedServer]],
  ["custom agents", decodeCustomAgents, [customAgent, { ...customAgent, id: "qwen", resolvedCommand: null }]],
  ["a custom agent with a usage prompt", decodeCustomAgents, [{ ...customAgent, usagePrompt: "/usage" }]],
  [
    // The released acp-registry-v1 install codec keeps only the fields that it knew.
    "a registry install result with no usage prompt",
    decodeCustomAgentResult,
    {
      agents: [Object.fromEntries(Object.entries(customAgent).filter(([key]) => key !== "usagePrompt"))],
      restart: "not-running",
    },
  ],
  ["custom agent usage", decodeCustomAgentUsage, [{ id: "devin", text: "Plan: Pro\n42% left" }]],
  ["a model list", decodeDiscoverModelsResult, { models: [{ id: "qwen3" }] }],
  [
    "detection settings",
    decodeProviderDetectionSettings,
    { enabled: true, addresses: ["http://192.168.1.20:11434/v1"], folders: ["~/bin"], hiddenIds: [] },
  ],
];

const malformed: [string, (value: unknown) => unknown, unknown][] = [
  [
    "an unknown quit guard",
    decodeAppBehaviorPreference,
    {
      launchAtLogin: true,
      keepRunningInBackground: false,
      keepAwake: null,
      keepAwakeOnBattery: null,
      quitGuard: "sometimes",
    },
  ],
  [
    "a missing quit guard",
    decodeAppBehaviorPreference,
    { launchAtLogin: true, keepRunningInBackground: false, keepAwake: null, keepAwakeOnBattery: null },
  ],
  ["sent message stats with a negative count", decodeSentMessageStats, { firstSentAt: null, sentCount: -1 }],
  [
    "app info with an install ID that is not text",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "darwin", variant: "production", analyticsInstallId: 1 },
  ],
  [
    "app info with a software rendering flag that is not a boolean",
    decodeAppInfo,
    { name: "OpenBot", version: "1.0.0", platform: "linux", variant: "production", softwareRendering: "yes" },
  ],
  // The key never comes back to the renderer, so a record that carries one fails closed.
  ["a voice server with its key", decodeVoiceServerSettings, { ...voiceServer, apiKey: "sk-secret" }],
  [
    "a voice server that dictates with no model",
    decodeVoiceServerSettings,
    { ...voiceServer, routes: { ...voiceServer.routes, transcriptionModel: null } },
  ],
  [
    "a voice server that speaks with no voice",
    decodeVoiceServerSettings,
    { ...voiceServer, routes: { ...voiceServer.routes, speech: true, speechModel: "kokoro", voice: null } },
  ],
  ["a voice server test with an unknown field", decodeVoiceServerProbe, { ok: false, field: "model", message: "" }],
  [
    "a voice server test with an empty model",
    decodeVoiceServerProbe,
    { ok: true, models: { transcription: [""], speech: [], voices: [] } },
  ],
  [
    "app info on an unknown platform",
    decodeAppInfo,
    { name: "OpenBot", version: "1", platform: "aix", variant: "dev" },
  ],
  [
    "setup state with an unknown provider",
    decodeAppSetupState,
    { completed: true, preferredProvider: "other", preferredModel: null },
  ],
  ["analytics preference without a switch", decodeAnalyticsPreference, {}],
  ["approval automation without overrides", decodeApprovalAutomationPreference, { defaultAutoApprove: true }],
  ["language preference with an unknown tag", decodeAppLanguagePreference, { language: "xx" }],
  ["appearance preference with no transparent window", decodeAppAppearancePreference, { appearance: "dark" }],
  [
    "appearance preference with a string transparent window",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: "true" },
  ],
  [
    "appearance preference with no theme palettes",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: false, palette: null },
  ],
  [
    "a theme palette id with a path",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: false, palette: "../omarchy", palettes: [] },
  ],
  [
    "a theme palette color that is not hex",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [{ ...omarchyPalette, colors: { ...omarchyPalette.colors, accent: "red; background: url(x)" } }],
    },
  ],
  [
    "a theme palette with a missing color",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [{ ...omarchyPalette, colors: { canvas: "#1a1b26" } }],
    },
  ],
  [
    "appearance preference with no chat background",
    decodeAppAppearancePreference,
    { appearance: "dark", transparentWindow: false, palette: null, palettes: [] },
  ],
  [
    "a chat background that is not a hex color",
    decodeAppAppearancePreference,
    {
      appearance: "dark",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: null,
      chatBackgroundDark: "red; background: url(x)",
    },
  ],
  [
    "a chat background with an alpha channel",
    decodeAppAppearancePreference,
    {
      appearance: "light",
      transparentWindow: false,
      palette: null,
      palettes: [],
      chatBackgroundLight: "#f1f2ff00",
      chatBackgroundDark: null,
    },
  ],
  ["an unknown account status", decodeCentralAuthState, { status: "banned" }],
  ["signed out with an unknown reason", decodeCentralAuthState, { status: "signed_out", reason: "expired" }],
  ["signed in without a user", decodeCentralAuthState, { status: "signed_in" }],
  ["code sent with a text expiry", decodeCentralAuthState, { ...codeSent, expiresAt: "soon" }],
  ["Mobile Connect ticket without data", decodeMobileConnectTicket, { expiresAt: 1 }],
  ["a device on an unknown platform", decodeMobileConnectedDevices, [{ sessionId: "s", name: "n", platform: "tv" }]],
  ["account sessions that are not a list", decodeAccountSessions, { sessionId: "s" }],
  ["update status in an unknown phase", decodeUpdateStatus, { ...updateStatus, phase: "done" }],
  ["update status with an unknown failure", decodeUpdateStatus, { ...updateStatus, errorCode: "boom" }],
  ["update preference without a switch", decodeUpdatePreference, null],
  ["notification preference without a switch", decodeNotificationPreference, { desktopNotifications: "yes" }],
  ["opened notification without an agent", decodeNotificationOpenedEvent, { serverId: "local", threadId: null }],
  [
    "opened notification with a non-string channel",
    decodeNotificationOpenedEvent,
    { serverId: "local", agentId: "agent-1", threadId: null, channelId: 7 },
  ],
  ["a chat window without an agent", decodeChatWindowTargets, [{ serverId: "local" }]],
  ["chat windows that are not a list", decodeChatWindowTargets, { serverId: "local", agentId: "agent-1" }],
  // A scan row never carries a credential, so one that does is refused with the whole list.
  ["a detected server with a key", decodeDetectedModelServers, [{ ...detectedServer, apiKey: "sk-x" }]],
  ["a detected server with headers", decodeDetectedModelServers, [{ ...detectedServer, headers: [] }]],
  // A custom agent summary never carries an environment value, so one that does is refused with the whole list.
  ["a custom agent with its environment", decodeCustomAgents, [{ ...customAgent, env: [] }]],
  ["a custom agent with its ciphertext", decodeCustomAgents, [{ ...customAgent, secret: "c2VhbGVk" }]],
  ["a custom agent with a value", decodeCustomAgents, [{ ...customAgent, value: "sk-x" }]],
  ["a custom agent with a two-line usage prompt", decodeCustomAgents, [{ ...customAgent, usagePrompt: "/usage\nrm" }]],
  ["custom agent usage of an invalid id", decodeCustomAgentUsage, [{ id: "Not An Id", text: "42%" }]],
  ["custom agent usage with no text", decodeCustomAgentUsage, [{ id: "devin", text: null }]],
  [
    "an account analytics answer that is not a yes or a no",
    decodeCentralAuthState,
    {
      status: "signed_in",
      user: { id: "user-1", email: "user@example.com", name: null, avatarUrl: null, analyticsEnabled: "yes" },
    },
  ],
  [
    "an account chat color that is not a lower-case hex color",
    decodeCentralAuthState,
    {
      status: "signed_in",
      user: { id: "user-1", email: "user@example.com", name: null, avatarUrl: null, chatColor: "#3B82F6" },
    },
  ],
  [
    "an account chat color that is a CSS expression",
    decodeCentralAuthState,
    {
      status: "signed_in",
      user: { id: "user-1", email: "user@example.com", name: null, avatarUrl: null, chatColor: "red;x:url(a)" },
    },
  ],
  ["a model list with an empty id", decodeDiscoverModelsResult, { models: [{ id: "" }] }],
  [
    "detection settings without a switch",
    decodeProviderDetectionSettings,
    { addresses: [], folders: [], hiddenIds: [] },
  ],
];

describe("app decoding", () => {
  it.each(valid)("keeps %s unchanged", (_name, decode, value) => {
    expect(decode(value)).toEqual(value);
  });

  it.each(malformed)("rejects %s", (_name, decode, value) => {
    expect(() => decode(value)).toThrow(/^Invalid /);
  });
});

const AGENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

// A Marketplace link began in a URL a web page chose. Only an agent id or a skill slug of the right
// form reaches the renderer, with no other field; anything else is no link at all.
describe("pending Marketplace listing", () => {
  it.each([
    ["an agent", { kind: "agent", id: AGENT_ID }],
    ["a curated agent", { kind: "agent", id: "openbot-curated-agent-copy-editor" }],
    ["a skill", { kind: "skill", id: "release-notes" }],
  ])("keeps %s", (_name, value) => {
    expect(decodePendingMarketplaceListing(value)).toEqual(value);
  });

  it("drops a field main did not name", () => {
    expect(decodePendingMarketplaceListing({ kind: "skill", id: "release-notes", install: true })).toEqual({
      kind: "skill",
      id: "release-notes",
    });
  });

  it.each([
    ["no link", null],
    ["a bare slug", "release-notes"],
    ["an unknown kind", { kind: "plugin", id: "release-notes" }],
    ["an agent id in upper case", { kind: "agent", id: AGENT_ID.toUpperCase() }],
    ["an agent with a path", { kind: "agent", id: "../account" }],
    ["an agent with a dot", { kind: "agent", id: "agent.md" }],
    ["an agent id over 128 characters", { kind: "agent", id: "a".repeat(129) }],
    ["a skill with a path", { kind: "skill", id: "../account" }],
    ["a skill with a dot", { kind: "skill", id: "notes.md" }],
    ["a skill slug over 64 characters", { kind: "skill", id: "a".repeat(65) }],
    ["an empty id", { kind: "skill", id: "" }],
    ["an id that is not text", { kind: "agent", id: 42 }],
  ])("refuses %s", (_name, value) => {
    expect(decodePendingMarketplaceListing(value)).toBeNull();
  });
});
