import { describe, expect, it } from "vitest";
import { consumeChatBubblePendingRoute, setChatBubblePendingRoute } from "./chat-bubble-pending-route";

describe("chat bubble pending route", () => {
  it("has no route before the bubble asks for one", () => {
    expect(consumeChatBubblePendingRoute()).toBeNull();
  });

  it("gives the stored call to the main root once", () => {
    setChatBubblePendingRoute({ method: "push", args: ["/settings/voice"] });
    expect(consumeChatBubblePendingRoute()).toEqual({ method: "push", args: ["/settings/voice"] });
    expect(consumeChatBubblePendingRoute()).toBeNull();
  });

  it("keeps the last call when the bubble asks twice", () => {
    setChatBubblePendingRoute({ method: "push", args: ["/settings/voice"] });
    setChatBubblePendingRoute({ method: "replace", args: ["/pinned-messages"] });
    expect(consumeChatBubblePendingRoute()).toEqual({ method: "replace", args: ["/pinned-messages"] });
  });

  it("keeps the options of the call", () => {
    setChatBubblePendingRoute({ method: "navigate", args: ["/server-tasks", { withAnchor: true }] });
    expect(consumeChatBubblePendingRoute()).toEqual({
      method: "navigate",
      args: ["/server-tasks", { withAnchor: true }],
    });
  });
});
