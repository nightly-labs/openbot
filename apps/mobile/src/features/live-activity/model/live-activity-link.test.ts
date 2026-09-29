import {
  LIVE_ACTIVITY_LIST_URL,
  LIVE_ACTIVITY_URL,
  type LiveActivityAction,
  liveActivityActionUrl,
} from "@openbot/team-client/live-activity-props";
import { LIVE_ACTIVITY_SECRET_BYTES, liveActivityKeys } from "@openbot/team-client/live-activity-seal";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type LiveActivityRequest,
  liveActivityRoute,
  onLiveActivityAction,
  resetLiveActivityActions,
  setLiveActivityLinkKeys,
  setLiveActivityNavigator,
} from "./live-activity-link";

const keys = liveActivityKeys(new Uint8Array(LIVE_ACTIVITY_SECRET_BYTES).fill(1));

const approve: LiveActivityAction = {
  type: "respond-approval",
  serverId: "server-1",
  agentId: "agent-1",
  requestId: 7,
  decision: "accept",
};
const openUrl = `${LIVE_ACTIVITY_URL}?server=server-1&agent=agent%201`;

afterEach(resetLiveActivityActions);

describe("Live Activity links", () => {
  it("opens the chat the link names, or the chat list", () => {
    setLiveActivityLinkKeys(keys);

    expect(liveActivityRoute(openUrl)).toBe("/chat/agent%201");
    expect(liveActivityRoute(LIVE_ACTIVITY_LIST_URL)).toBe("/");
    expect(liveActivityRoute(LIVE_ACTIVITY_URL)).toBe("/");
  });

  it("opens the chat in the running app without a new screen", () => {
    setLiveActivityLinkKeys(keys);
    const open = vi.fn<(agentId: string | null) => void>();
    const stop = setLiveActivityNavigator(open);

    expect(liveActivityRoute(openUrl, false)).toBeNull();
    expect(open).toHaveBeenCalledWith("agent 1");
    stop();
  });

  it("sends an answer only from a link with the phone signature, as any app can open a link", () => {
    setLiveActivityLinkKeys(keys);
    const receive = vi.fn<(request: LiveActivityRequest) => void>();
    const stop = onLiveActivityAction(receive);
    const signed = liveActivityActionUrl(approve, keys.action, "npm test");
    const forged = liveActivityActionUrl(approve, liveActivityKeys(new Uint8Array(32).fill(2)).action, "npm test");

    expect(liveActivityRoute(forged)).toBe("/");
    expect(receive).not.toHaveBeenCalled();
    expect(liveActivityRoute(signed)).toBe("/chat/agent-1");
    expect(receive).toHaveBeenCalledWith({ action: approve, command: "npm test" });
    stop();
  });

  it("checks a button link from a cold start when the keys load", () => {
    const receive = vi.fn<(request: LiveActivityRequest) => void>();
    const stop = onLiveActivityAction(receive);

    expect(liveActivityRoute(liveActivityActionUrl(approve, keys.action))).toBe("/");
    expect(receive).not.toHaveBeenCalled();
    setLiveActivityLinkKeys(keys);
    expect(receive).toHaveBeenCalledWith({ action: approve, command: null });
    stop();
  });
});
