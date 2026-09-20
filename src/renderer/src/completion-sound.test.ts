import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { playCompletionSoundForAgentEvent, shouldPlayCompletionSound } from "./completion-sound";
import { appendVoiceTranscript, encodePcmWav } from "./voice-recording";

const agent = { id: "chief", notifications: true } satisfies Pick<AgentSummary, "id" | "notifications">;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("completion sound", () => {
  it("plays only for successful turns from notification-enabled agents", () => {
    expect(shouldPlayCompletionSound(completed("completed"), [agent], storage())).toBe(true);
    expect(shouldPlayCompletionSound(completed("failed"), [agent], storage())).toBe(false);
    expect(shouldPlayCompletionSound(completed("interrupted"), [agent], storage())).toBe(false);
    expect(shouldPlayCompletionSound(completed("completed"), [{ ...agent, notifications: false }], storage())).toBe(
      false,
    );
    expect(shouldPlayCompletionSound(completed("completed"), [], storage())).toBe(false);
    expect(shouldPlayCompletionSound({ type: "agents-changed", agents: [] }, [agent], storage())).toBe(false);
  });

  it("defaults to enabled and honors the persisted opt-out", () => {
    expect(shouldPlayCompletionSound(completed("completed"), [agent], storage())).toBe(true);
    expect(shouldPlayCompletionSound(completed("completed"), [agent], storage("false"))).toBe(false);
  });

  it("schedules one short descending plop and releases its nodes", async () => {
    const frequency = audioParam();
    const volume = audioParam();
    const oscillator = {
      type: "square",
      frequency,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn((_event: string, listener: () => void) => listener()),
    };
    const gain = { gain: volume, connect: vi.fn(), disconnect: vi.fn() };
    const context = {
      state: "running",
      currentTime: 2,
      destination: {},
      resume: vi.fn(),
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
    };
    const AudioContextMock = vi.fn(function AudioContextMock() {
      return context;
    });
    vi.stubGlobal("AudioContext", AudioContextMock);

    playCompletionSoundForAgentEvent(completed("completed"), [agent], storage());
    await vi.waitFor(() => expect(oscillator.start).toHaveBeenCalled());

    expect(oscillator.stop).toHaveBeenCalled();
    expect(oscillator.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });
});

describe("voice recording", () => {
  it("appends transcripts without replacing an existing draft", () => {
    expect(appendVoiceTranscript("", "  Hello world. ")).toBe("Hello world.");
    expect(appendVoiceTranscript("Existing", "Hello world.")).toBe("Existing Hello world.");
    expect(appendVoiceTranscript("Existing\n", "Hello world.")).toBe("Existing\nHello world.");
    expect(appendVoiceTranscript("Existing", "   ")).toBe("Existing");
  });

  it("encodes canonical mono PCM WAV audio", () => {
    const wav = encodePcmWav(new Float32Array([-1, 0, 1]), 16_000);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32_767);
  });
});

function completed(status: string): AgentEvent {
  return {
    type: "turn-completed",
    agentId: "chief",
    threadId: "thread-chief",
    turnId: "turn-1",
    status,
  };
}

function storage(value: string | null = null): Pick<Storage, "getItem"> {
  return { getItem: vi.fn(() => value) };
}

function audioParam() {
  return {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}
