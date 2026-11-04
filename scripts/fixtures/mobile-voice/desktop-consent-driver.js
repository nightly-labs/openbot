import assert from "node:assert/strict";
import { createRoot, flush } from "solid-js";
import { createVoiceConversation } from "../../../src/renderer/src/features/conversation/stores/voice-conversation-store";
import {
  realtimeVoiceOptedIn,
  setRealtimeVoiceOptIn,
} from "../../../src/renderer/src/features/speech/realtime-voice-preference";
import { starts } from "./desktop-consent-native";

const saved = new Map();
globalThis.window = {
  localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
  addEventListener() {},
  removeEventListener() {},
};
let owner = "account-a";
let prepared = 0;
let statusReads = 0;
async function startCall() {
  let dispose;
  let call;
  createRoot((cleanup) => {
    dispose = cleanup;
    call = createVoiceConversation({
      agentId: "fixture-agent",
      serverId: "fixture-host",
      serverOnline: () => true,
      realtimeEnabled: () => realtimeVoiceOptedIn(owner),
      voice: {
        getRealtimeStatus: async () => {
          statusReads++;
          return { enabled: true };
        },
        connectRealtime() {},
        getSettings: async () => ({ modelId: "parakeet-tdt-0.6b-v3" }),
        prepareModel: async () => {
          prepared++;
          return { phase: "ready" };
        },
      },
      submit() {},
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  flush();
  const realtime = call.realtime();
  dispose();
  return realtime;
}
assert.equal(await startCall(), false, "A host switched the existing local call to OpenAI without consent.");
assert.equal(prepared, 1, "Local recognition was not prepared.");
assert.equal(statusReads, 0, "A local call queried the cloud transport.");
flush(() => setRealtimeVoiceOptIn(owner, true));
assert.equal(await startCall(), true, "Explicit device consent did not select the available cloud call.");
assert.equal(starts.length, 1);
owner = "account-b";
assert.equal(await startCall(), false, "One account's consent leaked to another account on this device.");
owner = "account-a";
flush(() => setRealtimeVoiceOptIn(owner, false));
assert.equal(await startCall(), false, "Turning the device choice off did not restore local calls.");
assert.equal(starts.length, 1, "A cloud call started after consent was removed.");
assert.equal([...saved.values()].includes("true"), false, "Revocation was not persisted.");
process.stdout.write(
  `${JSON.stringify({ passed: true, localByDefault: true, cloudOnlyAfterConsent: true, accountIsolation: true, revocationRestoresLocal: true })}\n`,
);
