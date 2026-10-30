import type {
  AccountSession,
  AppInfo,
  ApprovalAutomationPreference,
  AppSetupState,
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
  decodeProviderDetectionSettings,
  decodeUpdatePreference,
  decodeUpdateStatus,
  decodeVoiceServerProbe,
  decodeVoiceServerSettings,
} from "./app-decoding";

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
  ["appearance preference", decodeAppAppearancePreference, { appearance: "light", transparentWindow: true }],
  ["signed out", decodeCentralAuthState, { status: "signed_out" } satisfies CentralAuthState],
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
  ["an unknown account status", decodeCentralAuthState, { status: "banned" }],
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
