// @vitest-environment node

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { CUSTOM_PROVIDER_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  parseAcknowledgeFailedTurn,
  parseAgentId,
  parseAgentRequest,
  parseApprovalResponse,
  parseBrowserTakeoverResponse,
  parseCancelQueuedMessage,
  parseChooseAttachments,
  parseCreateAgent,
  parseCreateAgentMemory,
  parseCreateRoutine,
  parseDeleteAgentMemory,
  parseDeleteRoutine,
  parseImportAttachments,
  parseInterrupt,
  parseListRoutineRuns,
  parseMarkConversationRead,
  parseMessageReaction,
  parseOpenAttachment,
  parseOpenSharedFile,
  parseOpenWorkspaceFile,
  parsePromptResponse,
  parseReorderQueue,
  parseSendMessage,
  parseSidebarLayoutAction,
  parseSteerQueuedMessage,
  parseUpdateAgent,
  parseUpdateAgentMemory,
  parseUpdateQueuedMessage,
  parseUpdateRoutine,
} from "./agent-inputs";
import {
  parseAnalyticsPreference,
  parseDynamicIslandAction,
  parseDynamicIslandInteractive,
  parseDynamicIslandPreference,
  parseDynamicIslandPresentation,
  parseExternalDestination,
  parseMacPermission,
  parseMarketplaceAgentQuery,
  parseMarketplaceSkillQuery,
  parseProfileName,
  parseProviderId,
  parseSetup,
  parseSubmitMarketplaceAgent,
  parseSubmitSkill,
  parseUpdatePreference,
} from "./app-inputs";
import { parseBrowserNavigate, parseBrowserOpen, parseVisibility } from "./browser-inputs";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "./custom-provider-inputs";
import {
  parseCreateTeamInvite,
  parseHostConfig,
  parseJoinServer,
  parseLoginServer,
  parseMarkDirectRead,
  parseReorderServers,
  parseUpdateTeamMember,
} from "./server-inputs";
import { nullishPayload, optionalPayload, requireString } from "./validation";
import { parseVoiceTranscription } from "./voice-inputs";

