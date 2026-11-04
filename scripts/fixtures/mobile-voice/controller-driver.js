import assert from "node:assert/strict";
import { liveVoice } from "../../../apps/mobile/src/features/chat/components/composer-voice";
import { createController } from "../../../apps/mobile/src/features/chat/components/use-live-conversation";
import { callOptions, spoken } from "./controller-native";

let state = {};
const delivery = {
  clientMessageId: "voice-request",
  messageId: "delivery-1",
  target: { kind: "agent", serverId: "fixture-host", agentId: "fixture-agent" },
};
const input = {
  realtimeReady: true,
  realtimeOptedIn: true,
  realtime: {},
  enabled: true,
  online: true,
  conversation: { messages: [], activeTurnId: null },
  channel: null,
  deliveries: [],
  outboxMessages: [],
  send: () => delivery,
};
const value = () => ({ set() {} });
const controller = createController({
  input: () => input,
  dictation: () => null,
  setState: (update) => (state = update(state)),
  presence: value(),
  speechLevel: value(),
});
controller.start();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(callOptions.transcript("Check the calendar.", true), true);
callOptions.speaking("Let me check that.");
callOptions.spoken();
assert.equal(state.phase, "thinking", "A spoken acknowledgement discarded the pending agent answer.");
input.deliveries = [{ id: "delivery-1", messageId: "request-1", turnId: "turn-1" }];
input.conversation = {
  activeTurnId: null,
  messages: [
    { id: "answer-1", turnId: "turn-1", author: "assistant", text: "The appointment is at ten.", status: "completed" },
  ],
};
controller.followReply();
assert.deepEqual(spoken, ["The appointment is at ten."], "The delivery-correlated answer did not return to the call.");
controller.followReply();
assert.equal(spoken.length, 1, "A completed answer was sent twice.");
controller.dispose();
controller.followReply();
assert.equal(spoken.length, 1, "A late answer escaped after call cleanup.");
let localStarts = 0;
input.realtimeOptedIn = false;
const local = createController({
  input: () => input,
  dictation: () => ({
    start() {
      localStarts++;
      return true;
    },
    cancel() {},
  }),
  setState: (update) => (state = update(state)),
  presence: value(),
  speechLevel: value(),
});
local.start();
assert.equal(state.realtime, false, "A ready host overrode device consent.");
assert.equal(localStarts, 1, "The existing local recognizer did not start.");
local.hear("Local speech remains captioned.");
assert.equal(state.caption, "Local speech remains captioned.");
assert.equal(
  liveVoice(state, "Fixture", (key) => key).bar.caption,
  state.caption,
  "The local call bar hid its caption.",
);
assert.equal(
  liveVoice({ ...state, realtime: true }, "Fixture", (key) => key).bar.caption,
  "",
  "The cloud call bar exposed transcript text.",
);
assert.equal(
  liveVoice({ ...state, realtime: true, error: "Call failed" }, "Fixture", (key) => key).bar.caption,
  "Call failed",
  "The cloud call bar hid its error.",
);
assert.equal(
  liveVoice({ ...state, realtimeReady: false }, "Fixture", (key) => key).callPath,
  "local",
  "The pre-call control identifies the wrong audio path.",
);
assert.equal(
  liveVoice({ ...state, realtimeReady: true }, "Fixture", (key) => key).callPath,
  "chatgpt",
  "The cloud call control is not identified before it starts.",
);
local.dispose();
process.stdout.write(
  `${JSON.stringify({
    passed: true,
    localWithoutConsent: true,
    localCaptionsRetained: true,
    acknowledgementRetainsPendingReply: true,
    answerReturnedOnce: true,
    cleanupRejectsLateReply: true,
  })}\n`,
);
