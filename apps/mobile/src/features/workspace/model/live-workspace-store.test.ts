import { describe, expect, it, vi } from "vitest";
import { LiveWorkspaceStore } from "./live-workspace-store";

describe("live workspace state", () => {
  it("notifies subscribers for a changed value and keeps the other fields", () => {
    const store = new LiveWorkspaceStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const requests = store.get().browserRequests;
    store.update("unreadAgentIds", (current) => current);
    expect(listener).not.toHaveBeenCalled();
    store.update("unreadAgentIds", () => ["agent"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ activityByServer: {}, unreadAgentIds: ["agent"], browserRequests: {} });
    expect(store.get().browserRequests).toBe(requests);
  });
});