describe("app IPC input parsing", () => {
  it("validates creator photo consent and agent categories without changing legacy submissions", () => {
    expect(parseSubmitMarketplaceAgent({ agentId: "agent-1" })).toEqual({ agentId: "agent-1" });
    expect(parseSubmitMarketplaceAgent({ agentId: "agent-1", category: "research", showCreatorAvatar: false })).toEqual(
      { agentId: "agent-1", category: "research", showCreatorAvatar: false },
    );
    expect(parseMarketplaceAgentQuery({ category: "research" })).toEqual({ category: "research" });
    expect(
      parseSubmitSkill({ draftId: "draft", category: "coding", icon: null, showCreatorAvatar: true }),
    ).toMatchObject({ showCreatorAvatar: true });
    expect(() => parseSubmitMarketplaceAgent({ agentId: "agent-1", category: "invalid" })).toThrow(
      "Unknown agent category.",
    );
    expect(() =>
      parseSubmitSkill({ draftId: "draft", category: "coding", icon: null, showCreatorAvatar: "true" }),
    ).toThrow();
  });

  it("parses setup and permission values", () => {
    expect(parseSetup({ preferredProvider: "codex", preferredModel: null })).toEqual({
      preferredProvider: "codex",
      preferredModel: null,
    });
    // A custom endpoint is a model of the CLI that runs it, so this is the shape that records one.
    expect(parseSetup({ preferredProvider: "opencode", preferredModel: "studio-local/glm-5-air" })).toEqual({
      preferredProvider: "opencode",
      preferredModel: "studio-local/glm-5-air",
    });
    expect(parseProviderId("grok")).toBe("grok");
    expect(parseMacPermission("screen-recording")).toBe("screen-recording");
    expect(parseMacPermission("accessibility")).toBe("accessibility");
    expect(parseExternalDestination("claude-install")).toBe("claude-install");
    expect(parseExternalDestination("claude-sign-in")).toBe("claude-sign-in");
    expect(parseAnalyticsPreference({ enabled: false })).toEqual({ enabled: false });
    expect(parseUpdatePreference({ autoDownload: false })).toEqual({ autoDownload: false });
    expect(parseUpdatePreference({ autoDownload: true })).toEqual({ autoDownload: true });
  });

  // These two channels validated their payload inline until the decoder became a required argument,
  // so the cases below pin the behaviour that move preserved rather than any new rule. The 100
  // character cap on `query` is silent truncation, not rejection, and turning it into an error would
  // be a product change.
  it("truncates an over-long marketplace search instead of rejecting it", () => {
    const query = "a".repeat(150);
    expect(parseMarketplaceSkillQuery({ query })).toEqual({ query: "a".repeat(100) });
    expect(parseMarketplaceAgentQuery({ query })).toEqual({ query: "a".repeat(100) });
  });

  it("keeps only the marketplace filters a caller actually sent", () => {
    expect(parseMarketplaceSkillQuery({})).toEqual({});
    expect(
      parseMarketplaceSkillQuery({ featured: true, sort: "installs", cursor: "page-2", limit: 20, category: "coding" }),
    ).toEqual({ featured: true, sort: "installs", cursor: "page-2", limit: 20, category: "coding" });
    expect(parseMarketplaceSkillQuery({ featured: false, cursor: 7 })).toEqual({});
    expect(parseMarketplaceAgentQuery({ featured: true, limit: 5 })).toEqual({ featured: true, limit: 5 });
  });

  it("separates the two marketplaces by their rejection messages", () => {
    expect(() => parseMarketplaceSkillQuery(null)).toThrowError("Invalid marketplace query.");
    expect(() => parseMarketplaceAgentQuery(null)).toThrowError("Invalid agent marketplace query.");
    expect(() => parseMarketplaceSkillQuery({ sort: "newest" })).toThrowError("Unknown skill sort order.");
    expect(() => parseMarketplaceAgentQuery({ sort: "newest" })).toThrowError("Unknown agent sort order.");
    expect(() => parseMarketplaceSkillQuery({ category: "cooking" })).toThrowError("Unknown skill category.");
  });

  it("applies the profile name rule through one decoder", () => {
    expect(parseProfileName("  Ada Lovelace  ")).toBe("Ada Lovelace");
    expect(() => parseProfileName("")).toThrowError("name is required.");
    expect(() => parseProfileName("a")).toThrowError(
      `name must contain ${INPUT_LIMITS.profileNameMin} to ${INPUT_LIMITS.profileName} safe characters.`,
    );
  });

  it("validates model usage agent identifiers", () => {
    expect(parseAgentId("chief")).toBe("chief");
    expect(() => parseAgentId(42)).toThrowError("agentId is required.");
    expect(() => parseAgentId("x".repeat(INPUT_LIMITS.identifier + 1))).toThrowError("agentId is too long.");
  });

  it("keeps setup and permission error messages", () => {
    expect(() => parseSetup(null)).toThrowError("Setup input is required.");
    expect(() => parseSetup({ preferredProvider: "other", preferredModel: null })).toThrowError("Unknown provider.");
    expect(() => parseSetup({ preferredProvider: "codex" })).toThrowError("Unknown model.");
    expect(() => parseSetup({ preferredProvider: "codex", preferredModel: "a model" })).toThrowError("Unknown model.");
    expect(() => parseProviderId("other")).toThrowError("Unknown provider.");
    expect(() => parseMacPermission("camera")).toThrowError("Unknown macOS permission.");
    expect(() => parseExternalDestination("https://example.com")).toThrowError("Unknown external destination.");
    expect(() => parseExternalDestination("chatgpt-install")).toThrowError("Unknown external destination.");
    expect(() => parseAnalyticsPreference({ enabled: "false" })).toThrowError("Analytics preference is required.");
    expect(() => parseUpdatePreference({ autoDownload: "yes" })).toThrowError("Update preference is required.");
    expect(() => parseUpdatePreference(null)).toThrowError("Update preference is required.");
  });

  it("validates Dynamic Island data and actions", () => {
    const presentation = {
      serverId: "local",
      mode: "working",
      working: [
        {
          agent: { id: "chief", name: "Chief", avatarSeed: "chief", avatarHue: 215, avatarUrl: null },
          task: "Checking the release",
        },
      ],
    } as const;
    expect(
      parseDynamicIslandPreference({
        enabled: true,
        hapticsEnabled: false,
        idleVisible: false,
        additionalDisplaysEnabled: true,
      }),
    ).toEqual({
      enabled: true,
      hapticsEnabled: false,
      idleVisible: false,
      additionalDisplaysEnabled: true,
    });
    expect(() => parseDynamicIslandPreference({ enabled: true })).toThrowError(
      "Dynamic Island preference is required.",
    );
    expect(parseDynamicIslandInteractive({ interactive: false })).toEqual({ interactive: false });
    expect(parseDynamicIslandPresentation(presentation)).toEqual(presentation);
    const takeoverPresentation = {
      serverId: "local",
      mode: "takeover",
      item: {
        requestId: "takeover-1",
        agent: presentation.working[0].agent,
        title: "Browser step needs you",
        detail: "Complete the sign-in in the browser.",
      },
    } as const;
    expect(parseDynamicIslandPresentation(takeoverPresentation)).toEqual(takeoverPresentation);
    const failedPresentation = {
      serverId: "local",
      mode: "failed",
      item: {
        turnId: "turn-failed",
        agent: presentation.working[0].agent,
        title: "Task failed",
        detail: "The browser tab closed unexpectedly.",
      },
    } as const;
    expect(parseDynamicIslandPresentation(failedPresentation)).toEqual(failedPresentation);
    expect(parseDynamicIslandAction({ type: "open-agent", serverId: "local", agentId: "chief" })).toEqual({
      type: "open-agent",
      serverId: "local",
      agentId: "chief",
    });
    expect(
      parseDynamicIslandAction({
        type: "answer-prompt",
        serverId: "local",
        agentId: "chief",
        requestId: "prompt-1",
        answers: { source: ["Official data"] },
      }),
    ).toEqual({
      type: "answer-prompt",
      serverId: "local",
      agentId: "chief",
      requestId: "prompt-1",
      answers: { source: ["Official data"] },
    });
    expect(
      parseDynamicIslandAction({
        type: "open-failure",
        serverId: "local",
        agentId: "chief",
        turnId: "turn-failed",
      }),
    ).toEqual({
      type: "open-failure",
      serverId: "local",
      agentId: "chief",
      turnId: "turn-failed",
    });
    expect(() =>
      parseDynamicIslandPresentation({ ...presentation, working: Array(4).fill(presentation.working[0]) }),
    ).toThrow();
    expect(() => parseDynamicIslandAction({ type: "approve", serverId: "local", agentId: "chief" })).toThrow();
    expect(() =>
      parseDynamicIslandAction({
        type: "answer-prompt",
        serverId: "local",
        agentId: "chief",
        requestId: "prompt-1",
        answers: {},
      }),
    ).toThrow();
  });
});

