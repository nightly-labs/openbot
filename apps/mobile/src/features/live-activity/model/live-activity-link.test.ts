import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_ACTIVITY_LIST_URL,
  LIVE_ACTIVITY_URL,
  type LiveActivityAction,
  liveActivityRoute,
  onLiveActivityAction,
  resetLiveActivityActions,
  setLiveActivityActions,
  setLiveActivityNavigator,
} from "./live-activity-link";

const approve: LiveActivityAction = {
  type: "respond-approval",
  serverId: "server-1",
  agentId: "agent-1",
  requestId: 7,
  decision: "accept",
};

afterEach(resetLiveActivityActions);

describe("Live Activity links", () => {
  it("opens the chat the activity shows, or the chat list before it shows one", () => {
    expect(liveActivityRoute(LIVE_ACTIVITY_URL)).toBe("/");
    setLiveActivityActions({ type: "open-agent", serverId: "server-1", agentId: "agent 1" }, [], () => "unused");
    expect(liveActivityRoute(LIVE_ACTIVITY_URL)).toBe("/chat/agent%201");
    expect(liveActivityRoute(LIVE_ACTIVITY_LIST_URL)).toBe("/");
  });

  it("opens the chat in the running app without a new screen", () => {
    const open = vi.fn<(agentId: string | null) => void>();
    const stop = setLiveActivityNavigator(open);
    setLiveActivityActions({ type: "open-agent", serverId: "server-1", agentId: "agent-1" }, [], () => "unused");

    expect(liveActivityRoute(LIVE_ACTIVITY_URL, false)).toBeNull();
    expect(open).toHaveBeenCalledWith("agent-1");
    stop();
  });

  it("sends an answer only for a button of the current state", () => {
    const receive = vi.fn<(action: LiveActivityAction) => void>();
    const stop = onLiveActivityAction(receive);
    const [url = ""] = setLiveActivityActions(null, [approve], () => "token-1");

    expect(setLiveActivityActions(null, [approve], () => "token-2")).toEqual([url]);
    expect(liveActivityRoute(`${LIVE_ACTIVITY_URL}?action=guessed`)).toBe("/");
    expect(liveActivityRoute(url)).toBe("/chat/agent-1");
    expect(receive).toHaveBeenCalledWith(approve);
    // A cancelled or failed answer leaves the same state, so the button still works.
    expect(liveActivityRoute(url)).toBe("/chat/agent-1");
    expect(receive).toHaveBeenCalledTimes(2);
    setLiveActivityActions(null, [], () => "unused");
    expect(liveActivityRoute(url)).toBe("/");
    expect(receive).toHaveBeenCalledTimes(2);
    stop();
  });

  it("opens a chat but changes no host state from the tap URL, which any app can open", () => {
    const receive = vi.fn<(action: LiveActivityAction) => void>();
    const stop = onLiveActivityAction(receive);
    setLiveActivityActions(approve, [], () => "unused");

    expect(liveActivityRoute(LIVE_ACTIVITY_URL)).toBe("/chat/agent-1");
    expect(receive).not.toHaveBeenCalled();
    stop();
  });
});
