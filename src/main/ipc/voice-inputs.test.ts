import { DEFAULT_SPEECH_SETTINGS, ELEVENLABS_AGENT_VOICE_IDS_LIMIT } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { parseAgentElevenLabsVoiceInput, parseSpeechInput, parseSpeechSettings } from "./voice-inputs";

const CUSTOM_ID = "JBFqnCBsd6RMkjVDRZzb";
const AGENT_ID = "21m00Tcm4TlvDq8ikWAM";

describe("voice speech payloads from the renderer", () => {
  it("accepts valid speech settings and strips extra fields", () => {
    const settings = {
      ...DEFAULT_SPEECH_SETTINGS,
      elevenLabsCustomVoiceId: CUSTOM_ID,
      elevenLabsAgentVoiceIds: { "local:agent-1": AGENT_ID },
    };
    expect(parseSpeechSettings({ ...settings, extra: "dropped" })).toEqual(settings);
  });

  it.each([
    ["a path in the custom voice ID", { ...DEFAULT_SPEECH_SETTINGS, elevenLabsCustomVoiceId: "../v1/history" }],
    ["spaces in the custom voice ID", { ...DEFAULT_SPEECH_SETTINGS, elevenLabsCustomVoiceId: "two words" }],
    ["an empty custom voice ID", { ...DEFAULT_SPEECH_SETTINGS, elevenLabsCustomVoiceId: "" }],
    ["an overlong custom voice ID", { ...DEFAULT_SPEECH_SETTINGS, elevenLabsCustomVoiceId: "a".repeat(129) }],
    ["a Map as the agent voice map", { ...DEFAULT_SPEECH_SETTINGS, elevenLabsAgentVoiceIds: new Map() }],
    [
      "a bare key without server scope",
      { ...DEFAULT_SPEECH_SETTINGS, elevenLabsAgentVoiceIds: { constructor: AGENT_ID } },
    ],
    [
      "a prototype key without server scope",
      {
        ...DEFAULT_SPEECH_SETTINGS,
        elevenLabsAgentVoiceIds: Object.fromEntries([["__proto__", AGENT_ID]]),
      },
    ],
    [
      "an invalid voice ID in the agent voice map",
      { ...DEFAULT_SPEECH_SETTINGS, elevenLabsAgentVoiceIds: { "local:agent-1": "bad id" } },
    ],
    [
      "an agent voice map over the limit",
      {
        ...DEFAULT_SPEECH_SETTINGS,
        elevenLabsAgentVoiceIds: Object.fromEntries(
          Array.from({ length: ELEVENLABS_AGENT_VOICE_IDS_LIMIT + 1 }, (_, index) => [`local:${index}`, AGENT_ID]),
        ),
      },
    ],
  ])("refuses speech settings with %s", (_name, input) => {
    expect(() => parseSpeechSettings(input)).toThrow();
  });

  it("accepts valid agent ElevenLabs voice updates and refuses malformed ones", () => {
    expect(parseAgentElevenLabsVoiceInput({ agentKey: "local:agent-1", voiceId: AGENT_ID, extra: 1 })).toEqual({
      agentKey: "local:agent-1",
      voiceId: AGENT_ID,
    });
    expect(parseAgentElevenLabsVoiceInput({ agentKey: "remote-1:agent-2", voiceId: null })).toEqual({
      agentKey: "remote-1:agent-2",
      voiceId: null,
    });
    expect(() => parseAgentElevenLabsVoiceInput({ agentKey: "constructor", voiceId: AGENT_ID })).toThrow();
    expect(() => parseAgentElevenLabsVoiceInput({ agentKey: ":agent-1", voiceId: AGENT_ID })).toThrow();
    expect(() => parseAgentElevenLabsVoiceInput({ agentKey: "local:", voiceId: AGENT_ID })).toThrow();
    expect(() => parseAgentElevenLabsVoiceInput({ agentKey: "local:agent 1", voiceId: AGENT_ID })).toThrow();
    expect(() => parseAgentElevenLabsVoiceInput({ agentKey: "local:agent-1", voiceId: "../bad" })).toThrow();
  });

  it("validates optional agentKey and elevenLabsVoiceId on speech requests", () => {
    expect(parseSpeechInput({ text: "Hi", language: "en", agentKey: "local:agent-1" })).toEqual({
      text: "Hi",
      language: "en",
      agentKey: "local:agent-1",
    });
    expect(parseSpeechInput({ text: "Hi", language: "en", elevenLabsVoiceId: CUSTOM_ID })).toEqual({
      text: "Hi",
      language: "en",
      elevenLabsVoiceId: CUSTOM_ID,
    });
    expect(() => parseSpeechInput({ text: "Hi", language: "en", agentKey: "__proto__" })).toThrow();
    expect(() => parseSpeechInput({ text: "Hi", language: "en", agentKey: null })).toThrow();
    expect(() => parseSpeechInput({ text: "Hi", language: "en", elevenLabsVoiceId: "x?y" })).toThrow();
    expect(() => parseSpeechInput({ text: "Hi", language: "en", elevenLabsVoiceId: null })).toThrow();
  });
});