describe("voice IPC input parsing", () => {
  it("accepts canonical 16 kHz mono PCM WAV audio", () => {
    const audio = voiceWav(8);
    expect(parseVoiceTranscription({ audio })).toEqual({ audio });
  });

  it("rejects malformed and oversized voice audio", () => {
    expect(() => parseVoiceTranscription({ audio: new Uint8Array(44) })).toThrowError(
      "Voice audio must be a 16 kHz mono PCM WAV file.",
    );
    const wrongRate = voiceWav(8);
    new DataView(wrongRate.buffer).setUint32(24, 44_100, true);
    expect(() => parseVoiceTranscription({ audio: wrongRate })).toThrowError(
      "Voice audio must be a 16 kHz mono PCM WAV file.",
    );
    expect(() => parseVoiceTranscription({ audio: new Uint8Array(3_840_045) })).toThrowError(
      "Voice audio has an invalid length.",
    );
  });
});

function voiceWav(sampleBytes: number): Uint8Array {
  const audio = new Uint8Array(44 + sampleBytes);
  const view = new DataView(audio.buffer);
  audio.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, audio.byteLength - 8, true);
  audio.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  audio.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, sampleBytes, true);
  return audio;
}

describe("server IPC input parsing", () => {
  it("parses host and connection values", () => {
    expect(parseHostConfig({ serverName: "My server" })).toEqual({ serverName: "My server" });
    expect(parseJoinServer({ inviteUrl: "https://openbot.run/invite" })).toEqual({
      inviteUrl: "https://openbot.run/invite",
    });
    expect(parseLoginServer({ serverId: "server-1" })).toEqual({ serverId: "server-1" });
    expect(parseReorderServers({ serverIds: ["server-2", "server-1"] })).toEqual({
      serverIds: ["server-2", "server-1"],
    });
    expect(parseMarkDirectRead({ memberId: "member-1", throughSequence: 42 })).toEqual({
      memberId: "member-1",
      throughSequence: 42,
    });
  });

  it("requires a six-character host name", () => {
    expect(() => parseHostConfig({ serverName: "short" })).toThrowError("at least 6 characters");
  });

  it("normalizes optional invitation and member fields", () => {
    expect(parseCreateTeamInvite({ role: "member", email: " user@example.com " })).toEqual({
      role: "member",
      email: "user@example.com",
    });
    expect(parseCreateTeamInvite({ role: "admin", email: " " })).toEqual({ role: "admin" });
    expect(parseUpdateTeamMember({ memberId: "member-1", disabled: false })).toEqual({
      memberId: "member-1",
      disabled: false,
    });
  });

  it("keeps server input error messages", () => {
    expect(() => parseHostConfig(null)).toThrowError("Host configuration is required.");
    expect(() => parseJoinServer(null)).toThrowError("Invitation details are required.");
    expect(() => parseLoginServer(null)).toThrowError("Login details are required.");
    expect(() => parseReorderServers({ serverIds: ["server-1", "server-1"] })).toThrowError("Duplicate server ids.");
    expect(() => parseCreateTeamInvite({ role: "owner" })).toThrowError("Unknown team role.");
    expect(() => parseUpdateTeamMember({ memberId: "member-1", disabled: "no" })).toThrowError(
      "Invalid team member state.",
    );
    expect(() => parseMarkDirectRead({ memberId: "member-1", throughSequence: -1 })).toThrowError(
      "Invalid direct-message read boundary.",
    );
  });
});

