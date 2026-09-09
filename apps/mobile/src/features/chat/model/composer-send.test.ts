import { expect, it } from "vitest";
import { editMentionDraft } from "./chat-mentions";
import { createComposerSendGate } from "./composer-send";

it("waits for committed native text and sends it only once with mention identities", () => {
  const gate = createComposerSendGate();
  const sent: string[] = [];
  const draft = "@[Design](agent:design) helo";
  gate.focus();
  const requests = [gate.request(), gate.request()];
  expect({ requests, sent }).toEqual({ requests: ["blur", "none"], sent: [] });
  if (gate.commit()) sent.push(editMentionDraft(draft, "@Design hello"));
  if (gate.commit()) sent.push("duplicate end event");
  if (gate.submit()) sent.push("duplicate submit event");
  expect(sent).toEqual(["@[Design](agent:design) hello"]);
});

it("sends after editing already ended, and accepts a new draft after a send", () => {
  const gate = createComposerSendGate();
  gate.focus();
  gate.commit();
  const first = gate.request();
  const duplicate = gate.request();
  gate.edit();
  expect([first, duplicate, gate.request()]).toEqual(["send", "none", "send"]);
});

it("does not send a cancelled request when the native commit arrives", () => {
  const gate = createComposerSendGate();
  gate.focus();
  gate.request();
  gate.cancel();
  expect(gate.commit()).toBe(false);
});
