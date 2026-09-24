// @vitest-environment node

import type { VoiceModelStatus, VoiceTranscriptionInput, VoiceTranscriptionResult } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { handler, payloadHandler, registerIpcGroup } from "./define-ipc-group";

// Same reason as trusted-ipc.test.ts: electron cannot be imported outside an Electron process, and
// ipcMain is the only thing the wrappers touch, so registrations are captured rather than performed.
const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, ...arguments_: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...arguments_: unknown[]) => unknown) {
      registrations.set(channel, listener);
    },
  },
}));

const TRUSTED_EVENT = { senderFrame: { url: "openbot-app://app/index.html" } };
const UNTRUSTED_EVENT = { senderFrame: { url: "https://evil.example/index.html" } };

const READY: VoiceModelStatus = { phase: "ready", progress: null, message: null };

function decodeNote(value: unknown): VoiceTranscriptionInput {
  return { audio: new TextEncoder().encode(String(value)) };
}

// `voice` is the group under test because it is the smallest with all three shapes: a request that
// takes nothing, a request that takes a payload, and an event the main process only ever sends.
function registerVoice(transcribe: (input: VoiceTranscriptionInput) => VoiceTranscriptionResult): void {
  registerIpcGroup("voice", {
    getModelStatus: handler(() => READY),
    prepareModel: handler(() => READY),
    transcribe: payloadHandler(decodeNote, transcribe),
  });
}

// The type checker owns which endpoints a group has to be given a handler for; what it cannot show
// is what `registerIpcGroup` then does with them. Two things have to hold, and neither is visible in
// the types: the channel a handler ends up on is the one its endpoint declares, and the indirection
// does not step around the sender check that every handler used to be registered behind directly.
describe("IPC group registration", () => {
  it("registers each request endpoint on the channel it declares, and no event", () => {
    registerVoice((input) => ({ text: `heard ${new TextDecoder().decode(input.audio)}` }));

    expect(registrations.get("voice:get-model-status")?.(TRUSTED_EVENT)).toBe(READY);
    expect(registrations.get("voice:transcribe")?.(TRUSTED_EVENT, "a note")).toEqual({ text: "heard a note" });
    expect(registrations.has("voice:model-status")).toBe(false);
  });

  it("keeps a bound handler behind the sender check", () => {
    let handled = 0;
    registerVoice(() => {
      handled += 1;
      return { text: "" };
    });

    expect(() => registrations.get("voice:transcribe")?.(UNTRUSTED_EVENT, "a note")).toThrow(
      "Rejected IPC request from an untrusted renderer.",
    );
    expect(handled).toBe(0);
  });
});