describe("agent IPC input parsing", () => {
  it("parses scoped requests and message actions", () => {
    expect(parseAgentRequest({ serverId: "local", payload: { agentId: "bot-1" } })).toEqual({
      serverId: "local",
      payload: { agentId: "bot-1" },
    });
    expect(parseSendMessage({ agentId: "bot-1", text: "Hello" })).toEqual({
      agentId: "bot-1",
      text: "Hello",
      attachmentDraftIds: [],
      replyToMessageId: null,
    });
    expect(parseMessageReaction({ agentId: "bot-1", messageId: "message-1", emoji: "👍" })).toEqual({
      agentId: "bot-1",
      messageId: "message-1",
      emoji: "👍",
    });
    expect(parseMessageReaction({ agentId: "bot-1", messageId: "message-1", emoji: "👨‍👩‍👧‍👦" })).toEqual({
      agentId: "bot-1",
      messageId: "message-1",
      emoji: "👨‍👩‍👧‍👦",
    });
    expect(parseInterrupt({ agentId: "bot-1", turnId: "turn-1" })).toEqual({
      agentId: "bot-1",
      turnId: "turn-1",
    });
    expect(parseAcknowledgeFailedTurn({ agentId: "bot-1", turnId: "turn-1" })).toEqual({
      agentId: "bot-1",
      turnId: "turn-1",
    });
    expect(parseMarkConversationRead({ agentId: "bot-1", throughMessageId: "message-1" })).toEqual({
      agentId: "bot-1",
      throughMessageId: "message-1",
    });
    expect(parseCreateAgentMemory({ agentId: "bot-1", text: "Uses metric units." })).toEqual({
      agentId: "bot-1",
      text: "Uses metric units.",
    });
    expect(parseUpdateAgentMemory({ agentId: "bot-1", memoryId: "memory-1", text: "Uses SI units." })).toEqual({
      agentId: "bot-1",
      memoryId: "memory-1",
      text: "Uses SI units.",
    });
    expect(parseDeleteAgentMemory({ agentId: "bot-1", memoryId: "memory-1" })).toEqual({
      agentId: "bot-1",
      memoryId: "memory-1",
    });
  });

  it("parses agent, attachment, queue, and prompt values", () => {
    expect(
      parseCreateAgent({
        name: "Trip Planner",
        description: "Builds practical itineraries.",
        avatarSeed: "setup:trip",
        avatarHue: 215,
        initialMessage: "Help me plan a trip.",
      }),
    ).toEqual({
      name: "Trip Planner",
      description: "Builds practical itineraries.",
      avatarSeed: "setup:trip",
      avatarHue: 215,
      initialMessage: "Help me plan a trip.",
    });
    expect(parseUpdateAgent({ agentId: "bot-1", name: "Ada", title: "Coordinator", notifications: true })).toEqual({
      agentId: "bot-1",
      name: "Ada",
      title: "Coordinator",
      notifications: true,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      parseImportAttachments({
        paths: ["/tmp/readme.md"],
        data: [{ name: "image.png", mimeType: "image/png", bytes }],
      }),
    ).toEqual({
      paths: ["/tmp/readme.md"],
      data: [{ name: "image.png", mimeType: "image/png", bytes }],
    });
    expect(parseChooseAttachments({ filter: "all" })).toEqual({ filter: "all" });
    expect(parseChooseAttachments({ filter: "images" })).toEqual({ filter: "images" });
    expect(parseOpenAttachment({ attachmentId: "attachment-1", action: "reveal" })).toEqual({
      attachmentId: "attachment-1",
      action: "reveal",
    });
    expect(parseOpenAttachment({ attachmentId: "attachment-1", action: "download" })).toEqual({
      attachmentId: "attachment-1",
      action: "download",
    });
    expect(parseOpenSharedFile({ path: "~/OpenBot/Shared/report.csv" })).toEqual({
      path: "~/OpenBot/Shared/report.csv",
    });
    expect(parseOpenWorkspaceFile({ agentId: "bot-1", path: "app/page.tsx" })).toEqual({
      agentId: "bot-1",
      path: "app/page.tsx",
    });
    expect(parseCancelQueuedMessage({ agentId: "bot-1", deliveryId: "delivery-1" })).toEqual({
      agentId: "bot-1",
      deliveryId: "delivery-1",
    });
    expect(
      parseSteerQueuedMessage({
        agentId: "bot-1",
        deliveryId: "delivery-1",
        expectedTurnId: "turn-1",
      }),
    ).toEqual({ agentId: "bot-1", deliveryId: "delivery-1", expectedTurnId: "turn-1" });
    expect(
      parseUpdateQueuedMessage({
        agentId: "bot-1",
        deliveryId: "delivery-1",
        text: "Edited",
        keepAttachmentIds: ["attachment-1"],
        attachmentDraftIds: ["draft-1"],
      }),
    ).toEqual({
      agentId: "bot-1",
      deliveryId: "delivery-1",
      text: "Edited",
      keepAttachmentIds: ["attachment-1"],
      attachmentDraftIds: ["draft-1"],
    });
    expect(parseReorderQueue({ agentId: "bot-1", deliveryIds: ["delivery-2", "delivery-1"] })).toEqual({
      agentId: "bot-1",
      deliveryIds: ["delivery-2", "delivery-1"],
    });
    expect(parsePromptResponse({ requestId: 7, answers: { question: ["answer"] } })).toEqual({
      requestId: 7,
      answers: { question: ["answer"] },
    });
    expect(parseApprovalResponse({ requestId: "approval-1", decision: "accept" })).toEqual({
      requestId: "approval-1",
      decision: "accept",
    });
    expect(parseBrowserTakeoverResponse({ requestId: "takeover-1", decision: "complete" })).toEqual({
      requestId: "takeover-1",
      decision: "complete",
    });
  });

  it("keeps agent input error messages", () => {
    expect(() =>
      parseCreateAgent({
        name: " ",
        description: "Builds practical itineraries.",
        avatarSeed: "setup:trip",
        avatarHue: 215,
        initialMessage: "Help me plan a trip.",
      }),
    ).toThrowError("name is required.");
    expect(() =>
      parseCreateAgent({
        name: "Trip Planner",
        description: "Builds practical itineraries.",
        avatarSeed: "setup:trip",
        avatarHue: 215,
        initialMessage: " ",
      }),
    ).toThrowError("initialMessage is required.");
    expect(() => parseUpdateAgent({ agentId: "bot-1", role: "Coordinator" })).toThrowError("Invalid role.");
    expect(() => parseAgentRequest(null)).toThrowError("Invalid agent request.");
    expect(() => parseSendMessage({ agentId: "bot-1", text: " " })).toThrowError(
      "A message or attachment is required.",
    );
    expect(() => parseMessageReaction({ agentId: "bot-1", messageId: "message-1", emoji: "invalid" })).toThrowError(
      "Invalid message reaction.",
    );
    expect(() => parseUpdateAgent({ agentId: "bot-1", notifications: "yes" })).toThrowError(
      "Invalid notifications value.",
    );
    expect(() => parseImportAttachments({ paths: [""], data: [] })).toThrowError("Invalid attachment path.");
    expect(() => parseChooseAttachments({ filter: "documents" })).toThrowError("Invalid attachment picker filter.");
    expect(() => parseOpenAttachment({ attachmentId: "attachment-1", action: "delete" })).toThrowError(
      "Invalid attachment action.",
    );
    expect(() => parseOpenSharedFile({ path: "" })).toThrowError("path is required.");
    expect(() => parseOpenWorkspaceFile({ agentId: "bot-1", path: "" })).toThrowError("path is required.");
    expect(() => parseCancelQueuedMessage(null)).toThrowError("Invalid queue cancellation request.");
    expect(() => parseSteerQueuedMessage(null)).toThrowError("Invalid queued steer request.");
    expect(() =>
      parseUpdateQueuedMessage({
        agentId: "bot-1",
        deliveryId: "delivery-1",
        text: " ",
        keepAttachmentIds: [],
        attachmentDraftIds: [],
      }),
    ).toThrowError("A message or attachment is required.");
    expect(() => parseReorderQueue({ agentId: "bot-1", deliveryIds: ["delivery-1", "delivery-1"] })).toThrowError(
      "Duplicate delivery ids.",
    );
    expect(() => parseInterrupt(null)).toThrowError("Invalid interrupt request.");
    expect(() => parseMarkConversationRead({ agentId: "bot-1", throughMessageId: 1 })).toThrowError(
      "Invalid conversation read boundary.",
    );
    expect(() => parseCreateAgentMemory({ agentId: "bot-1", text: " " })).toThrowError("text is required.");
    expect(() =>
      parseCreateAgentMemory({ agentId: "bot-1", text: "x".repeat(INPUT_LIMITS.agentMemoryText + 1) }),
    ).toThrowError("text is too long.");
    expect(() => parseUpdateAgentMemory({ agentId: "bot-1", memoryId: "", text: "Fact" })).toThrowError(
      "memoryId is required.",
    );
    expect(() => parseDeleteAgentMemory({ agentId: "", memoryId: "memory-1" })).toThrowError("agentId is required.");
    expect(() => parsePromptResponse({ requestId: 1, answers: null })).toThrowError("Prompt answers are required.");
    expect(() =>
      parsePromptResponse({
        requestId: 1,
        answers: {
          first: ["a".repeat(INPUT_LIMITS.promptAnswersTotalText / 2 + 1)],
          second: ["b".repeat(INPUT_LIMITS.promptAnswersTotalText / 2)],
        },
      }),
    ).toThrowError("Prompt answers are too long.");
    expect(() => parseApprovalResponse({ requestId: "approval-1", decision: "maybe" })).toThrowError(
      "Invalid approval decision.",
    );
    expect(() => parseApprovalResponse({ requestId: 1.5, decision: "accept" })).toThrowError(
      "Invalid approval response.",
    );
    expect(() => parseBrowserTakeoverResponse({ requestId: "takeover-1", decision: "maybe" })).toThrowError(
      "Invalid browser takeover response.",
    );
  });
});

describe("routine IPC input parsing", () => {
  it("parses create, update, delete, and history values", () => {
    const schedule = { kind: "weekdays" as const, time: "07:00" };
    expect(
      parseCreateRoutine({
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "Europe/Warsaw",
        schedule,
      }),
    ).toEqual({
      agentId: "chief",
      name: "Morning brief",
      instruction: "Prepare the brief.",
      active: true,
      timezone: "Europe/Warsaw",
      schedule,
    });
    expect(parseUpdateRoutine({ agentId: "chief", routineId: "routine-1", active: false })).toEqual({
      agentId: "chief",
      routineId: "routine-1",
      active: false,
    });
    expect(parseDeleteRoutine({ agentId: "chief", routineId: "routine-1" })).toEqual({
      agentId: "chief",
      routineId: "routine-1",
    });
    expect(parseListRoutineRuns({ agentId: "chief", routineId: "routine-1" })).toEqual({
      agentId: "chief",
      routineId: "routine-1",
      limit: 50,
    });
  });

  it("rejects invalid routine IPC values", () => {
    expect(() =>
      parseCreateRoutine({
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "Europe/Warsaw",
        schedules: [{ kind: "weekdays", time: "07:00" }],
      }),
    ).toThrow("routine schedule");
    expect(() =>
      parseCreateRoutine({
        agentId: "chief",
        name: "Morning brief",
        instruction: "Prepare the brief.",
        active: true,
        timezone: "Europe/Warsaw",
        schedule: [{ kind: "weekdays", time: "07:00" }],
      }),
    ).toThrow("routine schedule");
    expect(() => parseUpdateRoutine({ agentId: "chief", routineId: "routine-1" })).toThrow("update is required");
    expect(() => parseDeleteRoutine({ agentId: "chief", routineId: "" })).toThrow("routineId is required");
    expect(() => parseListRoutineRuns({ agentId: "chief", routineId: "routine-1", limit: 101 })).toThrow(
      "history limit",
    );
  });
});

describe("browser IPC input parsing", () => {
  it("parses URLs, owners, visibility, and bounds", () => {
    expect(parseBrowserOpen({ url: "https://example.com", ownerThreadId: "thread-1", focus: true })).toEqual({
      url: "https://example.com",
      ownerThreadId: "thread-1",
      ownerAgentId: null,
      focus: true,
    });
    expect(parseBrowserNavigate({ tabId: "tab-1", direction: "back" })).toEqual({
      tabId: "tab-1",
      direction: "back",
    });
    expect(parseVisibility({ visible: true, bounds: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({
      visible: true,
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(parseVisibility({ visible: true, target: "picture-in-picture" })).toEqual({
      visible: true,
      bounds: undefined,
      target: "picture-in-picture",
    });
  });

  it("keeps browser input error messages", () => {
    expect(() => parseBrowserOpen(null)).toThrowError("Invalid browser open request.");
    expect(() => parseBrowserOpen({ url: "https://example.com", focus: "yes" })).toThrowError(
      "Invalid browser focus request.",
    );
    expect(() => parseBrowserNavigate({ tabId: "tab-1", direction: "sideways" })).toThrowError(
      "Invalid browser navigation request.",
    );
    expect(() => parseVisibility({ visible: "yes" })).toThrowError("Invalid browser visibility request.");
    expect(() => parseVisibility({ visible: true, target: "desktop" })).toThrowError("Invalid browser view target.");
    expect(() => parseVisibility({ visible: true, bounds: { x: 1, y: 2, width: Number.NaN, height: 4 } })).toThrowError(
      "Invalid browser bound: width.",
    );
  });
});

describe("shared IPC validation", () => {
  it("keeps required and length error messages", () => {
    expect(() => requireString(" ", "field")).toThrowError("field is required.");
    expect(() => requireString("long", "field", 3)).toThrowError("field is too long.");
    expect(requireString(" value ", "field")).toBe(" value ");
  });

  // Only the two marketplace queries ever accepted an explicit null as "no query". Collapsing the
  // two helpers into one would let a null reach a channel like Picture-in-Picture as default bounds,
  // which is a malformed payload silently succeeding rather than being rejected.
  it("separates an omitted payload from an explicit null", () => {
    const decode = (value: unknown) => `decoded:${String(value)}`;

    expect(optionalPayload(decode)(undefined)).toBeUndefined();
    expect(optionalPayload(decode)(null)).toBe("decoded:null");
    expect(nullishPayload(decode)(undefined)).toBeUndefined();
    expect(nullishPayload(decode)(null)).toBeUndefined();
  });
});

describe("sidebar layout input parsing", () => {
  it("accepts a bounded multi-position section move", () => {
    expect(parseSidebarLayoutAction({ type: "move", sectionId: "section-1", direction: "down", steps: 3 })).toEqual({
      type: "move",
      sectionId: "section-1",
      direction: "down",
      steps: 3,
    });
  });

  it("accepts an agent move with an optional order target", () => {
    expect(
      parseSidebarLayoutAction({
        type: "move-agent",
        agentId: "research",
        sectionId: "section-1",
        beforeAgentId: "chief",
      }),
    ).toEqual({
      type: "move-agent",
      agentId: "research",
      sectionId: "section-1",
      beforeAgentId: "chief",
    });
  });

  it("rejects an invalid section move distance", () => {
    expect(() =>
      parseSidebarLayoutAction({ type: "move", sectionId: "section-1", direction: "down", steps: 0 }),
    ).toThrowError("Invalid section move distance.");
  });
});

describe("custom provider input parsing", () => {
  const endpoint = {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "abcdef123456",
    models: [{ id: "glm-5-air", name: "GLM 5 Air" }],
    headers: [{ name: "X-Tenant", value: "acme" }],
  };

  it("accepts a described endpoint and keeps a null key as null", () => {
    expect(parseSaveCustomProvider(endpoint)).toEqual(endpoint);
    // The common case: a model server on this computer that asks for no credential. An empty string
    // would reach OpenCode as a blank Authorization header, so it collapses to null too.
    expect(parseSaveCustomProvider({ ...endpoint, apiKey: null }).apiKey).toBeNull();
    expect(parseSaveCustomProvider({ ...endpoint, apiKey: "   " }).apiKey).toBeNull();
    expect(parseSaveCustomProvider({ ...endpoint, headers: undefined }).headers).toEqual([]);
  });

  // An endpoint named `opencode` would take a `provider` key OpenCode already owns, so its own
  // models would disappear behind the user's. `codex`, `claude` and `grok` are refused for the same
  // reason in the picker, where a built-in id already means a driver.
  it("rejects a built-in provider name and an id OpenCode cannot use as a key", () => {
    for (const id of ["opencode", "claude", "codex", "grok"]) {
      expect(() => parseSaveCustomProvider({ ...endpoint, id })).toThrowError("A provider ID must be");
    }
    expect(() => parseSaveCustomProvider({ ...endpoint, id: "studio/local" })).toThrowError("A provider ID must be");
    expect(() => parseSaveCustomProvider({ ...endpoint, id: "Studio" })).toThrowError("A provider ID must be");
    expect(() => parseDeleteCustomProvider({ id: "studio/local" })).toThrowError("A provider ID must be");
  });

  // The CLI is given this URL to call. Any other scheme is a way to make the provider process read
  // something local instead of an HTTP API.
  it("rejects a base URL that is not http or https", () => {
    expect(() => parseSaveCustomProvider({ ...endpoint, baseUrl: "file:///etc/passwd" })).toThrowError(
      "The base URL must start with http:// or https://.",
    );
    expect(() => parseSaveCustomProvider({ ...endpoint, baseUrl: "data:text/plain,x" })).toThrowError(
      "The base URL must start with http:// or https://.",
    );
    expect(() => parseSaveCustomProvider({ ...endpoint, baseUrl: "127.0.0.1:11434" })).toThrowError(
      "The base URL is not a URL.",
    );
  });

  it("rejects an over-limit name, URL or key", () => {
    expect(() => parseSaveCustomProvider({ ...endpoint, name: "n".repeat(INPUT_LIMITS.agentName + 1) })).toThrowError(
      "Display name is too long.",
    );
    const longPath = `http://127.0.0.1/${"p".repeat(CUSTOM_PROVIDER_LIMITS.baseUrl)}`;
    expect(() => parseSaveCustomProvider({ ...endpoint, baseUrl: longPath })).toThrowError("Base URL is too long.");
    expect(() =>
      parseSaveCustomProvider({ ...endpoint, apiKey: "k".repeat(CUSTOM_PROVIDER_LIMITS.apiKey + 1) }),
    ).toThrowError("The API key is too long.");
  });

  // The composed `<id>/<model>` is what reaches the agent roster, the picker and the Team API, and
  // every one of those list decoders fails closed on a whole array when one id is malformed.
  // Checking the halves would let a legal model id and a legal provider id compose into an illegal
  // model, which empties the picker rather than rejecting the save.
  it("rejects a model whose composed id is not a usable model id", () => {
    expect(() => parseSaveCustomProvider({ ...endpoint, models: [{ id: "glm 5 air", name: "GLM" }] })).toThrowError(
      "A model ID has an unusable character.",
    );
    // Both halves are inside their own 128-character bound; together they are over the 160 an agent
    // model id may be, which is exactly the case checking the halves would let through.
    expect(() =>
      parseSaveCustomProvider({
        ...endpoint,
        id: "s".repeat(100),
        models: [{ id: "m".repeat(100), name: "Long" }],
      }),
    ).toThrowError("A model ID has an unusable character.");
  });

  it("rejects an empty model list and two models with one ID", () => {
    expect(() => parseSaveCustomProvider({ ...endpoint, models: [] })).toThrowError("At least one model is required.");
    expect(() =>
      parseSaveCustomProvider({
        ...endpoint,
        models: [
          { id: "glm-5-air", name: "GLM 5 Air" },
          { id: "glm-5-air", name: "Same ID" },
        ],
      }),
    ).toThrowError("Two models have the same ID.");
  });

  it("rejects a header name HTTP does not allow and a duplicate name", () => {
    expect(() => parseSaveCustomProvider({ ...endpoint, headers: [{ name: "X Tenant", value: "acme" }] })).toThrowError(
      "A header name has a character HTTP does not allow.",
    );
    // Case does not distinguish two HTTP field names, so the second one is a duplicate, not a
    // second header that quietly replaces the first at the endpoint.
    expect(() =>
      parseSaveCustomProvider({
        ...endpoint,
        headers: [
          { name: "X-Tenant", value: "acme" },
          { name: "x-tenant", value: "other" },
        ],
      }),
    ).toThrowError("Two headers have the same name.");
  });
});
