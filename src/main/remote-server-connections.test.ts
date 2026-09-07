// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RemoteServerConnections } from "./remote-server-connections";
import { RemoteRequestError } from "./remote-server-errors";

function connections() {
  const changes: number[] = [];
  const suspended: string[] = [];
  const tracker = new RemoteServerConnections({
    appVersion: "1.2.3",
    onChanged: () => changes.push(changes.length),
    onReconnectSuspended: (serverId) => suspended.push(serverId),
  });
  return { tracker, changes, suspended };
}

describe("RemoteServerConnections", () => {
  it("announces a failure once, however many requests it refuses", () => {
    const { tracker, changes, suspended } = connections();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      tracker.reportError("host", new RemoteRequestError(401, "jwt expired"));
    }

    expect(changes).toHaveLength(1);
    expect(tracker.statusFor("host").issue?.code).toBe("authentication_required");
    // Reconnecting stays suspended on every report: the caller reads it to decide whether to retry,
    // and a repeat that says nothing new must not look retryable.
    expect(suspended).toHaveLength(50);
  });

  it("announces a failure that says something the last one did not", () => {
    const { tracker, changes } = connections();

    tracker.reportError("host", new RemoteRequestError(401, "jwt expired"));
    tracker.reportError("host", new TypeError("fetch failed"));
    tracker.reportError("host", new RemoteRequestError(401, "jwt expired"));

    expect(changes).toHaveLength(3);
    expect(tracker.statusFor("host").state).toBe("error");
  });

  it("announces a failure again once the connection has recovered in between", () => {
    const { tracker, changes } = connections();

    tracker.reportError("host", new RemoteRequestError(401, "jwt expired"));
    tracker.markConnected("host");
    tracker.reportError("host", new RemoteRequestError(401, "jwt expired"));

    expect(changes).toHaveLength(2);
  });

  it("keeps the transport's repeated failures from waking the renderer, and still reports the suspension", () => {
    const { tracker, changes } = connections();

    expect(tracker.reportTransportError("host", "session_revoked", "Session revoked.")).toBe(true);
    expect(tracker.reportTransportError("host", "session_revoked", "Session revoked.")).toBe(true);

    expect(changes).toHaveLength(1);
  });
});
