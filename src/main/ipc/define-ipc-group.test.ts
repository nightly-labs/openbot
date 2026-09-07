// @vitest-environment node

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

// `voice` is the group under test because it is the smallest with all three shapes: a request that
// takes nothing, a request that takes a payload, and an event the main process only ever sends.
function registerVoice(transcribe: (text: string) => unknown): void {
  registerIpcGroup("voice", {
    getModelStatus: handler(() => "status"),
    prepareModel: handler(() => "prepared"),
    transcribe: payloadHandler((value) => String(value), transcribe),
  });
}

// The type checker owns which endpoints a group has to be given a handler for; what it cannot show
// is what `registerIpcGroup` then does with them. Two things have to hold, and neither is visible in
// the types: the channel a handler ends up on is the one its endpoint declares, and the indirection
// does not step around the sender check that every handler used to be registered behind directly.
describe("IPC group registration", () => {
  it("registers each request endpoint on the channel it declares, and no event", () => {
    registerVoice((text) => `heard ${text}`);

    expect(registrations.get("voice:get-model-status")?.(TRUSTED_EVENT)).toBe("status");
    expect(registrations.get("voice:transcribe")?.(TRUSTED_EVENT, "a note")).toBe("heard a note");
    expect(registrations.has("voice:model-status")).toBe(false);
  });

  it("keeps a bound handler behind the sender check", () => {
    let handled = 0;
    registerVoice((): void => {
      handled += 1;
    });

    expect(() => registrations.get("voice:transcribe")?.(UNTRUSTED_EVENT, "a note")).toThrow(
      "Rejected IPC request from an untrusted renderer.",
    );
    expect(handled).toBe(0);
  });
});
